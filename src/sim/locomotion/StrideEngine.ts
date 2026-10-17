import { Vector2 } from '../../math/Vector2';
import { getPlayerLegDimensions, SIM_CONFIG } from '../config';
import { FootId, StridePhase, StrideState } from '../types';

/**
 * Biomechanical Stride Engine simulating:
 * - Discrete alternating footsteps with stance & ballistic flight phases
 * - Realistic cadences (walk, jog, sprint, jockey, backpedal)
 * - Fluid curved running during diagonal steering (WD <-> WA)
 * - Mediolateral COM sway and impact braking dip
 * - The "Drop Step" (false-step start on sudden burst from rest)
 * - Outside vs. inside foot turn asymmetry (check step vs. plant-and-cut)
 * - Pelvic yaw rotation
 */
export class StrideEngine {
  private currentFoot: FootId = 'left';
  private phase: StridePhase = 'stance';
  private phaseProgress: number = 0; // 0.0 to 1.0 within current phase
  private plantPosition: Vector2 | null = null;
  private leftFootPos: Vector2 = Vector2.zero();
  private rightFootPos: Vector2 = Vector2.zero();
  private stanceSwingStartPos: Vector2 | null = null;
  private flightStartLeftFootPos: Vector2 | null = null;
  private flightStartRightFootPos: Vector2 | null = null;
  private isBraking: boolean = false;
  private chopStepsRemaining: number = 0;
  private pelvicAngle: number = 0;
  private lateralSway: number = 0;
  private isDropStep: boolean = false;
  private dropStepTimer: number = 0;
  private isDoubleSupport: boolean = false;
  private isWalkingMode: boolean = true;
  private heightCm: number = 180;
  private balance: number = 80;

  constructor(initialPos: Vector2, initialFacing: number) {
    this.updateFootRestPositions(initialPos, initialFacing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);
    this.stanceSwingStartPos = this.rightFootPos.clone();
  }

  setHeightCm(height: number): void {
    this.heightCm = Math.max(140, Math.min(220, height));
  }

  getHeightCm(): number {
    return this.heightCm;
  }

  setBalance(balance: number): void {
    this.balance = Math.max(0, Math.min(100, balance));
  }

  getBalance(): number {
    return this.balance;
  }

  private updateFootRestPositions(playerPos: Vector2, facing: number, stanceWidth: number): void {
    const halfWidth = stanceWidth / 2;
    const rightVec = Vector2.fromAngle(facing + Math.PI / 2);
    this.leftFootPos = playerPos.add(rightVec.scale(-halfWidth));
    this.rightFootPos = playerPos.add(rightVec.scale(halfWidth));
  }

  getState(): StrideState {
    return {
      currentFoot: this.currentFoot,
      phase: this.phase,
      phaseProgress: this.phaseProgress,
      cadence: 0,
      strideLength: 0,
      plantPosition: this.plantPosition ? this.plantPosition.clone() : null,
      stanceWidth: SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL,
      leftFootPos: this.leftFootPos.clone(),
      rightFootPos: this.rightFootPos.clone(),
      isBraking: this.isBraking,
      chopStepsRemaining: this.chopStepsRemaining,
      pelvicAngle: this.pelvicAngle,
      lateralSway: this.lateralSway,
      isDropStep: this.isDropStep,
      isDoubleSupport: this.isDoubleSupport,
    };
  }

