import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import { BallState, FootId, PlayerState } from '../types';
import { BootZoneId } from './BootZones';

export type KickState =
  | 'idle'
  | 'waiting_for_stride'
  | 'backswing'
  | 'forward_swing'
  | 'follow_through'
  | 'blend_out';

export interface KickIntent {
  readonly desiredSpeed: number;       // m/s
  readonly elevationDeg: number;       // degrees
  readonly headingRad: number;         // radians
  readonly sidespinRps?: number;       // RPS (+ inside curl, - trivela)
  readonly backspinRps?: number;       // RPS (+ backspin lift)
  readonly contactZone?: BootZoneId;   // Target boot zone
  readonly ankleStiffness?: number;    // 0..1 (default: 0.9 for strike, 1.0 for knuckle)
}

export interface BootOverrideData {
  readonly p1: Vector3;
  readonly p2: Vector3;
  readonly v1: Vector3;
  readonly v2: Vector3;
  readonly bootYaw: number;
  readonly bootPitch: number;
  readonly ankleStiffness: number;
}

/**
 * Kinematic Kick Swing Controller overriding swing-foot trajectory during kick execution.
 * State Machine: idle -> [waiting_for_stride] -> backswing -> forward_swing -> follow_through -> blend_out (~100ms)
 * Ball velocity and spin emerge purely from the contact solver upon swept impact.
 */
export class KickSwingController {
  private state: KickState = 'idle';
  private stateTimer: number = 0;
  private activeFoot: FootId = 'right';
  private currentIntent: KickIntent | null = null;

  // Trajectory Waypoints
  private startFootPos: Vector3 = Vector3.zero();
  private backswingPos: Vector3 = Vector3.zero();
  private strikePos: Vector3 = Vector3.zero();
  private followThroughPos: Vector3 = Vector3.zero();
  private targetFootSpeed: number = 0;
  private strikeDir: Vector3 = Vector3.zero();
  private bootYaw: number = 0;
  private bootPitch: number = 0;
  private ankleStiffness: number = 0.9;
  private currentFootPos: Vector3 = Vector3.zero();
  private currentFootVel: Vector3 = Vector3.zero();
  private targetBallPos: Vector3 | null = null;

  // Last contact telemetry
  private lastContactMarker: {
    point: Vector3;
    normal: Vector3;
    zone: BootZoneId;
    impulse: Vector3;
    time: number;
  } | null = null;

  getState(): KickState {
    return this.state;
  }

  isKicking(): boolean {
    return this.state !== 'idle';
  }

  getActiveFoot(): FootId {
    return this.activeFoot;
  }

  getCurrentIntent(): KickIntent | null {
    return this.currentIntent;
  }

  getLastContactMarker() {
    return this.lastContactMarker;
  }

  recordContact(point: Vector3, normal: Vector3, zone: BootZoneId, impulse: Vector3, time: number): void {
    this.lastContactMarker = { point, normal, zone, impulse, time };
  }

