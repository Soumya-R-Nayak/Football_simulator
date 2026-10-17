import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { getPlayerLegDimensions, SIM_CONFIG } from '../config';
import { PlayerState } from '../types';

export interface LegJointPose {
  readonly hip: Vector3;
  readonly knee: Vector3;
  readonly ankle: Vector3;
  readonly heel: Vector3;
  readonly toe: Vector3;
  readonly bootYaw: number;
  readonly bootPitch: number;
  readonly loaded: boolean;
  readonly hipVel: Vector3;
  readonly kneeVel: Vector3;
  readonly ankleVel: Vector3;
  readonly heelVel: Vector3;
  readonly toeVel: Vector3;
}

export interface PlayerLegPoses {
  readonly left: LegJointPose;
  readonly right: LegJointPose;
}

interface RawJointPositions {
  readonly hip: Vector3;
  readonly knee: Vector3;
  readonly ankle: Vector3;
  readonly heel: Vector3;
  readonly toe: Vector3;
  readonly bootYaw: number;
  readonly bootPitch: number;
  readonly loaded: boolean;
}

/**
 * Evaluates the 2-bone IK leg chain and foot position at normalized tick fraction tFrac in [0, 1].
 * Interpolates foot position between prevState and currState stride foot positions (plus parabolic vertical z-arc).
 */
