import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import { PlayerState } from '../types';
import { poseAt } from './LegKinematics';

export interface CapsuleShape {
  readonly type: 'capsule';
  readonly p1: Vector3; // Proximal center
  readonly p2: Vector3; // Distal center
  readonly radius: number;
  readonly v1?: Vector3; // Velocity at p1
  readonly v2?: Vector3; // Velocity at p2
}

export interface SphereShape {
  readonly type: 'sphere';
  readonly center: Vector3;
  readonly radius: number;
}

export type ContactShape = CapsuleShape | SphereShape;

export type ContactBodyId =
  | 'torso'
  | 'left_thigh'
  | 'left_shin'
  | 'left_boot'
  | 'right_thigh'
  | 'right_shin'
  | 'right_boot'
  | 'left_foot'
  | 'right_foot';

export interface ContactBody {
  readonly id: ContactBodyId;
  readonly shape: ContactShape;
  readonly prevPos: Vector3;
  readonly currPos: Vector3;
  readonly velocity: Vector3;
  readonly effMass: number;      // Effective mass in kg
  readonly restitution: number;  // Coefficient of restitution e
  readonly friction: number;     // Coulomb friction coefficient mu
  readonly loaded: boolean;      // True if bearing ground reaction force
  readonly active: boolean;      // True for swing foot that can apply active touch
  readonly bootYaw?: number;     // Boot yaw in radians
  readonly bootPitch?: number;   // Boot pitch in radians
  readonly isRightFoot?: boolean;
  readonly ankleStiffness?: number; // 0 (soft cushion) to 1 (rigid locked strike)
}

/**
 * Builds an inset capsule between two 3D joint centers a and b with surface radius r.
 * Insetting endpoints by r ensures the outer rounded capsule surfaces strictly match joint positions a and b.
 */
function createInsetCapsule(
  a: Vector3,
  b: Vector3,
  radius: number,
  v1: Vector3 = Vector3.zero(),
  v2: Vector3 = Vector3.zero()
): CapsuleShape {
  const axis = b.sub(a);
  const len = axis.length();
  if (len <= 2 * radius + 1e-4) {
    const mid = a.add(b).scale(0.5);
    return {
      type: 'capsule',
      p1: mid,
      p2: mid,
      radius,
      v1,
      v2,
    };
  }
  const u = axis.scale(1 / len);
  const p1 = a.add(u.scale(radius));
  const p2 = b.sub(u.scale(radius));
  return {
    type: 'capsule',
    p1,
    p2,
    radius,
    v1,
    v2,
  };
}

/**
 * Extracts full 3D geometric contact bodies:
 * - Torso 3D capsule (pelvis to head apex)
 * - Left & Right Thigh 3D capsules (hip to knee)
 * - Left & Right Shin 3D capsules (knee to ankle)
 * - Left & Right Boot 3D capsules (heel to toe)
 *
 * All joint positions and velocities are derived from the analytic 2-bone IK chain.
 */