  step(
    dt: number,
    speed: number,
    isDemandingMove: boolean,
    isDemandingBrake: boolean,
    playerPos: Vector2,
    facing: number,
    moveAngleDiff: number = 0,
    signedTurnAngle: number = 0,
    isHoldingFacing: boolean = false,
    comVelocity: Vector2 = Vector2.zero(),
    comAcceleration: Vector2 = Vector2.zero()
  ): {
    forceMultiplier: number;
    lateralSwayAcc: Vector2;
    isBrakingPlant: boolean;
    verticalBounce: number;
    strideState: StrideState;
  } {
    // If stopped and not demanding movement: reset to neutral stance
    if (speed < 0.15 && !isDemandingMove) {
      this.phase = 'stance';
      this.phaseProgress = 1.0;
      this.plantPosition = null;
      this.isBraking = false;
      this.chopStepsRemaining = 0;
      this.pelvicAngle = 0;
      this.lateralSway = 0;
      this.isDropStep = false;
      this.dropStepTimer = 0;
      this.isDoubleSupport = true;
      this.isWalkingMode = true;
      this.updateFootRestPositions(playerPos, facing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);
      this.stanceSwingStartPos = (this.currentFoot === 'left' ? this.rightFootPos : this.leftFootPos).clone();

      return {
        forceMultiplier: 0,
        lateralSwayAcc: Vector2.zero(),
        isBrakingPlant: false,
        verticalBounce: 0,
        strideState: {
          ...this.getState(),
          cadence: 0,
          strideLength: 0,
        },
      };
    }

    // 1. The "Drop Step" (False-Step Start from rest)
    if (speed < 0.15 && isDemandingMove && !this.isDropStep && this.dropStepTimer <= 0) {
      this.isDropStep = true;
      this.dropStepTimer = SIM_CONFIG.STRIDE.DROP_STEP_DURATION;
    }

    if (this.dropStepTimer > 0) {
      this.dropStepTimer -= dt;
      if (this.dropStepTimer <= 0) {
        this.isDropStep = false;
      }
    }

    // 2. Identify Gait & Movement Modes
    const isBackpedal = moveAngleDiff > (3 * Math.PI) / 4;
    const isJockey =
      isHoldingFacing &&
      moveAngleDiff > Math.PI / 4 &&
      moveAngleDiff <= (3 * Math.PI) / 4;

    let cadence: number;
    let strideLength = 0;
    let swingStrideLength: number;
    let swayAmp: number;
    let yawAmp: number;
    let activeStanceWidth: number;

    if (isBackpedal) {
      cadence = SIM_CONFIG.STRIDE.CADENCE_BACKPEDAL;
      strideLength = SIM_CONFIG.STRIDE.STRIDE_LEN_BACKPEDAL;
      swingStrideLength = strideLength;
      swayAmp = SIM_CONFIG.STRIDE.SWAY_WALK * 0.5;
      yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK * 0.4;
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL;
    } else if (isJockey) {
      cadence = SIM_CONFIG.STRIDE.CADENCE_JOCKEY;
      strideLength = SIM_CONFIG.STRIDE.STRIDE_LEN_JOCKEY;
      swingStrideLength = strideLength;
      swayAmp = SIM_CONFIG.STRIDE.SWAY_JOCKEY;
      yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK * 0.5;
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_JOCKEY;
    } else {
      // Natural forward and diagonal curved running (WD <-> WA maintains cadence and stance)
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL;

      if (speed <= SIM_CONFIG.GAIT_SPEEDS.walk) {
        const t = Math.max(0, speed / SIM_CONFIG.GAIT_SPEEDS.walk);
        // Fast walking uses a higher cadence to keep the stance leg from
        // trailing excessively at the configured walking speed ceiling.
        cadence = 1.5 + (SIM_CONFIG.STRIDE.CADENCE_WALK - 1.5) * t + 0.5 * t * t;
        swingStrideLength = 0.5 + (SIM_CONFIG.STRIDE.STRIDE_LEN_WALK - 0.5) * t;
        swayAmp = SIM_CONFIG.STRIDE.SWAY_WALK;
        yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK;
      } else if (speed <= SIM_CONFIG.GAIT_SPEEDS.run) {
        const t =
          (speed - SIM_CONFIG.GAIT_SPEEDS.walk) /
          (SIM_CONFIG.GAIT_SPEEDS.run - SIM_CONFIG.GAIT_SPEEDS.walk);
        cadence =
          SIM_CONFIG.STRIDE.CADENCE_WALK +
          (SIM_CONFIG.STRIDE.CADENCE_RUN - SIM_CONFIG.STRIDE.CADENCE_WALK) * t;
        // Fade the fast-walk cadence boost out smoothly before the walk-to-run
        // transition, avoiding a step-rate cliff at 1.6 m/s without retuning jog.
        const transitionEnd = SIM_CONFIG.STRIDE.WALK_TO_RUN_SPEED + 0.15;
        if (speed < transitionEnd) {
          const transitionT = Math.max(0, Math.min(1,
            (speed - SIM_CONFIG.GAIT_SPEEDS.walk) /
              (transitionEnd - SIM_CONFIG.GAIT_SPEEDS.walk)
          ));
          const smoothFade = 1 - transitionT * transitionT * (3 - 2 * transitionT);
          cadence += 0.5 * smoothFade;
        }
        swingStrideLength =
          SIM_CONFIG.STRIDE.STRIDE_LEN_WALK +
          (SIM_CONFIG.STRIDE.STRIDE_LEN_JOG - SIM_CONFIG.STRIDE.STRIDE_LEN_WALK) * t;
        swayAmp =
          SIM_CONFIG.STRIDE.SWAY_WALK +
          (SIM_CONFIG.STRIDE.SWAY_JOG - SIM_CONFIG.STRIDE.SWAY_WALK) * t;
        yawAmp =
          SIM_CONFIG.STRIDE.PELVIC_YAW_WALK +
          (SIM_CONFIG.STRIDE.PELVIC_YAW_JOG - SIM_CONFIG.STRIDE.PELVIC_YAW_WALK) * t;
      } else {
        const t = Math.min(
          1.0,
          (speed - SIM_CONFIG.GAIT_SPEEDS.run) /
            (SIM_CONFIG.GAIT_SPEEDS.sprint - SIM_CONFIG.GAIT_SPEEDS.run)
        );
        cadence =
          SIM_CONFIG.STRIDE.CADENCE_RUN +
          (SIM_CONFIG.STRIDE.CADENCE_SPRINT - SIM_CONFIG.STRIDE.CADENCE_RUN) * t;
        swingStrideLength =
          SIM_CONFIG.STRIDE.STRIDE_LEN_JOG +
          (SIM_CONFIG.STRIDE.STRIDE_LEN_SPRINT - SIM_CONFIG.STRIDE.STRIDE_LEN_JOG) * t;
        swayAmp =
          SIM_CONFIG.STRIDE.SWAY_JOG +
          (SIM_CONFIG.STRIDE.SWAY_SPRINT - SIM_CONFIG.STRIDE.SWAY_JOG) * t;
        yawAmp =
          SIM_CONFIG.STRIDE.PELVIC_YAW_JOG +
          (SIM_CONFIG.STRIDE.PELVIC_YAW_SPRINT - SIM_CONFIG.STRIDE.PELVIC_YAW_JOG) * t;
      }
    }

    // Modulate lateral sway and pelvic yaw by player dynamic balance:
    // High balance (100) -> 0.75x tight pelvic corridor; Low balance (0) -> 1.35x loose torso wobble
    const balFactor = Math.max(0, Math.min(1.0, this.balance / 100));
    const swayBalScale = 1.35 - 0.60 * balFactor;
    swayAmp *= swayBalScale;
    const yawBalScale = 1.25 - 0.40 * balFactor;
    yawAmp *= yawBalScale;

    // Scale cadence inversely with leg length, then derive step length from v = f * L.
    // This keeps foot-contact spacing consistent with the player's actual speed.
    const legScale = Math.sqrt(this.heightCm / 180);
    cadence /= legScale;
    if (isBackpedal || isJockey) {
      strideLength *= legScale;
      swingStrideLength = strideLength;
    } else {
      swingStrideLength *= legScale;
    }

    // Step duration & phase partitioning (cadence is defined in config as steps per second / Hz)
    const stepDuration = 1 / cadence;
    const speedRatio = Math.min(1.0, speed / SIM_CONFIG.GAIT_SPEEDS.sprint);
    // Avoid frame-to-frame gait switching when acceleration noise straddles the
    // walk/run boundary. A little hysteresis keeps the contact sequence stable.
    const gaitHysteresis = 0.12;
    if (this.isWalkingMode && speed >= SIM_CONFIG.STRIDE.WALK_TO_RUN_SPEED + gaitHysteresis) {
      this.isWalkingMode = false;
    } else if (!this.isWalkingMode && speed <= SIM_CONFIG.STRIDE.WALK_TO_RUN_SPEED - gaitHysteresis) {
      this.isWalkingMode = true;
    }
    const isWalking = this.isWalkingMode;

    // Predict the COM at the next foot contact. Foot placement is defined from
    // that future position, rather than as a fraction of stride length from the
    // current COM; long strides therefore cannot create implausible overreach.
    const travelDir = comVelocity.lengthSq() > 0.04
      ? comVelocity.normalize()
      : Vector2.fromAngle(facing);
    const forwardAcceleration = comAcceleration.dot(travelDir);
    const accelerationReach = Math.min(1, Math.max(0, forwardAcceleration) / 4);
    const brakingReach = Math.min(1, Math.max(0, -forwardAcceleration) / 5);
    // Center each foot's loaded interval around the COM's passage over it. A
    // fixed short lead left the foot too far behind the COM at walk toe-off.
    const speedLead = Math.max(0, speed - SIM_CONFIG.GAIT_SPEEDS.walk) * 0.04;
    const touchdownOffset =
      Math.max(0.30, (speed / Math.max(0.1, cadence)) * 0.5) + 0.12 +
      speedLead - 0.05 * accelerationReach + 0.18 * brakingReach + (isDemandingBrake ? 0.04 : 0);
    // Derive a conservative horizontal COM-to-foot envelope from the actual
    // height-scaled hip and two-bone leg dimensions.
    const legDimensions = getPlayerLegDimensions(this.heightCm);
    const maxLegReach = legDimensions.thighLength + legDimensions.shinLength - 0.01;
    const lowestHipHeight = legDimensions.hipHeight + SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_MIN_OFFSET;
    const verticalLegSpan = Math.max(0.05, lowestHipHeight - SIM_CONFIG.COLLISION.FOOT_STANCE_Z);
    // Leave a small reserve inside the full-extension IK envelope. This limits
    // foot plants relative to the COM rather than allowing the stance leg to
    // reach its geometric limit and forcing the pelvis down to preserve contact.
    const maxHorizontalReach = Math.min(legDimensions.scale * 0.50, Math.sqrt(Math.max(
      0.04,
      maxLegReach * maxLegReach - verticalLegSpan * verticalLegSpan
    )) * 0.98 + legDimensions.hipTranslationMax * 0.75);
    const constrainFootTarget = (target: Vector2, predictedCom: Vector2): Vector2 => {
      const relative = target.sub(predictedCom);
      const maxReach = Math.min(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH * legDimensions.scale, maxHorizontalReach);
      return predictedCom.add(relative.clampLength(maxReach));
    };
    const predictCom = (seconds: number): Vector2 => {
      const t = Math.max(0, Math.min(0.8, seconds));
      const boundedAcceleration = comAcceleration.clampLength(8);
      return playerPos.add(comVelocity.scale(t)).add(boundedAcceleration.scale(0.5 * t * t));
    };

    let stanceDuration = 0;
    let flightDuration = 0;
    let currentPhaseDuration = 0;

    if (isWalking) {
      // Inverted Pendulum Walk: No flight phase!
      // Step cycle consists of single support and double-support overlap
      if (this.phase === 'flight') {
        // If speed drops through the walk/run boundary mid-flight, end flight on
        // the lead foot already in motion instead of reclassifying the trail foot
        // as planted. This keeps the contact order and foot positions continuous.
        this.currentFoot = this.currentFoot === 'left' ? 'right' : 'left';
        this.plantPosition = (this.currentFoot === 'left' ? this.leftFootPos : this.rightFootPos).clone();
        this.stanceSwingStartPos = (this.currentFoot === 'left' ? this.rightFootPos : this.leftFootPos).clone();
        this.phaseProgress = 0;
      }
      currentPhaseDuration = stepDuration;
      stanceDuration = stepDuration;
      flightDuration = 0;
      this.phase = 'stance';

      this.phaseProgress += dt / currentPhaseDuration;
      this.isDoubleSupport = this.phaseProgress >= (1.0 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION);
    } else {
      // Spring-Mass Running: Stance phase followed by true ballistic flight
      this.isDoubleSupport = false;
      const stanceRatio = 0.58 - 0.20 * speedRatio;
      stanceDuration = Math.max(SIM_CONFIG.STRIDE.CONTACT_TIME_MIN, stepDuration * stanceRatio);

      // Outside-Foot vs Inside-Foot Turn Asymmetry on Sharp Cuts
      if (Math.abs(signedTurnAngle) > 0.65 && speed > 2.5) {
        const isTurningRight = signedTurnAngle > 0;
        const isInsideFootStance =
          (isTurningRight && this.currentFoot === 'right') ||
          (!isTurningRight && this.currentFoot === 'left');

        if (isInsideFootStance && this.phase === 'stance') {
          stanceDuration = Math.max(0.07, stanceDuration * 0.65);
        }
      }

      flightDuration = Math.max(0.035, stepDuration - stanceDuration);
      currentPhaseDuration = this.phase === 'stance' ? stanceDuration : flightDuration;
      this.phaseProgress += dt / currentPhaseDuration;
    }

    // Phase boundaries land on fixed simulation ticks, so the realized contact
    // rate differs slightly from the requested cadence. Report that realized
    // rate and derive the COM step distance from it.
    const ticksFor = (duration: number): number => Math.max(1, Math.ceil(duration / dt - 1e-9));
    const realizedStepDuration = isWalking
      ? ticksFor(stepDuration) * dt
      : (ticksFor(stanceDuration) + ticksFor(flightDuration)) * dt;
    cadence = 1 / realizedStepDuration;
    if (!isBackpedal && !isJockey) {
      strideLength = speed / cadence;
    }

    // Chop-step braking detection
    if (isDemandingBrake && this.chopStepsRemaining === 0 && speed > 2.0) {
      this.chopStepsRemaining = speed > 6.0 ? 3 : speed > 3.5 ? 2 : 1;
      this.isBraking = true;
    }

    let isBrakingPlant = false;

    // Phase transition
    if (this.phaseProgress >= 1.0) {
      this.phaseProgress = 0;

      if (isWalking) {
        // Walking foot transition: trailing foot lifts off, leading foot becomes stance foot
        this.currentFoot = this.currentFoot === 'left' ? 'right' : 'left';
        this.isDoubleSupport = false;
        // The incoming foot already has a world-space swing trajectory. Anchor it
        // where it arrived instead of teleporting it to a newly computed target.
        this.plantPosition = (this.currentFoot === 'left' ? this.leftFootPos : this.rightFootPos).clone();
        this.stanceSwingStartPos = (this.currentFoot === 'left' ? this.rightFootPos : this.leftFootPos).clone();
      } else {
        // Running phase transition: Stance <-> Flight
        if (this.phase === 'stance') {
          // Keep both feet continuous at toe-off. The previous implementation
          // rebuilt them from COM-relative offsets on the first flight frame,
          // moving the planted foot several centimetres in one simulation tick.
          this.flightStartLeftFootPos = this.leftFootPos.clone();
          this.flightStartRightFootPos = this.rightFootPos.clone();
          this.phase = 'flight';
          this.plantPosition = null;
        } else {
          this.phase = 'stance';
          this.currentFoot = this.currentFoot === 'left' ? 'right' : 'left';

          if (this.chopStepsRemaining > 0) {
            isBrakingPlant = true;
            this.chopStepsRemaining--;
            if (this.chopStepsRemaining === 0) {
              this.isBraking = false;
            }
          }

          // Contact occurs at the foot's current trajectory endpoint. Reusing that
          // point preserves continuity and makes the stance anchor truly fixed.
          this.plantPosition = (this.currentFoot === 'left' ? this.leftFootPos : this.rightFootPos).clone();
          this.stanceSwingStartPos = (this.currentFoot === 'left' ? this.rightFootPos : this.leftFootPos).clone();
        }
      }
    }

    // Update foot visuals
    if (isWalking) {
      const halfWidth = activeStanceWidth / 2;
      const otherSign = this.currentFoot === 'left' ? 1 : -1;
      const rightVec = Vector2.fromAngle(facing + Math.PI / 2);

      if (this.isDoubleSupport) {
        // Both positions were fixed at their contact events. Keep both anchors
        // stationary throughout double support instead of dragging them with COM.
      } else {
        // Single support: swing foot travelling forward past stance foot
        const swingProgress = Math.min(
          1.0,
          this.phaseProgress / (1.0 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION)
        );
        const contactTime = stepDuration * Math.max(
          0,
          1 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION - this.phaseProgress
        );
        const predictedCom = predictCom(contactTime);
        const swingTarget = constrainFootTarget(
          predictedCom
            .add(rightVec.scale(otherSign * halfWidth))
            .add(travelDir.scale(touchdownOffset)),
          predictedCom
        );
        const easedProgress = swingProgress * swingProgress * (3 - 2 * swingProgress);
        const swingStart = this.stanceSwingStartPos ?? swingTarget;
        const swingPos = swingStart.add(swingTarget.sub(swingStart).scale(easedProgress));
        if (this.currentFoot === 'left') {
          this.rightFootPos = swingPos;
        } else {
          this.leftFootPos = swingPos;
        }
      }
    } else if (this.phase === 'stance') {
      // Running / sprinting stance: swing foot travels forward continuously
      const halfWidth = activeStanceWidth / 2;
      const otherSign = this.currentFoot === 'left' ? 1 : -1;
      const rightVec = Vector2.fromAngle(facing + Math.PI / 2);

      // During stance, bring the swing leg to a compact toe-off position. It
      // should not already be at the landing point beyond the upcoming flight.
      const timeToContact = Math.max(0, stanceDuration * (1 - this.phaseProgress));
      const predictedCom = predictCom(timeToContact);
      const swingTarget = constrainFootTarget(
        predictedCom
          .add(rightVec.scale(otherSign * halfWidth))
          .add(travelDir.scale(touchdownOffset)),
        predictedCom
      );
      const p = this.phaseProgress;
      const easedProgress = p * p * (3 - 2 * p);
      const swingStart = this.stanceSwingStartPos ?? swingTarget;
      const swingPos = swingStart.add(swingTarget.sub(swingStart).scale(easedProgress));

      if (this.currentFoot === 'left') {
        this.rightFootPos = swingPos;
      } else {
        this.leftFootPos = swingPos;
      }
    } else if (this.phase === 'flight') {
      const halfWidth = activeStanceWidth / 2;
      const rightVec = Vector2.fromAngle(facing + Math.PI / 2);
      const forwardVec = Vector2.fromAngle(facing);

      // In flight, currentFoot just pushed off (trail foot), other foot is lead reaching forward
      const timeToContact = flightDuration * Math.max(0, 1 - this.phaseProgress);
      const predictedCom = predictCom(timeToContact);
      const leadTarget = constrainFootTarget(
        predictedCom
          .add(rightVec.scale(this.currentFoot === 'left' ? halfWidth : -halfWidth))
          .add(travelDir.scale(touchdownOffset)),
        predictedCom
      );

      const trailOffset = forwardVec
        .scale(swingStrideLength * (-0.30 + this.phaseProgress * 0.25))
        .clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);

      const trailTargetLeft = playerPos.add(rightVec.scale(-halfWidth)).add(trailOffset);
      const trailTargetRight = playerPos.add(rightVec.scale(halfWidth)).add(trailOffset);
      const targetLeft = this.currentFoot === 'left' ? trailTargetLeft : leadTarget;
      const targetRight = this.currentFoot === 'right' ? trailTargetRight : leadTarget;
      const p = this.phaseProgress;
      const smoothProgress = p * p * (3 - 2 * p);
      const startLeft = this.flightStartLeftFootPos ?? this.leftFootPos;
      const startRight = this.flightStartRightFootPos ?? this.rightFootPos;
      this.leftFootPos = startLeft.add(targetLeft.sub(startLeft).scale(smoothProgress));
      this.rightFootPos = startRight.add(targetRight.sub(startRight).scale(smoothProgress));
    }