  /**
   * Requests an intentional kick swing with specified intent.
   * Enforces the KICK_REACH_M rule (1.0 m from player COM).
   */
  requestKick(
    intent: KickIntent,
    player: PlayerState,
    ball: BallState
  ): { success: boolean; reason?: string } {
    // Foot selection: ball side relative to player facing
    const dx = ball.position.x - player.position.x;
    const dy = ball.position.y - player.position.y;
    const latX = -Math.sin(player.facing);
    const latY = Math.cos(player.facing);

    const latDist = dx * latX + dy * latY;

    if (latDist > 0.05) {
      this.activeFoot = 'right';
    } else if (latDist < -0.05) {
      this.activeFoot = 'left';
    } else {
      this.activeFoot = player.attributes.footedness.dominantFoot === 'left' ? 'left' : 'right';
    }

    // Reach check: computed from real geometry (hip height, leg length, ankle z, boot offsets, ball radius)
    const latSign = this.activeFoot === 'left' ? -1 : 1;
    const hipOffset = SIM_CONFIG.COLLISION.HIP_OFFSET_Y;
    const hipPos = new Vector3(
      player.position.x + latX * (latSign * hipOffset),
      player.position.y + latY * (latSign * hipOffset),
      SIM_CONFIG.COLLISION.HIP_HEIGHT
    );

    // Leg reach from hip to ankle in 3D
    const maxLegReach = SIM_CONFIG.COLLISION.THIGH_LEN + SIM_CONFIG.COLLISION.SHIN_LEN;
    const maxBootReach3D =
      maxLegReach +
      SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_TOE +
      SIM_CONFIG.COLLISION.BOOT_RADIUS +
      SIM_CONFIG.BALL.RADIUS +
      0.005; // Tight compliance margin for pelvic tilt

    const dz = Math.abs(hipPos.z - ball.position.z);
    const maxReach2D = Math.sqrt(Math.max(0, maxBootReach3D * maxBootReach3D - dz * dz));
    const distFromHip2D = Math.hypot(ball.position.x - hipPos.x, ball.position.y - hipPos.y);

    if (distFromHip2D > maxReach2D) {
      return { success: false, reason: `Ball out of reach (${distFromHip2D.toFixed(2)}m > ${maxReach2D.toFixed(2)}m)` };
    }

    this.currentIntent = intent;
    this.ankleStiffness = Math.max(0, Math.min(1, intent.ankleStiffness ?? 0.90));

    // Invert impulse formula to calculate required foot impact speed
    // v_ball = R * v_foot * arrivalEfficiency => v_foot = v_ball / (R * arrivalEfficiency)
    const zoneKey = intent.contactZone ?? 'instep';
    const zoneProps = SIM_CONFIG.BOOT_ZONES[zoneKey];
    const mBall = SIM_CONFIG.BALL.MASS;
    const mBoot = SIM_CONFIG.COLLISION.BOOT_MIN_MASS + this.ankleStiffness * (SIM_CONFIG.COLLISION.BOOT_MAX_MASS - SIM_CONFIG.COLLISION.BOOT_MIN_MASS);
    const e = (SIM_CONFIG.COLLISION.BOOT_MIN_RESTITUTION + this.ankleStiffness * (SIM_CONFIG.COLLISION.BOOT_MAX_RESTITUTION - SIM_CONFIG.COLLISION.BOOT_MIN_RESTITUTION)) * zoneProps.restitutionMult;
    const rCoeff = ((1 + e) * mBoot) / (mBall + mBoot);

    // Arrival efficiency accounts for swept impact occurring during forward stroke before full extension
    const arrivalEfficiency = 0.78;
    const maxFootSpeedForZone = zoneProps.powerCap / Math.max(0.2, rCoeff * arrivalEfficiency);
    this.targetFootSpeed = Math.min(
      SIM_CONFIG.KICK_SWING.FOOT_SPEED_MAX,
      maxFootSpeedForZone,
      intent.desiredSpeed / Math.max(0.2, rCoeff * arrivalEfficiency)
    );

    // Strike orientation unit vector
    const elevRad = (intent.elevationDeg * Math.PI) / 180;
    this.strikeDir = new Vector3(
      Math.cos(intent.headingRad) * Math.cos(elevRad),
      Math.sin(intent.headingRad) * Math.cos(elevRad),
      Math.sin(elevRad)
    ).normalize();

    this.bootYaw = intent.headingRad;
    const isKnuckle = zoneKey === 'instep' && (intent.sidespinRps ?? 0) === 0 && (intent.backspinRps ?? 0) === 0;
    this.bootPitch = isKnuckle ? elevRad : (elevRad > 0.1 ? elevRad * 0.8 : -0.15);

    // Foot position at trigger
    const foot2D = this.activeFoot === 'left' ? player.stride.leftFootPos : player.stride.rightFootPos;
    this.startFootPos = new Vector3(foot2D.x, foot2D.y, SIM_CONFIG.COLLISION.FOOT_STANCE_Z);

    // Target contact offset on ball
    const bootRadius = SIM_CONFIG.COLLISION.BOOT_RADIUS;
    const bootLen = SIM_CONFIG.COLLISION.BOOT_LENGTH;
    const halfLen = (bootLen - 2 * bootRadius) * 0.5;
    const totalRad = SIM_CONFIG.BALL.RADIUS + bootRadius;

    const bootDir = new Vector3(
      Math.cos(this.bootYaw) * Math.cos(this.bootPitch),
      Math.sin(this.bootYaw) * Math.cos(this.bootPitch),
      Math.sin(this.bootPitch)
    ).normalize();

    const fwdExt = Math.max(0, bootDir.dot(this.strikeDir)) * halfLen;
    let contactOffset = this.strikeDir.scale(-(totalRad + fwdExt));
    if (zoneKey === 'lateral') {
      // Trivela outside curl
      const perp = new Vector3(-Math.sin(intent.headingRad), Math.cos(intent.headingRad), 0);
      const sign = this.activeFoot === 'right' ? 1 : -1;
      contactOffset = contactOffset.add(perp.scale(sign * 0.045));
    } else if (zoneKey === 'medial') {
      // Inside foot curl
      const perp = new Vector3(-Math.sin(intent.headingRad), Math.cos(intent.headingRad), 0);
      const sign = this.activeFoot === 'right' ? -1 : 1;
      contactOffset = contactOffset.add(perp.scale(sign * 0.045));
    } else if (intent.elevationDeg > 20) {
      // Chipped scoop: contact below equator
      contactOffset = new Vector3(contactOffset.x, contactOffset.y, -SIM_CONFIG.BALL.RADIUS * 0.55);
    }

    this.strikePos = ball.position.add(contactOffset);

    // Backswing position: drawn backward directly along strike line
    this.backswingPos = this.strikePos.sub(this.strikeDir.scale(0.32));

    // Follow-through position: extended forward along strike line
    this.followThroughPos = this.strikePos.add(this.strikeDir.scale(0.38));

    this.state = 'backswing';
    this.stateTimer = 0;
    this.currentFootPos = this.startFootPos;
    this.currentFootVel = Vector3.zero();
    this.targetBallPos = ball.position.clone();

    return { success: true };
  }