export function extractPlayerContactBodies(
  prevState: PlayerState,
  currState: PlayerState,
  dt: number,
  tFrac: number = 1.0,
  overrideLeftBoot?: { p1: Vector3; p2: Vector3; v1: Vector3; v2: Vector3; bootYaw: number; bootPitch: number; ankleStiffness: number },
  overrideRightBoot?: { p1: Vector3; p2: Vector3; v1: Vector3; v2: Vector3; bootYaw: number; bootPitch: number; ankleStiffness: number }
): ContactBody[] {
  const safeDt = Math.max(1e-4, dt);
  const bodies: ContactBody[] = [];

  // 1. Torso 3D Capsule (starts at pelvis z = 0.85m to allow ground ball dribbling between legs)
  const torsoBaseZ = SIM_CONFIG.COLLISION.TORSO_BASE_Z;
  const playerHeight = currState.attributes.heightCm / 100;
  const torsoTopZ = Math.max(torsoBaseZ + 0.30, playerHeight);
  const torsoRadius = SIM_CONFIG.COLLISION.TORSO_RADIUS;
  const p1Z = torsoBaseZ + torsoRadius;
  const p2Z = Math.max(p1Z, torsoTopZ - torsoRadius);

  const prevTorsoPos = Vector3.fromVector2(prevState.position, torsoBaseZ);
  const currTorsoPos = Vector3.fromVector2(currState.position, torsoBaseZ);
  const torsoVel = currTorsoPos.sub(prevTorsoPos).scale(1 / safeDt);

  bodies.push({
    id: 'torso',
    shape: {
      type: 'capsule',
      p1: new Vector3(currState.position.x, currState.position.y, p1Z),
      p2: new Vector3(currState.position.x, currState.position.y, p2Z),
      radius: torsoRadius,
      v1: torsoVel,
      v2: torsoVel,
    },
    prevPos: prevTorsoPos,
    currPos: currTorsoPos,
    velocity: torsoVel,
    effMass: SIM_CONFIG.COLLISION.TORSO_EFF_MASS,
    restitution: SIM_CONFIG.COLLISION.TORSO_RESTITUTION,
    friction: 0.35,
    loaded: true,
    active: false,
  });

  // 2. Evaluate Leg & Boot Kinematics at normalized tick fraction tFrac
  const legPoses = poseAt(currState, tFrac, safeDt);

  // Helper to generate thigh, shin, and boot colliders per leg
  const buildLegBodies = (isRight: boolean) => {
    const leg = isRight ? legPoses.right : legPoses.left;
    const prefix = isRight ? 'right' : 'left';
    const isLoaded = leg.loaded;

    // A. Thigh Capsule (hip -> knee)
    const thighRadius = SIM_CONFIG.COLLISION.THIGH_RADIUS;
    const thighShape = createInsetCapsule(leg.hip, leg.knee, thighRadius, leg.hipVel, leg.kneeVel);
    const thighCenter = leg.hip.add(leg.knee).scale(0.5);
    const thighVel = leg.hipVel.add(leg.kneeVel).scale(0.5);

    bodies.push({
      id: `${prefix}_thigh` as ContactBodyId,
      shape: thighShape,
      prevPos: thighCenter.sub(thighVel.scale(safeDt)),
      currPos: thighCenter,
      velocity: thighVel,
      effMass: isLoaded ? SIM_CONFIG.COLLISION.LEG_LOADED_MASS : SIM_CONFIG.COLLISION.THIGH_MASS_SWING,
      restitution: isLoaded ? SIM_CONFIG.COLLISION.FOOT_STANCE_RESTITUTION : 0.35,
      friction: SIM_CONFIG.COLLISION.BOOT_FRICTION,
      loaded: isLoaded,
      active: !isLoaded,
    });

    // B. Shin Capsule (knee -> ankle)
    const shinRadius = SIM_CONFIG.COLLISION.SHIN_RADIUS;
    const shinShape = createInsetCapsule(leg.knee, leg.ankle, shinRadius, leg.kneeVel, leg.ankleVel);
    const shinCenter = leg.knee.add(leg.ankle).scale(0.5);
    const shinVel = leg.kneeVel.add(leg.ankleVel).scale(0.5);

    bodies.push({
      id: `${prefix}_shin` as ContactBodyId,
      shape: shinShape,
      prevPos: shinCenter.sub(shinVel.scale(safeDt)),
      currPos: shinCenter,
      velocity: shinVel,
      effMass: isLoaded ? SIM_CONFIG.COLLISION.LEG_LOADED_MASS : SIM_CONFIG.COLLISION.SHIN_MASS_SWING,
      restitution: isLoaded ? SIM_CONFIG.COLLISION.FOOT_STANCE_RESTITUTION : 0.40,
      friction: SIM_CONFIG.COLLISION.BOOT_FRICTION,
      loaded: isLoaded,
      active: !isLoaded,
    });

    // C. Boot Capsule (heel -> toe)
    const bootRadius = SIM_CONFIG.COLLISION.BOOT_RADIUS;
    const override = isRight ? overrideRightBoot : overrideLeftBoot;

    let bootShape: CapsuleShape;
    let bootCenter: Vector3;
    let bootVel: Vector3;
    let bootYaw = leg.bootYaw;
    let bootPitch = leg.bootPitch;
    let ankleStiffness = 0.5;

    if (override) {
      bootShape = {
        type: 'capsule',
        p1: override.p1,
        p2: override.p2,
        radius: bootRadius,
        v1: override.v1,
        v2: override.v2,
      };
      bootCenter = override.p1.add(override.p2).scale(0.5);
      bootVel = override.v1.add(override.v2).scale(0.5);
      bootYaw = override.bootYaw;
      bootPitch = override.bootPitch;
      ankleStiffness = override.ankleStiffness;
    } else {
      bootShape = createInsetCapsule(leg.heel, leg.toe, bootRadius, leg.heelVel, leg.toeVel);
      bootCenter = leg.heel.add(leg.toe).scale(0.5);
      bootVel = leg.heelVel.add(leg.toeVel).scale(0.5);
    }

    // Ankle stiffness mapping: mass in [1.2, 5.5], restitution in [0.18, 0.65]
    const minMass = SIM_CONFIG.COLLISION.BOOT_MIN_MASS;
    const maxMass = SIM_CONFIG.COLLISION.BOOT_MAX_MASS;
    const minRest = SIM_CONFIG.COLLISION.BOOT_MIN_RESTITUTION;
    const maxRest = SIM_CONFIG.COLLISION.BOOT_MAX_RESTITUTION;

    const swingBootMass = minMass + ankleStiffness * (maxMass - minMass);
    const swingBootRest = minRest + ankleStiffness * (maxRest - minRest);

    const bootBody: ContactBody = {
      id: `${prefix}_boot` as ContactBodyId,
      shape: bootShape,
      prevPos: bootCenter.sub(bootVel.scale(safeDt)),
      currPos: bootCenter,
      velocity: bootVel,
      effMass: isLoaded ? SIM_CONFIG.COLLISION.LEG_LOADED_MASS : swingBootMass,
      restitution: isLoaded ? SIM_CONFIG.COLLISION.FOOT_STANCE_RESTITUTION : swingBootRest,
      friction: SIM_CONFIG.COLLISION.BOOT_FRICTION,
      loaded: isLoaded,
      active: !isLoaded,
      bootYaw,
      bootPitch,
      isRightFoot: isRight,
      ankleStiffness,
    };

    bodies.push(bootBody);
  };

  buildLegBodies(false); // Left leg: thigh, shin, boot
  buildLegBodies(true);  // Right leg: thigh, shin, boot

  return bodies;
}