function evaluateRawPoseAt(
  prevState: PlayerState,
  currState: PlayerState,
  tFrac: number,
  dt: number
): { left: RawJointPositions; right: RawJointPositions } {
  // Continuous COM position and facing interpolated between prevState and currState
  const clampedT = Math.max(0, Math.min(1.0, tFrac));
  const playerPos2D = prevState.position.scale(1 - clampedT).add(currState.position.scale(clampedT));
  const facing = prevState.facing + (currState.facing - prevState.facing) * clampedT;

  const legDimensions = getPlayerLegDimensions(currState.attributes.heightCm);
  const hipHeight = legDimensions.hipHeight;
  const hipOffsetY = legDimensions.hipOffsetY;
  const thighLen = legDimensions.thighLength;
  const shinLen = legDimensions.shinLength;
  const footStanceZ = SIM_CONFIG.COLLISION.FOOT_STANCE_Z;
  const footSwingMaxZ = SIM_CONFIG.COLLISION.FOOT_SWING_MAX_Z;

  const fwdVec = Vector3.fromVector2(Vector2.fromAngle(facing), 0);
  const latVec = Vector3.fromVector2(Vector2.fromAngle(facing + Math.PI / 2), 0);

  const getFootXY = (isLeft: boolean): Vector2 => {
    const prevContact = prevState.contactState && (isLeft ? prevState.contactState.leftFoot : prevState.contactState.rightFoot);
    const currContact = currState.contactState && (isLeft ? currState.contactState.leftFoot : currState.contactState.rightFoot);
    const prevFoot = prevContact
      ? new Vector2(prevContact.position.x, prevContact.position.y)
      : (isLeft ? prevState.stride.leftFootPos : prevState.stride.rightFootPos);
    const currFoot = currContact
      ? new Vector2(currContact.position.x, currContact.position.y)
      : (isLeft ? currState.stride.leftFootPos : currState.stride.rightFootPos);
    return prevFoot.scale(1 - clampedT).add(currFoot.scale(clampedT));
  };

  // Determine loaded state
  let leftLoaded = false;
  let rightLoaded = false;

  const activeStride = currState.stride;

  if (currState.contactState) {
    leftLoaded = currState.contactState.leftFoot.inContact;
    rightLoaded = currState.contactState.rightFoot.inContact;
  } else if (activeStride.isDoubleSupport) {
    leftLoaded = true;
    rightLoaded = true;
  } else if (activeStride.phase === 'flight') {
    leftLoaded = false;
    rightLoaded = false;
  } else {
    if (activeStride.currentFoot === 'left') {
      leftLoaded = true;
      rightLoaded = false;
    } else {
      leftLoaded = false;
      rightLoaded = true;
    }
  }

  // The pelvis is not rigidly fixed to the COM marker. During support, allow a
  // small shared translation toward the support base. This keeps the hip joints
  // from reaching full leg extension while leaving the planted foot anchor
  // untouched and preserving a single coherent pelvis for both legs.
  const supportFeet = [
    ...(leftLoaded ? [getFootXY(true)] : []),
    ...(rightLoaded ? [getFootXY(false)] : []),
  ];
  const supportCenter = supportFeet.length > 0
    ? supportFeet.reduce((sum, foot) => sum.add(foot), Vector2.zero()).scale(1 / supportFeet.length)
    : playerPos2D;
  const pelvisShift = supportCenter.sub(playerPos2D).clampLength(legDimensions.hipTranslationMax);

  // Phase progress across the tick
  let p = (1 - clampedT) * prevState.stride.phaseProgress + clampedT * currState.stride.phaseProgress;
  if (currState.stride.phaseProgress < prevState.stride.phaseProgress) {
    p = clampedT;
  }

  // Helper for single leg IK
  const solveLeg = (isLeft: boolean, loaded: boolean): RawJointPositions => {
    const latSign = isLeft ? -1 : 1;
    const hipPos2D = playerPos2D.add(pelvisShift).add(new Vector2(latVec.x, latVec.y).scale(latSign * hipOffsetY));

    // Stride engine 2D foot position interpolated between prevState and currState
    const prevFootContact = prevState.contactState && (isLeft ? prevState.contactState.leftFoot : prevState.contactState.rightFoot);
    const currFootContact = currState.contactState && (isLeft ? currState.contactState.leftFoot : currState.contactState.rightFoot);
    const prevFootPos2D = prevFootContact
      ? new Vector2(prevFootContact.position.x, prevFootContact.position.y)
      : (isLeft ? prevState.stride.leftFootPos : prevState.stride.rightFootPos);
    const currFootPos2D = currFootContact
      ? new Vector2(currFootContact.position.x, currFootContact.position.y)
      : (isLeft ? currState.stride.leftFootPos : currState.stride.rightFootPos);

    let footPos2D: Vector2;
    if (prevState === currState) {
      // Frozen single state fallback
      const speed = currState.velocity.length();
      const swingAdvance = fwdVec.scale(speed * clampedT * dt);
      footPos2D = loaded ? currFootPos2D : currFootPos2D.add(new Vector2(swingAdvance.x, swingAdvance.y));
    } else {
      footPos2D = prevFootPos2D.scale(1 - clampedT).add(currFootPos2D.scale(clampedT));
    }

    let footZ = footStanceZ;
    let bootPitch = 0;

    if (prevFootContact && currFootContact) {
      footZ = prevFootContact.position.z * (1 - clampedT) + currFootContact.position.z * clampedT;
      bootPitch = loaded ? 0 : -0.38 * Math.sin(p * Math.PI) + 0.24 * Math.pow(Math.max(0, (p - 0.6) / 0.4), 2);
    } else if (loaded) {
      footZ = footStanceZ;
      bootPitch = 0;
    } else {
      // Swing foot: parabolic vertical arc + boot pitch
      footZ = footStanceZ + footSwingMaxZ * 4 * p * (1 - p);
      bootPitch = -0.38 * Math.sin(p * Math.PI) + 0.24 * Math.pow(Math.max(0, (p - 0.6) / 0.4), 2);
    }

    // Dynamic pelvis drop: lower hip joint when foot offset grows horizontally
    const reachMax = thighLen + shinLen - 0.002;
    const reachMin = Math.abs(thighLen - shinLen) + 0.02;
    const dXY = footPos2D.sub(hipPos2D).length();
    const maxZSpan = Math.sqrt(Math.max(0.01, reachMax * reachMax - dXY * dXY));
    const baseComHeight = currState.attributes.heightCm / 100 * SIM_CONFIG.PLAYER_BODY.COM_HEIGHT_RATIO;
    const previousComOffset = prevState.contactState
      ? prevState.contactState.centerOfMass.z - prevState.attributes.heightCm / 100 * SIM_CONFIG.PLAYER_BODY.COM_HEIGHT_RATIO
      : prevState.verticalBounce;
    const currentComOffset = currState.contactState
      ? currState.contactState.centerOfMass.z - baseComHeight
      : currState.verticalBounce;
    const comOffset = previousComOffset * (1 - clampedT) + currentComOffset * clampedT;
    const dynamicHipZ = Math.min(hipHeight + comOffset, footZ + maxZSpan - 0.002);
    const hipPos = new Vector3(hipPos2D.x, hipPos2D.y, dynamicHipZ);

    let anklePos = new Vector3(footPos2D.x, footPos2D.y, footZ);

    // 2-Bone IK to find Knee
    const dVec = anklePos.sub(hipPos);
    const dLen = dVec.length();

    let dClamped = dLen;
    if (dLen > reachMax) {
      dClamped = reachMax;
      anklePos = hipPos.add(dVec.scale(reachMax / dLen));
    } else if (dLen < reachMin) {
      dClamped = reachMin;
      anklePos = hipPos.add(dVec.scale(reachMin / dLen));
    }

    const legAxis = dVec.scale(1 / Math.max(1e-4, dLen));

    // Knee forward plane projection
    let kneePlaneDir = fwdVec.sub(legAxis.scale(fwdVec.dot(legAxis)));
    if (kneePlaneDir.lengthSq() < 1e-4) {
      const downVec = new Vector3(0, 0, -1);
      kneePlaneDir = downVec.sub(legAxis.scale(downVec.dot(legAxis)));
    }
    const kneeNormal = kneePlaneDir.normalize();

    // Law of cosines for thigh angle
    const cosAlpha = Math.max(-1, Math.min(1, (thighLen * thighLen + dClamped * dClamped - shinLen * shinLen) / (2 * thighLen * dClamped)));
    const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

    const kneePos = hipPos.add(legAxis.scale(thighLen * cosAlpha)).add(kneeNormal.scale(thighLen * sinAlpha));

    // Boot Yaw: follows facing
    const bootYaw = facing;

    // Boot orientation vector
    const bootDir = new Vector3(
      Math.cos(bootYaw) * Math.cos(bootPitch),
      Math.sin(bootYaw) * Math.cos(bootPitch),
      Math.sin(bootPitch)
    ).normalize();

    const bootAnkleOffsetHeel = SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_HEEL;
    const bootAnkleOffsetToe = SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_TOE;

    const heelPos = anklePos.sub(bootDir.scale(bootAnkleOffsetHeel));
    const toePos = anklePos.add(bootDir.scale(bootAnkleOffsetToe));

    return {
      hip: hipPos,
      knee: kneePos,
      ankle: anklePos,
      heel: heelPos,
      toe: toePos,
      bootYaw,
      bootPitch,
      loaded,
    };
  };

  return {
    left: solveLeg(true, leftLoaded),
    right: solveLeg(false, rightLoaded),
  };
}

