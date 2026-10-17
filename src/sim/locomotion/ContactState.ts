import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import { FootContactState, PlayerContactState, PlayerState } from '../types';

const GRAVITY = 9.81;
/** Builds the reduced 3D contact interface from the integrated locomotion state. */
export function buildPlayerContactState(
  state: PlayerState,
  verticalOffset: number,
  verticalVelocity: number,
  verticalAcceleration: number,
  dt: number,
  previous?: PlayerState,
  planarAcceleration: Vector2 = Vector2.zero()
): PlayerContactState {
  const { stride, attributes } = state;
  const leftLoaded = stride.isDoubleSupport || (stride.phase === 'stance' && stride.currentFoot === 'left');
  const rightLoaded = stride.isDoubleSupport || (stride.phase === 'stance' && stride.currentFoot === 'right');
  const supportCount = Number(leftLoaded) + Number(rightLoaded);
  const totalNormalLoad = supportCount > 0
    ? Math.max(0, attributes.weightKg * (GRAVITY + verticalAcceleration))
    : 0;
  let leftLoadShare = 0;
  let rightLoadShare = 0;
  if (supportCount === 1) {
    leftLoadShare = leftLoaded ? 1 : 0;
    rightLoadShare = rightLoaded ? 1 : 0;
  } else if (supportCount === 2) {
    const isWalkingTransfer = stride.phase === 'stance' && stride.isDoubleSupport &&
      state.velocity.length() >= 0.15;
    if (isWalkingTransfer) {
      const overlap = SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION;
      const transfer = Math.max(0, Math.min(1,
        (stride.phaseProgress - (1 - overlap)) / overlap
      ));
      const smoothTransfer = transfer * transfer * (3 - 2 * transfer);
      const leadingFootShare = smoothTransfer;
      if (stride.currentFoot === 'left') {
        leftLoadShare = 1 - leadingFootShare;
        rightLoadShare = leadingFootShare;
      } else {
        rightLoadShare = 1 - leadingFootShare;
        leftLoadShare = leadingFootShare;
      }
    } else {
      leftLoadShare = 0.5;
      rightLoadShare = 0.5;
    }
  }

  const swingProgress = stride.phase === 'flight'
    ? stride.phaseProgress
    : Math.min(1, stride.phaseProgress / Math.max(0.01, 1 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION));

  const makeFoot = (foot: 'left' | 'right', inContact: boolean): FootContactState => {
    const xy = foot === 'left' ? stride.leftFootPos : stride.rightFootPos;
    const previousXY = previous
      ? (foot === 'left' ? previous.stride.leftFootPos : previous.stride.rightFootPos)
      : xy;
    const isSlipping = inContact && state.slipStatus.type !== 'none' &&
      (state.slipStatus.slipFoot === foot || state.slipStatus.type === 'wipeout' || state.slipStatus.type === 'controlled_slide');
    const planarVelocity = inContact && !isSlipping
      ? { x: 0, y: 0 }
      : isSlipping
        ? { x: state.slipStatus.skidVelocity.x, y: state.slipStatus.skidVelocity.y }
        : { x: (xy.x - previousXY.x) / Math.max(dt, 1e-5), y: (xy.y - previousXY.y) / Math.max(dt, 1e-5) };
    const swingZ = inContact
      ? 0
      : SIM_CONFIG.COLLISION.FOOT_SWING_MAX_Z * 4 * swingProgress * (1 - swingProgress);
    const previousProgress = previous?.stride.phaseProgress ?? stride.phaseProgress;
    const vz = inContact
      ? 0
      : SIM_CONFIG.COLLISION.FOOT_SWING_MAX_Z * 4 * (1 - 2 * swingProgress) *
        ((stride.phaseProgress - previousProgress) / Math.max(dt, 1e-5));

    return {
      position: new Vector3(xy.x, xy.y, SIM_CONFIG.COLLISION.FOOT_STANCE_Z + swingZ),
      velocity: new Vector3(planarVelocity.x, planarVelocity.y, vz),
      inContact,
      isSlipping,
      phase: inContact ? 'stance' : 'flight',
      phaseProgress: stride.phaseProgress,
      normalLoadN: inContact
        ? totalNormalLoad * (foot === 'left' ? leftLoadShare : rightLoadShare)
        : 0,
    };
  };

  const leftFoot = makeFoot('left', leftLoaded);
  const rightFoot = makeFoot('right', rightLoaded);
  let supportMarginM = -0.05;
  if (supportCount > 0) {
    const supportX = (leftLoaded ? leftFoot.position.x : 0) + (rightLoaded ? rightFoot.position.x : 0);
    const supportY = (leftLoaded ? leftFoot.position.y : 0) + (rightLoaded ? rightFoot.position.y : 0);
    const cx = supportX / supportCount;
    const cy = supportY / supportCount;
    const supportRadius = supportCount === 2 ? stride.stanceWidth * 0.5 + 0.06 : 0.11;
    supportMarginM = supportRadius - Math.hypot(state.position.x - cx, state.position.y - cy);
  }

  const baseComHeight = attributes.heightCm / 100 * SIM_CONFIG.PLAYER_BODY.COM_HEIGHT_RATIO;
  return {
    centerOfMass: new Vector3(state.position.x, state.position.y, baseComHeight + verticalOffset),
    centerOfMassVelocity: new Vector3(state.velocity.x, state.velocity.y, verticalVelocity),
    centerOfMassAcceleration: new Vector3(planarAcceleration.x, planarAcceleration.y, verticalAcceleration),
    supportMarginM,
    isSupported: supportCount > 0,
    leftFoot,
    rightFoot,
  };
}
