import { Vector3 } from '../../math/Vector3';
import { getPlayerLegDimensions, SIM_CONFIG } from '../config';
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
  readonly headingExplicit?: boolean;  // true if heading angle was explicitly supplied
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
  private currentBootYaw: number = 0;
  private currentBootPitch: number = 0;
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
    const legDimensions = getPlayerLegDimensions(player.attributes.heightCm);
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
    const hipOffset = legDimensions.hipOffsetY;
    const hipPos = new Vector3(
      player.position.x + latX * (latSign * hipOffset),
      player.position.y + latY * (latSign * hipOffset),
      legDimensions.hipHeight
    );

    this.currentIntent = intent;
    this.ankleStiffness = Math.max(0, Math.min(1, intent.ankleStiffness ?? 0.90));

    // Strike orientation unit vector
    const elevRad = (intent.elevationDeg * Math.PI) / 180;
    this.strikeDir = new Vector3(
      Math.cos(intent.headingRad) * Math.cos(elevRad),
      Math.sin(intent.headingRad) * Math.cos(elevRad),
      Math.sin(elevRad)
    ).normalize();

    const zoneKey = intent.contactZone ?? 'instep';
    this.bootYaw = intent.headingRad;
    const isKnuckle = zoneKey === 'instep' && (intent.sidespinRps ?? 0) === 0 && (intent.backspinRps ?? 0) === 0;
    this.bootPitch = isKnuckle ? elevRad : (elevRad > 0.1 ? elevRad * 0.8 : -0.15);
    this.currentBootYaw = this.bootYaw;
    this.currentBootPitch = this.bootPitch;

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
      const perp = new Vector3(-Math.sin(intent.headingRad), Math.cos(intent.headingRad), 0);
      const sign = this.activeFoot === 'right' ? 1 : -1;
      contactOffset = contactOffset.add(perp.scale(sign * 0.045));
    } else if (zoneKey === 'medial') {
      const perp = new Vector3(-Math.sin(intent.headingRad), Math.cos(intent.headingRad), 0);
      const sign = this.activeFoot === 'right' ? -1 : 1;
      contactOffset = contactOffset.add(perp.scale(sign * 0.045));
    } else if (intent.elevationDeg > 20) {
      contactOffset = new Vector3(contactOffset.x, contactOffset.y, -SIM_CONFIG.BALL.RADIUS * 0.55);
    }

    // Reach check: verifies that the ball is physically reachable within leg IK envelope
    const maxLegReach = legDimensions.thighLength + legDimensions.shinLength;
    const maxBootReach3D =
      maxLegReach +
      SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_TOE +
      SIM_CONFIG.BALL.RADIUS +
      0.001;

    const ballDist3D = ball.position.sub(hipPos).length();
    const ballPlanarDist = Math.hypot(ball.position.x - player.position.x, ball.position.y - player.position.y);

    if (intent.headingExplicit) {
      if (ballDist3D > maxBootReach3D || ballPlanarDist > 0.955) {
        return { success: false, reason: `Ball out of reach (${ballDist3D.toFixed(2)}m > ${maxBootReach3D.toFixed(2)}m)` };
      }
    } else {
      const relaxedReach = maxBootReach3D + SIM_CONFIG.COLLISION.BOOT_RADIUS + 0.005;
      if (ballDist3D > relaxedReach || ballPlanarDist > 0.955) {
        return { success: false, reason: `Ball out of reach (${ballDist3D.toFixed(2)}m > ${relaxedReach.toFixed(2)}m)` };
      }
    }

    // Invert impulse formula to calculate required foot impact speed.
    // Re-derived arrival & geometric transfer efficiency (eta = 0.78):
    // Accounts for:
    // (1) Swept impact occurring at tau_impact in [0.85, 0.92] along the progressive whip forward stroke,
    // (2) Oblique normal contact on the curved boot capsule surface (cos theta ~ 0.94),
    // (3) Tangential sliding friction dissipation.
    // v_target = v_desired / (R * eta) ensures post-impact ball speed matches desiredSpeed.
    const zoneProps = SIM_CONFIG.BOOT_ZONES[zoneKey];
    const mBall = SIM_CONFIG.BALL.MASS;
    const mBoot = SIM_CONFIG.COLLISION.BOOT_MIN_MASS + this.ankleStiffness * (SIM_CONFIG.COLLISION.BOOT_MAX_MASS - SIM_CONFIG.COLLISION.BOOT_MIN_MASS);
    const e = (SIM_CONFIG.COLLISION.BOOT_MIN_RESTITUTION + this.ankleStiffness * (SIM_CONFIG.COLLISION.BOOT_MAX_RESTITUTION - SIM_CONFIG.COLLISION.BOOT_MIN_RESTITUTION)) * zoneProps.restitutionMult;
    const rCoeff = ((1 + e) * mBoot) / (mBall + mBoot);

    const eta = 0.78;
    const maxFootSpeedForZone = zoneProps.powerCap / Math.max(0.2, rCoeff * eta);
    this.targetFootSpeed = Math.min(
      SIM_CONFIG.KICK_SWING.FOOT_SPEED_MAX,
      maxFootSpeedForZone,
      intent.desiredSpeed / Math.max(0.2, rCoeff * eta)
    );

    // Foot position at trigger
    const foot2D = this.activeFoot === 'left' ? player.stride.leftFootPos : player.stride.rightFootPos;
    this.startFootPos = new Vector3(foot2D.x, foot2D.y, SIM_CONFIG.COLLISION.FOOT_STANCE_Z);

    this.strikePos = ball.position.add(contactOffset);

    // Calculate required travel distance so that progressive forward swing (s(u) = u^3)
    // reaches targetFootSpeed exactly at contact: v = D * (1 - (1 - 1/N)^3) / dt
    const fwdDuration = SIM_CONFIG.KICK_SWING.FORWARD_SWING_TIME;
    const fwdTicks = Math.max(1, Math.round(fwdDuration / SIM_CONFIG.LOOP.FIXED_DT));
    const lastStepFrac = 1.0 - Math.pow(1.0 - 1.0 / fwdTicks, 3);
    const travelDist = (this.targetFootSpeed * SIM_CONFIG.LOOP.FIXED_DT) / Math.max(1e-4, lastStepFrac);

    // Backswing position: drawn backward directly along strike line
    this.backswingPos = this.strikePos.sub(this.strikeDir.scale(travelDist));

    // Follow-through position: extended forward along strike line
    // With s(u) = sin(u * pi/2), initial speed matches targetFootSpeed when D_ft = targetFootSpeed * dt / sin(dt/T_ft * pi/2)
    const ftDuration = SIM_CONFIG.KICK_SWING.FOLLOW_THROUGH_TIME;
    const ftTicks = Math.max(1, Math.round(ftDuration / SIM_CONFIG.LOOP.FIXED_DT));
    const firstStepFrac = Math.sin((1.0 / ftTicks) * Math.PI * 0.5);
    const followThroughDist = Math.min(0.38, (this.targetFootSpeed * SIM_CONFIG.LOOP.FIXED_DT) / Math.max(1e-4, firstStepFrac));
    this.followThroughPos = this.strikePos.add(this.strikeDir.scale(followThroughDist));

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
      const legDimensions = getPlayerLegDimensions(player.attributes.heightCm);
      const latSign = this.activeFoot === 'left' ? -1 : 1;
      const latX = -Math.sin(player.facing);
      const latY = Math.cos(player.facing);
      const hipOffset = legDimensions.hipOffsetY;
      const hipPos = new Vector3(
        player.position.x + latX * (latSign * hipOffset),
        player.position.y + latY * (latSign * hipOffset),
        legDimensions.hipHeight
      );

      const maxLegReach = legDimensions.thighLength + legDimensions.shinLength;
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
        const clampDir = ankleFromHip.scale(1 / ankleDist);
        const clampedAnkle = hipPos.add(clampDir.scale(maxLegReach));
        // Natural plantarflexion & toe point: orient boot directly toward ball when stretching to reach
        const toTarget = (this.targetBallPos ?? this.strikePos).sub(clampedAnkle);
        const toTargetDist = toTarget.length();
        let adaptedPitch = this.bootPitch;
        let adaptedYaw = this.bootYaw;
        if (toTargetDist > 1e-3) {
          adaptedPitch = Math.asin(Math.max(-0.85, Math.min(0.85, toTarget.z / toTargetDist)));
          adaptedYaw = Math.atan2(toTarget.y, toTarget.x);
        }
        this.currentBootPitch = adaptedPitch;
        this.currentBootYaw = adaptedYaw;
        const adaptedBootDir = new Vector3(
          Math.cos(adaptedYaw) * Math.cos(adaptedPitch),
          Math.sin(adaptedYaw) * Math.cos(adaptedPitch),
          Math.sin(adaptedPitch)
        ).normalize();
        return clampedAnkle.add(adaptedBootDir.scale(ankleToMidOffset));
      }
      this.currentBootPitch = this.bootPitch;
      this.currentBootYaw = this.bootYaw;
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
      // Cubic whip acceleration toward ball contact point
      const s = u * u * u;
      let nextPos = this.backswingPos.lerp(this.strikePos, s);
      nextPos = constrainToLegIK(nextPos);
      this.currentFootVel = nextPos.sub(this.currentFootPos).scale(1 / Math.max(1e-4, dt));
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
      this.currentFootVel = nextPos.sub(this.currentFootPos).scale(1 / Math.max(1e-4, dt));
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
      Math.cos(this.currentBootYaw) * Math.cos(this.currentBootPitch),
      Math.sin(this.currentBootYaw) * Math.cos(this.currentBootPitch),
      Math.sin(this.currentBootPitch)
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
        bootYaw: this.currentBootYaw,
        bootPitch: this.currentBootPitch,
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