/**
 * Returns complete 3D kinematic joint poses and velocities for both legs at normalized tick fraction tFrac.
 * Joint velocities are evaluated via central difference of the analytic pose function (eps = 1e-4 s).
 */
export function poseAt(
  prevState: PlayerState,
  currState: PlayerState,
  tFrac?: number,
  dt?: number
): PlayerLegPoses;
export function poseAt(
  player: PlayerState,
  tFrac?: number,
  dt?: number
): PlayerLegPoses;
export function poseAt(
  arg1: PlayerState,
  arg2?: PlayerState | number,
  arg3?: number,
  arg4?: number
): PlayerLegPoses {
  let prevState: PlayerState;
  let currState: PlayerState;
  let tFrac: number;
  let dt: number;

  if (typeof arg2 === 'object' && arg2 !== null) {
    prevState = arg1;
    currState = arg2;
    tFrac = arg3 ?? 1.0;
    dt = arg4 ?? SIM_CONFIG.LOOP.FIXED_DT;
  } else {
    prevState = arg1;
    currState = arg1;
    tFrac = (typeof arg2 === 'number' ? arg2 : 1.0);
    dt = arg3 ?? SIM_CONFIG.LOOP.FIXED_DT;
  }

  const safeDt = Math.max(1e-4, dt);
  const epsSec = 1e-4; // 100 microseconds for exact central difference
  const epsFrac = epsSec / safeDt;

  const current = evaluateRawPoseAt(prevState, currState, tFrac, safeDt);
  const forward = evaluateRawPoseAt(prevState, currState, tFrac + epsFrac, safeDt);
  const backward = evaluateRawPoseAt(prevState, currState, tFrac - epsFrac, safeDt);

  const denom = 2 * epsSec;

  const diffVel = (pForward: Vector3, pBackward: Vector3, loaded: boolean): Vector3 => {
    if (loaded) return Vector3.zero();
    return pForward.sub(pBackward).scale(1 / denom);
  };

  return {
    left: {
      hip: current.left.hip,
      knee: current.left.knee,
      ankle: current.left.ankle,
      heel: current.left.heel,
      toe: current.left.toe,
      bootYaw: current.left.bootYaw,
      bootPitch: current.left.bootPitch,
      loaded: current.left.loaded,
      hipVel: forward.left.hip.sub(backward.left.hip).scale(1 / denom),
      kneeVel: diffVel(forward.left.knee, backward.left.knee, current.left.loaded),
      ankleVel: diffVel(forward.left.ankle, backward.left.ankle, current.left.loaded),
      heelVel: diffVel(forward.left.heel, backward.left.heel, current.left.loaded),
      toeVel: diffVel(forward.left.toe, backward.left.toe, current.left.loaded),
    },
    right: {
      hip: current.right.hip,
      knee: current.right.knee,
      ankle: current.right.ankle,
      heel: current.right.heel,
      toe: current.right.toe,
      bootYaw: current.right.bootYaw,
      bootPitch: current.right.bootPitch,
      loaded: current.right.loaded,
      hipVel: forward.right.hip.sub(backward.right.hip).scale(1 / denom),
      kneeVel: diffVel(forward.right.knee, backward.right.knee, current.right.loaded),
      ankleVel: diffVel(forward.right.ankle, backward.right.ankle, current.right.loaded),
      heelVel: diffVel(forward.right.heel, backward.right.heel, current.right.loaded),
      toeVel: diffVel(forward.right.toe, backward.right.toe, current.right.loaded),
    },
  };
}