  /**
   * Advances the kinematic kick swing simulation by dt.
   */
  step(dt: number, player: PlayerState): void {
    if (this.state === 'idle') return;

    this.stateTimer += dt;

    // Real geometry IK ankle constraint:
    // Distance from hip to ankle cannot exceed THIGH_LEN + SHIN_LEN
    const constrainToLegIK = (pos: Vector3): Vector3 => {
      const latSign = this.activeFoot === 'left' ? -1 : 1;
      const latX = -Math.sin(player.facing);
      const latY = Math.cos(player.facing);
      const hipOffset = SIM_CONFIG.COLLISION.HIP_OFFSET_Y;
      const hipPos = new Vector3(
        player.position.x + latX * (latSign * hipOffset),
        player.position.y + latY * (latSign * hipOffset),
        SIM_CONFIG.COLLISION.HIP_HEIGHT
      );

      const maxLegReach = SIM_CONFIG.COLLISION.THIGH_LEN + SIM_CONFIG.COLLISION.SHIN_LEN;
      const bootDir = new Vector3(
        Math.cos(this.bootYaw) * Math.cos(this.bootPitch),
        Math.sin(this.bootYaw) * Math.cos(this.bootPitch),
        Math.sin(this.bootPitch)
      ).normalize();

      const ankleToMidOffset = (SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_TOE - SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_HEEL) * 0.5;
      const anklePos = pos.sub(bootDir.scale(ankleToMidOffset));
      const ankleFromHip = anklePos.sub(hipPos);
      const ankleDist = ankleFromHip.length();

      if (ankleDist > maxLegReach) {
        const clampedAnkle = hipPos.add(ankleFromHip.scale(maxLegReach / ankleDist));
        // Natural plantarflexion: point boot directly toward ball when stretching to reach
        const toTarget = this.targetBallPos ? this.targetBallPos.sub(clampedAnkle) : this.strikePos.sub(clampedAnkle);
        const toTargetDist = toTarget.length();
        if (toTargetDist > 1e-3) {
          const targetPitch = Math.asin(Math.max(-0.85, Math.min(0.85, toTarget.z / toTargetDist)));
          this.bootPitch = targetPitch;
        }
        const adaptedBootDir = new Vector3(
          Math.cos(this.bootYaw) * Math.cos(this.bootPitch),
          Math.sin(this.bootYaw) * Math.cos(this.bootPitch),
          Math.sin(this.bootPitch)
        ).normalize();
        return clampedAnkle.add(adaptedBootDir.scale(ankleToMidOffset));
      }
      return pos;
    };

    if (this.state === 'backswing') {
      const duration = SIM_CONFIG.KICK_SWING.BACKSWING_TIME;
      const u = Math.min(1.0, this.stateTimer / duration);
      // Smooth minimum-jerk blend from startFootPos to backswingPos
      const s = u * u * (3 - 2 * u);
      let nextPos = this.startFootPos.lerp(this.backswingPos, s);
      nextPos = constrainToLegIK(nextPos);
      this.currentFootVel = nextPos.sub(this.currentFootPos).scale(1 / Math.max(1e-4, dt));
      this.currentFootPos = nextPos;

      if (u >= 1.0) {
        this.state = 'forward_swing';
        this.stateTimer = 0;
      }
    } else if (this.state === 'forward_swing') {
      const duration = SIM_CONFIG.KICK_SWING.FORWARD_SWING_TIME;
      const u = Math.min(1.0, this.stateTimer / duration);
      // Quadratic acceleration toward ball contact point
      const s = u * u;
      let nextPos = this.backswingPos.lerp(this.strikePos, s);
      nextPos = constrainToLegIK(nextPos);
      // Arrives with targetFootSpeed in direction of strike
      const velMag = Math.min(this.targetFootSpeed, u * this.targetFootSpeed * 1.5);
      this.currentFootVel = this.strikeDir.scale(velMag);
      this.currentFootPos = nextPos;

      if (u >= 1.0) {
        this.state = 'follow_through';
        this.stateTimer = 0;
      }
    } else if (this.state === 'follow_through') {
      const duration = SIM_CONFIG.KICK_SWING.FOLLOW_THROUGH_TIME;
      const u = Math.min(1.0, this.stateTimer / duration);
      // Decelerate past the strike point
      const s = Math.sin(u * Math.PI * 0.5);
      let nextPos = this.strikePos.lerp(this.followThroughPos, s);
      nextPos = constrainToLegIK(nextPos);
      const remainingSpeed = this.targetFootSpeed * (1 - u);
      this.currentFootVel = this.strikeDir.scale(remainingSpeed);
      this.currentFootPos = nextPos;

      if (u >= 1.0) {
        this.state = 'blend_out';
        this.stateTimer = 0;
      }
    } else if (this.state === 'blend_out') {
      const duration = SIM_CONFIG.KICK_SWING.BLEND_OUT_TIME;
      const u = Math.min(1.0, this.stateTimer / duration);
      const s = u * u * (3 - 2 * u);

      // Target normal foot position from stride
      const target2D = this.activeFoot === 'left' ? player.stride.leftFootPos : player.stride.rightFootPos;
      const targetPos = new Vector3(target2D.x, target2D.y, SIM_CONFIG.COLLISION.FOOT_STANCE_Z);

      const nextPos = this.followThroughPos.lerp(targetPos, s);
      this.currentFootVel = nextPos.sub(this.currentFootPos).scale(1 / Math.max(1e-4, dt));
      this.currentFootPos = nextPos;

      if (u >= 1.0) {
        this.state = 'idle';
        this.stateTimer = 0;
        this.currentIntent = null;
      }
    }
  }

