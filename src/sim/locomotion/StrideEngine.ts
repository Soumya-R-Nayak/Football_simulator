import { Vector2 } from '../../math/Vector2';
import { SIM_CONFIG } from '../config';
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
  private isBraking: boolean = false;
  private chopStepsRemaining: number = 0;
  private pelvicAngle: number = 0;
  private lateralSway: number = 0;
  private isDropStep: boolean = false;
  private dropStepTimer: number = 0;
  private isDoubleSupport: boolean = false;
  private heightCm: number = 180;
  private balance: number = 80;

  constructor(initialPos: Vector2, initialFacing: number) {
    this.updateFootRestPositions(initialPos, initialFacing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);
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
    isHoldingFacing: boolean = false
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
      this.updateFootRestPositions(playerPos, facing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);

      return {
        forceMultiplier: 0,
        lateralSwayAcc: Vector2.zero(),
        isBrakingPlant: false,
        verticalBounce: 0,
        strideState: {
          ...this.getState(),
          cadence: 0,
          strideLength: SIM_CONFIG.STRIDE.STRIDE_LEN_WALK,
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
    let strideLength: number;
    let swayAmp: number;
    let yawAmp: number;
    let activeStanceWidth: number;

    if (isBackpedal) {
      cadence = SIM_CONFIG.STRIDE.CADENCE_BACKPEDAL;
      strideLength = SIM_CONFIG.STRIDE.STRIDE_LEN_BACKPEDAL;
      swayAmp = SIM_CONFIG.STRIDE.SWAY_WALK * 0.5;
      yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK * 0.4;
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL;
    } else if (isJockey) {
      cadence = SIM_CONFIG.STRIDE.CADENCE_JOCKEY;
      strideLength = SIM_CONFIG.STRIDE.STRIDE_LEN_JOCKEY;
      swayAmp = SIM_CONFIG.STRIDE.SWAY_JOCKEY;
      yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK * 0.5;
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_JOCKEY;
    } else {
      // Natural forward and diagonal curved running (WD <-> WA maintains cadence and stance)
      activeStanceWidth = SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL;

      if (speed <= SIM_CONFIG.GAIT_SPEEDS.walk) {
        const t = Math.max(0, speed / SIM_CONFIG.GAIT_SPEEDS.walk);
        cadence = 1.5 + (SIM_CONFIG.STRIDE.CADENCE_WALK - 1.5) * t;
        strideLength = 0.5 + (SIM_CONFIG.STRIDE.STRIDE_LEN_WALK - 0.5) * t;
        swayAmp = SIM_CONFIG.STRIDE.SWAY_WALK;
        yawAmp = SIM_CONFIG.STRIDE.PELVIC_YAW_WALK;
      } else if (speed <= SIM_CONFIG.GAIT_SPEEDS.jog) {
        const t =
          (speed - SIM_CONFIG.GAIT_SPEEDS.walk) /
          (SIM_CONFIG.GAIT_SPEEDS.jog - SIM_CONFIG.GAIT_SPEEDS.walk);
        cadence =
          SIM_CONFIG.STRIDE.CADENCE_WALK +
          (SIM_CONFIG.STRIDE.CADENCE_JOG - SIM_CONFIG.STRIDE.CADENCE_WALK) * t;
        strideLength =
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
          (speed - SIM_CONFIG.GAIT_SPEEDS.jog) /
            (SIM_CONFIG.GAIT_SPEEDS.sprint - SIM_CONFIG.GAIT_SPEEDS.jog)
        );
        cadence =
          SIM_CONFIG.STRIDE.CADENCE_JOG +
          (SIM_CONFIG.STRIDE.CADENCE_SPRINT - SIM_CONFIG.STRIDE.CADENCE_JOG) * t;
        strideLength =
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

    // Scale stride length according to inverted pendulum leg length (sqrt of height ratio)
    const legScale = Math.sqrt(this.heightCm / 180);
    strideLength *= legScale;

    // Step duration & phase partitioning
    const stepDuration = 1 / (2 * cadence);
    const speedRatio = Math.min(1.0, speed / SIM_CONFIG.GAIT_SPEEDS.sprint);
    const isWalking = speed < SIM_CONFIG.STRIDE.WALK_TO_RUN_SPEED;

    let stanceDuration = 0;
    let flightDuration = 0;
    let currentPhaseDuration = 0;

    if (isWalking) {
      // Inverted Pendulum Walk: No flight phase!
      // Step cycle consists of single support and double-support overlap
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

        const halfWidth = activeStanceWidth / 2;
        const lateralSign = this.currentFoot === 'left' ? -1 : 1;
        const rightVec = Vector2.fromAngle(facing + Math.PI / 2);
        const forwardVec = Vector2.fromAngle(facing);

        let forwardReach = isBrakingPlant
          ? Math.min(SIM_CONFIG.STRIDE.REACH_FWD_MAX, strideLength * 0.45)
          : Math.min(SIM_CONFIG.STRIDE.REACH_FWD_MAX, strideLength * 0.35);

        if (this.isDropStep) {
          forwardReach = -SIM_CONFIG.STRIDE.DROP_STEP_OFFSET;
        }

        const plantOffset = forwardVec
          .scale(forwardReach)
          .add(rightVec.scale(lateralSign * halfWidth));

        const clampedOffset = plantOffset.clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);
        this.plantPosition = playerPos.add(clampedOffset);

        if (this.currentFoot === 'left') {
          this.leftFootPos = this.plantPosition.clone();
        } else {
          this.rightFootPos = this.plantPosition.clone();
        }
      } else {
        // Running phase transition: Stance <-> Flight
        if (this.phase === 'stance') {
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

          const halfWidth = activeStanceWidth / 2;
          const lateralSign = this.currentFoot === 'left' ? -1 : 1;
          const rightVec = Vector2.fromAngle(facing + Math.PI / 2);
          const forwardVec = Vector2.fromAngle(facing);

          let forwardReach = isBrakingPlant
            ? Math.min(SIM_CONFIG.STRIDE.REACH_FWD_MAX, strideLength * 0.45)
            : Math.min(SIM_CONFIG.STRIDE.REACH_FWD_MAX, strideLength * 0.35);

          if (this.isDropStep) {
            forwardReach = -SIM_CONFIG.STRIDE.DROP_STEP_OFFSET;
          }

          const plantOffset = forwardVec
            .scale(forwardReach)
            .add(rightVec.scale(lateralSign * halfWidth));

          const clampedOffset = plantOffset.clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);
          this.plantPosition = playerPos.add(clampedOffset);

          if (this.currentFoot === 'left') {
            this.leftFootPos = this.plantPosition.clone();
          } else {
            this.rightFootPos = this.plantPosition.clone();
          }
        }
      }
    }

    // Update foot visuals
    if (isWalking) {
      const halfWidth = activeStanceWidth / 2;
      const otherSign = this.currentFoot === 'left' ? 1 : -1;
      const rightVec = Vector2.fromAngle(facing + Math.PI / 2);
      const forwardVec = Vector2.fromAngle(facing);

      if (this.isDoubleSupport) {
        // Both feet planted on turf during double-support
        const frontPlantOffset = forwardVec
          .scale(strideLength * 0.35)
          .add(rightVec.scale(otherSign * halfWidth));
        const frontPlantPos = playerPos.add(frontPlantOffset);
        if (this.currentFoot === 'left') {
          this.rightFootPos = frontPlantPos;
        } else {
          this.leftFootPos = frontPlantPos;
        }
      } else {
        // Single support: swing foot travelling forward past stance foot
        const swingProgress = Math.min(
          1.0,
          this.phaseProgress / (1.0 - SIM_CONFIG.STRIDE.DOUBLE_SUPPORT_FRACTION)
        );
        const swingOffset = forwardVec.scale(strideLength * (swingProgress - 0.5) * 0.7);
        const swingPos = playerPos.add(rightVec.scale(otherSign * halfWidth)).add(swingOffset);
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
      const forwardVec = Vector2.fromAngle(facing);

      const swingOffset = forwardVec
        .scale(strideLength * (this.phaseProgress - 0.5) * 0.6)
        .clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);
      const swingPos = playerPos.add(rightVec.scale(otherSign * halfWidth)).add(swingOffset);

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
      const leadOffset = forwardVec
        .scale(strideLength * (0.28 + this.phaseProgress * 0.07))
        .clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);

      const trailOffset = forwardVec
        .scale(strideLength * (-0.30 + this.phaseProgress * 0.25))
        .clampLength(SIM_CONFIG.STRIDE.MAX_LEG_LENGTH);

      if (this.currentFoot === 'left') {
        this.leftFootPos = playerPos.add(rightVec.scale(-halfWidth)).add(trailOffset);
        this.rightFootPos = playerPos.add(rightVec.scale(halfWidth)).add(leadOffset);
      } else {
        this.rightFootPos = playerPos.add(rightVec.scale(halfWidth)).add(trailOffset);
        this.leftFootPos = playerPos.add(rightVec.scale(-halfWidth)).add(leadOffset);
      }
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

      if (speed > 2.0 && this.phaseProgress < 0.22 && !isDemandingBrake) {
        // Initial foot strike impact dip (slight negative braking before drive)
        const dipProgress = this.phaseProgress / 0.22;
        forceMultiplier = -0.35 * Math.sin(dipProgress * Math.PI);
      } else {
        // Main propulsive drive
        const driveStart = speed > 2.0 ? 0.22 : 0.0;
        const driveProgress = (this.phaseProgress - driveStart) / (1.0 - driveStart);
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
    this.updateFootRestPositions(playerPos, facing, SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL);
  }
}