    // Foot lateral sign: left is -1, right is +1
    const lateralSign = this.currentFoot === 'left' ? -1 : 1;
    const rightVec = Vector2.fromAngle(facing + Math.PI / 2);

    // Dynamic Pelvic Yaw twist & Mediolateral COM displacement
    let lateralSwayAcc = Vector2.zero();

    if (this.phase === 'stance' && isDemandingMove) {
      this.pelvicAngle = yawAmp * Math.sin(this.phaseProgress * Math.PI) * -lateralSign;
      this.lateralSway = swayAmp * Math.sin(this.phaseProgress * Math.PI) * lateralSign;
      lateralSwayAcc = rightVec.scale(lateralSign * swayAmp * 12.0 * Math.sin(this.phaseProgress * Math.PI));
    } else {
      this.pelvicAngle = 0;
      this.lateralSway = 0;
    }

    // Force Multiplier with Impact Braking Dip & Propulsion Surge
    let forceMultiplier = 0;
    if (isWalking) {
      // Smooth continuous drive during walk
      forceMultiplier = 1.0;
    } else if (this.phase === 'stance') {
      const dutyCycle = Math.max(0.3, Math.min(0.8, stanceDuration / stepDuration));

      if (isDemandingBrake) {
        // Active braking plant: firm decelerative ground reaction impulse throughout stance
        forceMultiplier =
          Math.sin(this.phaseProgress * Math.PI) * (Math.PI / (2 * dutyCycle));
      } else if (speed > 2.0 && this.phaseProgress < 0.22) {
        // Forward drive: initial foot strike impact dip (slight negative braking before drive)
        const dipProgress = this.phaseProgress / 0.22;
        forceMultiplier = -0.35 * Math.sin(dipProgress * Math.PI);
      } else {
        // Main propulsive drive
        const driveStart = speed > 2.0 ? 0.22 : 0.0;
        const driveProgress = Math.max(0, (this.phaseProgress - driveStart) / (1.0 - driveStart));
        const driveDutyCycle = dutyCycle * (1.0 - driveStart);
        forceMultiplier =
          Math.sin(driveProgress * Math.PI) * (Math.PI / (2 * driveDutyCycle));
      }
    }