  /**
   * Generates override boot capsule endpoints and velocities for the swinging foot.
   */
  getBootOverride(): { foot: FootId; data: BootOverrideData } | null {
    if (this.state === 'idle') return null;

    const bootRadius = SIM_CONFIG.COLLISION.BOOT_RADIUS;
    const bootLen = SIM_CONFIG.COLLISION.BOOT_LENGTH;
    const halfLen = (bootLen - 2 * bootRadius) * 0.5;

    const bootDir = new Vector3(
      Math.cos(this.bootYaw) * Math.cos(this.bootPitch),
      Math.sin(this.bootYaw) * Math.cos(this.bootPitch),
      Math.sin(this.bootPitch)
    ).normalize();

    const p1 = this.currentFootPos.sub(bootDir.scale(halfLen));
    const p2 = this.currentFootPos.add(bootDir.scale(halfLen));

    return {
      foot: this.activeFoot,
      data: {
        p1,
        p2,
        v1: this.currentFootVel,
        v2: this.currentFootVel,
        bootYaw: this.bootYaw,
        bootPitch: this.bootPitch,
        ankleStiffness: this.ankleStiffness,
      },
    };
  }

  reset(): void {
    this.state = 'idle';
    this.stateTimer = 0;
    this.currentIntent = null;
    this.lastContactMarker = null;
    this.targetBallPos = null;
  }
}