    // Vertical COM displacement (Item 2)
    let verticalBounce = 0;
    if (isWalking) {
      if (this.isDoubleSupport) {
        verticalBounce = -0.012; // Dip during double support
      } else {
        const vaultProg = this.phaseProgress / (1.0 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION);
        verticalBounce = 0.020 * Math.sin(Math.min(1.0, vaultProg) * Math.PI); // Inverted pendulum vault
      }
    } else {
      const flightRatio = Math.min(1.0, speed / SIM_CONFIG.GAIT_SPEEDS.sprint);
      if (this.phase === 'stance') {
        verticalBounce =
          -SIM_CONFIG.PLAYER_BODY.VERTICAL_BOUNCE_MAX * 0.75 * Math.sin(this.phaseProgress * Math.PI) * flightRatio;
      } else {
        verticalBounce =
          SIM_CONFIG.PLAYER_BODY.VERTICAL_BOUNCE_MAX * Math.sin(this.phaseProgress * Math.PI) * flightRatio;
      }
    }

    const strideState: StrideState = {
      currentFoot: this.currentFoot,
      phase: this.phase,
      phaseProgress: this.phaseProgress,
      cadence,
      strideLength,
      plantPosition: this.plantPosition ? this.plantPosition.clone() : null,
      stanceWidth: activeStanceWidth,
      leftFootPos: this.leftFootPos.clone(),
      rightFootPos: this.rightFootPos.clone(),
      isBraking: this.isBraking,
      chopStepsRemaining: this.chopStepsRemaining,
      pelvicAngle: this.pelvicAngle,
      lateralSway: this.lateralSway,
      isDropStep: this.isDropStep,
      isDoubleSupport: this.isDoubleSupport,
    };

    return {
      forceMultiplier,
      lateralSwayAcc,
      isBrakingPlant,
      verticalBounce,
      strideState,
    };
  }

  reset(playerPos: Vector2, facing: number): void {
    this.currentFoot = 'left';
    this.phase = 'stance';
    this.phaseProgress = 0;
    this.plantPosition = null;
    this.isBraking = false;
    this.chopStepsRemaining = 0;
    this.pelvicAngle = 0;
    this.lateralSway = 0;
    this.isDropStep = false;
    this.dropStepTimer = 0;
    this.isDoubleSupport = true;
    this.isWalkingMode = true;
    this.updateFootRestPositions(playerPos, facing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);
    this.stanceSwingStartPos = this.rightFootPos.clone();
  }
}
