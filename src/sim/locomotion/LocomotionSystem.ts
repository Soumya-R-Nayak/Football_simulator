import { Vector2 } from '../../math/Vector2';
import { SIM_CONFIG } from '../config';
import { PitchSurface } from '../physics/PitchSurface';
import {
  CutStatus,
  FootId,
  Intent,
  PLAYER_PRESETS,
  PlayerAttributes,
  PlayerFootedness,
  PlayerState,
  SlipStatus,
  StudType,
  TURF_PRESETS,
  TurfCondition,
} from '../types';
import { buildPlayerContactState } from './ContactState';
import { StrideEngine } from './StrideEngine';

/**
 * Locomotion System integrating Intent into biomechanically constrained PlayerState.
 * Combines Morin macroscopic acceleration, directional speed envelopes, plant-and-cut
 * turning, stance-coupled torso rotation, discrete footstep strides, weak-foot lateral asymmetry,
 * physical player attributes (Pace, Accel, Agility, Balance, Strength), continuous
 * sprint curve shaping (κ in [-0.30, +0.30]), footwear studs (FG vs SG), available turf
 * traction, and biomechanical slipping / wipeout recovery.
 */
export class LocomotionSystem {
  private readonly strideEngine: StrideEngine;
  private attributes: PlayerAttributes = PLAYER_PRESETS.balanced;
  private footedness: PlayerFootedness = PLAYER_PRESETS.balanced.footedness;
  private studType: StudType = 'fg_plastic';
  private slipStatus: SlipStatus = {
    type: 'none',
    skidVelocity: Vector2.zero(),
    timer: 0,
    initialDuration: 0,
    tractionDemand: 0,
    availableTraction: 1.25,
    slipFoot: null,
  };
  private slideStartPos: Vector2 | null = null;
  private lastDivotTime: number = -1;
  private cutSettleTimer: number = 0;
  private cutSettleDuration: number = 0;
  private wasCuttingLastFrame: boolean = false;
  private facingHoldTarget: number | null = null;

  constructor(initialPos: Vector2, initialFacing: number) {
    this.strideEngine = new StrideEngine(initialPos, initialFacing);
    this.strideEngine.setHeightCm(this.attributes.heightCm);
    this.strideEngine.setBalance(this.attributes.balance);
  }

  getStudType(): StudType {
    return this.studType;
  }

  setStudType(type: StudType): void {
    this.studType = type;
  }

  toggleStudType(): StudType {
    this.studType = this.studType === 'fg_plastic' ? 'sg_metal' : 'fg_plastic';
    return this.studType;
  }

  getSlipStatus(): SlipStatus {
    return this.slipStatus;
  }

  setFootedness(footedness: PlayerFootedness): void {
    this.footedness = footedness;
  }

  getFootedness(): PlayerFootedness {
    return this.footedness;
  }

  getAttributes(): PlayerAttributes {
    return this.attributes;
  }

  setAttributes(attributes: PlayerAttributes): void {
    this.attributes = attributes;
    this.setFootedness(attributes.footedness);
    this.strideEngine.setHeightCm(attributes.heightCm);
    this.strideEngine.setBalance(attributes.balance);
  }

  /**
   * Continuous Sprint Curve Index (κ in [-0.30, +0.30]).
   * Derived smoothly from power-to-weight leverage:
   * κ > 0: Explosive initial burst (front-loaded thrust).
   * κ = 0: Controlled linear decay.
   * κ < 0: Lengthy sustained mid-phase thrust.
   */
  getCurveIndex(): number {
    const powerRatio = (this.attributes.agility - this.attributes.strength) / 100;
    const pendulumEffect = 0.60 * ((this.attributes.heightCm - 180) / 20);
    const rawKappa = 0.25 * (powerRatio - pendulumEffect);
    return Math.max(-0.30, Math.min(0.30, rawKappa));
  }

  step(
    currentState: PlayerState,
    intent: Intent,
    dt: number,
    pitchSurface?: PitchSurface,
    turfCondition: TurfCondition = 'standard',
    simTime: number = 0
  ): PlayerState {
    const currentVel = currentState.velocity;
    const currentSpeed = currentVel.length();
    let currentFacing = currentState.facing;

    // Derived Physical & Kinematic Parameters
    const maxSprintSpeed = 7.40 + 2.50 * (this.attributes.topSpeed / 100);
    const maxJogSpeed = Math.min(SIM_CONFIG.GAIT_SPEEDS.jog, 0.52 * maxSprintSpeed);
    const maxWalkSpeed = SIM_CONFIG.GAIT_SPEEDS.walk;

    // Match PlayerAttributes' stated propulsive GRF/mass range and measured soccer
    // horizontal force-to-mass magnitudes (roughly 6.5-7.0 N/kg in the cited sample).
    const maxPropAcc = 4.80 + 2.70 * (this.attributes.acceleration / 100);
    const maxBrakeAcc = 6.00 + 3.125 * (this.attributes.strength / 100);
    const maxLatGripBase = 4.50 + 2.50 * (this.attributes.agility / 100);

    // Torso rotational limits scale with agility and body inertia (75 kg baseline).
    const inertiaFactor = Math.sqrt(75 / Math.max(50, this.attributes.weightKg));
    const effectiveOmegaMax = SIM_CONFIG.KINEMATICS.OMEGA_MAX *
      (0.83 + 0.42 * (this.attributes.agility / 100)) * inertiaFactor;

    // Yaw acceleration comes from the planted base. Airborne or slipping players
    // can still counter-rotate, but have much less ground torque available.
    const contact = currentState.contactState;
    const totalFootLoad = contact
      ? contact.leftFoot.normalLoadN + contact.rightFoot.normalLoadN
      : 0;
    const bodyWeightN = this.attributes.weightKg * 9.81;
    const loadFraction = Math.min(1, totalFootLoad / Math.max(1, bodyWeightN));
    const supportFactor = contact
      ? (contact.isSupported ? 0.32 + 0.68 * loadFraction : 0.28)
      : (currentState.stride.phase === 'flight' ? 0.35 : 0.78);
    const slipping = currentState.slipStatus.type !== 'none';
    const slippingLoadShare = contact && totalFootLoad > 0
      ? ((contact.leftFoot.isSlipping ? contact.leftFoot.normalLoadN : 0) +
          (contact.rightFoot.isSlipping ? contact.rightFoot.normalLoadN : 0)) / totalFootLoad
      : 0;
    const slipFactor = slippingLoadShare > 0
      ? 1 - 0.70 * Math.min(1, slippingLoadShare)
      : slipping ? 0.65 : 1.0;
    const planarAcceleration = contact?.centerOfMassAcceleration;
    let lateralGripUse = 0;
    if (planarAcceleration && currentSpeed > 0.5) {
      const velocityDirection = currentVel.normalize();
      const lateralDemand = Math.abs(
        velocityDirection.x * planarAcceleration.y - velocityDirection.y * planarAcceleration.x
      );
      lateralGripUse = Math.min(1, lateralDemand / Math.max(0.1, maxLatGripBase));
    }
    const gripFactor = 1 - 0.55 * lateralGripUse;
    const maxYawAcceleration = SIM_CONFIG.KINEMATICS.ALPHA_YAW_MAX *
      inertiaFactor * supportFactor * slipFactor * gripFactor;

    const curveIndex = this.getCurveIndex();

    // 1. Torso Heading Update. Use an angular-speed target with a stopping-speed
    // profile, then accelerate toward it under the torque available from stance.
    // This preserves angular momentum while avoiding an abrupt snap at the target.
    let targetAngularVelocity = 0;
    const manualTurn = typeof intent.manualTurn === 'number' ? intent.manualTurn : 0;
    let angleDiff = 0;
    if (manualTurn !== 0) {
      this.facingHoldTarget = null;
      const turnInput = Math.max(-1, Math.min(1, manualTurn));
      targetAngularVelocity = turnInput * effectiveOmegaMax;
    } else {
      let targetFacing: number;
      if (intent.holdFacing) {
        this.facingHoldTarget ??= currentState.facing;
        targetFacing = this.facingHoldTarget;
      } else {
        this.facingHoldTarget = null;
        const facingIntent = intent.faceDir ?? intent.moveDir;
        targetFacing = facingIntent.lengthSq() > 0.01 ? facingIntent.angle() : currentState.facing;
      }
      angleDiff = this.normalizeAngle(targetFacing - currentFacing);
      const stoppingSpeed = Math.sqrt(2 * maxYawAcceleration * Math.abs(angleDiff));
      targetAngularVelocity = Math.sign(angleDiff) * Math.min(effectiveOmegaMax, stoppingSpeed);
    }

    const angularVelocity = currentState.angularVelocity;
    const maxAngularChange = maxYawAcceleration * dt;
    const angularDelta = Math.max(
      -maxAngularChange,
      Math.min(maxAngularChange, targetAngularVelocity - angularVelocity)
    );
    let nextAngularVelocity = Math.max(
      -effectiveOmegaMax,
      Math.min(effectiveOmegaMax, angularVelocity + angularDelta)
    );
    const facingDelta = (angularVelocity + nextAngularVelocity) * 0.5 * dt;

    // For a commanded heading, stop exactly at the target if the final integration
    // step would cross it. Manual turning intentionally has no fixed target angle.
    if (manualTurn === 0 && angleDiff !== 0 && Math.sign(facingDelta) === Math.sign(angleDiff) &&
        Math.abs(facingDelta) >= Math.abs(angleDiff)) {
      currentFacing = this.normalizeAngle(currentFacing + angleDiff);
      nextAngularVelocity = 0;
    } else {
      currentFacing = this.normalizeAngle(currentFacing + facingDelta);
    }

    // 2. Base Speed & Directional Speed Anisotropy
    let baseGaitSpeed: number = maxWalkSpeed;
    if (intent.gait === 'sprint') {
      baseGaitSpeed = maxSprintSpeed;
    } else if (intent.gait === 'jog') {
      baseGaitSpeed = maxJogSpeed;
    }

    // Stamina degradation: when stamina < 0.30, slightly reduce top sprint speed by up to 15%
    if (currentState.stamina < 0.30 && intent.gait === 'sprint') {
      const fatiguePenalty = ((0.30 - currentState.stamina) / 0.30) * 0.15;
      baseGaitSpeed *= 1.0 - fatiguePenalty;
    }
    const balFactor = Math.max(0, Math.min(1.0, this.attributes.balance / 100));
    const stickMagnitude = Math.min(1.0, intent.moveDir.length());

    // Compute angle between requested movement and torso facing
    let directionalFactor = 1.0;
    let relativeAngle = 0;
    let signedTurnAngle = 0;
    if (stickMagnitude > 0.01) {
      const moveAngle = intent.moveDir.angle();
      signedTurnAngle = this.normalizeAngle(moveAngle - currentFacing);
      relativeAngle = Math.abs(signedTurnAngle);
      // Mechanic 2: Arc & Curving Run Speed Preservation modulated by balance
      directionalFactor = this.calculateDirectionalSpeedFactor(relativeAngle, balFactor);
    }

    const targetMaxSpeed = baseGaitSpeed * directionalFactor * stickMagnitude;
    const desiredVelocity =
      stickMagnitude > 0.01 ? intent.moveDir.normalize().scale(targetMaxSpeed) : Vector2.zero();

    // 3. Acceleration & Deceleration Checks
    const isDemandingMove = stickMagnitude > 0.05;
    const deltaV = desiredVelocity.sub(currentVel);
    const isDemandingBrake =
      currentSpeed > 1.0 && (!isDemandingMove || currentVel.dot(desiredVelocity) < 0);

    // 4. Stride Cycle Step (Ground Stance vs. Airborne Flight)
    let { forceMultiplier, lateralSwayAcc, isBrakingPlant, verticalBounce, strideState } =
      this.strideEngine.step(
        dt,
        currentSpeed,
        isDemandingMove,
        isDemandingBrake,
        currentState.position,
        currentFacing,
        relativeAngle,
        signedTurnAngle,
        intent.holdFacing,
        currentVel,
        deltaV.scale(1 / SIM_CONFIG.KINEMATICS.TAU)
      );

    // 5. Force & Kinematic Integration
    let targetAcc = deltaV.scale(1 / SIM_CONFIG.KINEMATICS.TAU);

    // Decompose targetAcc into longitudinal (forward) and lateral (centripetal turning) components
    let longAcc = 0;
    let latAcc = 0;
    let fwdUnit = Vector2.zero();
    let normalUnit = Vector2.zero();

    // Cutting & Weak-Foot Biomechanics Detection
    let isCutting = false;
    let outsideFoot: FootId = 'left';
    let isPlantingOutside = false;
    let isDominantPlant = true;
    let plantEfficiency = 1.0;

    if (!isDemandingMove) {
      if (currentSpeed > 0.001) {
        fwdUnit = currentVel.normalize();
        normalUnit = new Vector2(-fwdUnit.y, fwdUnit.x);
        // Active ground braking deceleration toward crisp standstill
        const stopDecel = Math.min(currentSpeed / dt, Math.max(5.0, maxBrakeAcc * 0.70));
        longAcc = -stopDecel;
        latAcc = 0;
        targetAcc = fwdUnit.scale(longAcc);
      } else {
        fwdUnit = Vector2.fromAngle(currentFacing);
        normalUnit = new Vector2(-fwdUnit.y, fwdUnit.x);
        longAcc = 0;
        latAcc = 0;
        targetAcc = Vector2.zero();
      }
    } else if (currentSpeed > 0.3) {
      fwdUnit = currentVel.normalize();
      normalUnit = new Vector2(-fwdUnit.y, fwdUnit.x);

      longAcc = targetAcc.dot(fwdUnit);
      latAcc = targetAcc.dot(normalUnit);

      // Determine turn direction and outside plant foot:
      // When turning right (latAcc > 0), the outside plant foot is LEFT
      // When turning left (latAcc < 0), the outside plant foot is RIGHT
      const isTurningRight = latAcc > 0;
      outsideFoot = isTurningRight ? 'left' : 'right';
      isPlantingOutside = strideState.currentFoot === outsideFoot;
      isCutting =
        Math.abs(latAcc) > 1.2 &&
        currentSpeed > 1.8 &&
        (relativeAngle > Math.PI / 3.8 || Math.abs(latAcc) > 3.2);

      // Mechanic 1: Trigger post-cut settling timer when entering a sharp plant cut
      if (isCutting && !this.wasCuttingLastFrame) {
        const baseSettle = 0.28;
        this.cutSettleDuration = baseSettle * (1.0 - 0.75 * balFactor);
        this.cutSettleTimer = this.cutSettleDuration;
      }
      this.wasCuttingLastFrame = isCutting;

      // Weak-Foot Lateral Grip & Cutting Efficiency
      if (this.footedness.dominantFoot !== 'both') {
        if (outsideFoot === this.footedness.dominantFoot) {
          isDominantPlant = true;
          plantEfficiency = 1.0;
        } else {
          isDominantPlant = false;
          plantEfficiency = 0.80 + 0.20 * this.footedness.weakFootAbility;
        }
      }

      // Clamp lateral acceleration to stud turf grip limit (scaled by plant efficiency when cutting)
      const maxLatGrip = maxLatGripBase * (isCutting ? plantEfficiency : 1.0);
      latAcc = Math.max(-maxLatGrip, Math.min(maxLatGrip, latAcc));

      // Coupled braking on sharp cuts: if requested turn angle is sharp (> 50 deg),
      // scrub longitudinal entry speed to allow tight turning radius
      if (relativeAngle > Math.PI / 3.6 && currentSpeed > 3.5) {
        const brakeFactor = Math.min(1.0, (relativeAngle - Math.PI / 3.6) / (Math.PI / 2.5));
        const brakeDemand = -maxBrakeAcc * 0.75 * brakeFactor;
        longAcc = Math.min(longAcc, brakeDemand);
      }

      // Longitudinal acceleration limits
      const isBraking = longAcc < 0;

      // Apply Morin Force-Velocity propulsive curve with continuous curve modulation
      if (!isBraking && targetMaxSpeed > 0.5) {
        const u = Math.min(1.0, currentSpeed / targetMaxSpeed);
        const curveModulation = Math.max(0.6, Math.min(1.4, 1.0 + curveIndex * (1.0 - 2.0 * u)));
        let morinProp = maxPropAcc * (1.0 - u * 0.65) * curveModulation;

        // Mechanic 1: Post-Cut Settle Acceleration Modulation
        // High balance restores 100% thrust immediately; lower balance ramps up smoothly during settle
        if (this.cutSettleTimer > 0) {
          this.cutSettleTimer = Math.max(0, this.cutSettleTimer - dt);
          const settleProgress = this.cutSettleDuration > 0
            ? 1.0 - (this.cutSettleTimer / this.cutSettleDuration)
            : 1.0;
          const minPropFraction = 0.35 + 0.65 * balFactor;
          const exitMultiplier = minPropFraction + (1.0 - minPropFraction) * settleProgress;
          morinProp *= exitMultiplier;
        }

        longAcc = Math.min(longAcc, morinProp);
      } else if (isBraking) {
        longAcc = Math.max(-maxBrakeAcc, longAcc);
      }

      targetAcc = fwdUnit.scale(longAcc).add(normalUnit.scale(latAcc));
    } else {
      // From standstill/near rest: apply explosive blastoff propulsion with initial curve boost M(0) = 1 + kappa
      const initCurveMod = Math.max(0.6, Math.min(1.4, 1.0 + curveIndex));
      const initMaxProp = maxPropAcc * initCurveMod;
      fwdUnit =
        targetAcc.lengthSq() > 0.01
          ? targetAcc.normalize()
          : Vector2.fromAngle(currentFacing);
      normalUnit = new Vector2(-fwdUnit.y, fwdUnit.x);
      longAcc = initMaxProp * stickMagnitude;
      latAcc = 0;
      targetAcc = fwdUnit.scale(longAcc);
      this.cutSettleTimer = 0;
    }

    const cutStatus: CutStatus = {
      isCutting,
      plantFoot: isCutting ? strideState.currentFoot : null,
      isOutsideFoot: isCutting ? isPlantingOutside : false,
      isDominantPlant,
      plantEfficiency,
    };

    // Apply discrete stride force:
    // If airborne (flight): zero ground thrust, only ballistic flight with tiny aerodynamic drag
    let finalAcc = Vector2.zero();
    if (strideState.phase === 'stance') {
      let latMultiplier = 1.0;
      if (isCutting) {
        if (isPlantingOutside) {
          // Outside plant-and-cut foot modulated by balance (high balance bites deeper)
          latMultiplier = 1.30 * plantEfficiency * (0.85 + 0.30 * balFactor);
        } else {
          // Inside stabilizing check foot
          latMultiplier = 0.35;
        }
      }

      // Straight-line sprinting propulsive micro-asymmetry for dominant vs weak foot
      let effectiveLongAcc = longAcc;
      if (intent.gait === 'sprint' && isDemandingMove && this.footedness.dominantFoot !== 'both') {
        const asym = 0.02 * (1.0 - 0.5 * this.footedness.weakFootAbility);
        if (strideState.currentFoot === this.footedness.dominantFoot) {
          effectiveLongAcc *= 1.0 + asym;
        } else {
          effectiveLongAcc *= 1.0 - asym;
        }
      }

      let effectiveLongForce: Vector2;
      if (!isDemandingMove && currentSpeed > 0) {
        effectiveLongForce = fwdUnit.scale(effectiveLongAcc);
      } else if (effectiveLongAcc < 0) {
        // Active braking or cut-scrubbing: force must oppose current velocity; never invert into forward acceleration
        effectiveLongForce = fwdUnit.scale(effectiveLongAcc * Math.abs(forceMultiplier));
      } else {
        // Forward propulsion: early-stance impact dip legitimately retards forward drive
        effectiveLongForce = fwdUnit.scale(effectiveLongAcc * forceMultiplier);
      }
      const latForce = normalUnit.scale(latAcc * latMultiplier * Math.abs(forceMultiplier));
      finalAcc = effectiveLongForce.add(latForce).add(lateralSwayAcc);
    } else {
      // Ballistic air resistance (drag: 0.5 * rho * Cd * A / m * v^2)
      finalAcc = currentVel.scale(-0.0035 * currentSpeed);
    }

    // Heavy braking plant step impulse (Mechanic 3: Biomechanical Braking Stability)
    if (isBrakingPlant) {
      const stableBrakeCapacity = maxBrakeAcc * (0.75 + 0.25 * balFactor);
      const brakeDir = currentVel.length() > 0.05 ? currentVel.normalize() : fwdUnit;
      const currentDecelAlongVel = -finalAcc.dot(brakeDir);
      if (currentDecelAlongVel < stableBrakeCapacity) {
        const neededDecel = stableBrakeCapacity - currentDecelAlongVel;
        finalAcc = finalAcc.sub(brakeDir.scale(neededDecel));
      }
    }

    // 5.5 Biomechanical Traction Demand & Slipping System
    // This center-of-mass model treats targetAcc as the requested step-averaged GRF.
    // The stance waveform below supplies the instantaneous pulse; avoid classifying its
    // artificial peak as a slip until per-foot force dynamics are modeled explicitly.

    // Available Turf Traction Calculation:
    // Base traction TC_base = 1.25 (typical cleat on dry standard natural turf)
    const baseTC = 1.25;
    const turfProps = TURF_PRESETS[turfCondition];
    const turfFactor = turfProps.tractionFactor;

    // Stud multiplier:
    // FG molded plastic hydroplanes on wet slick turf (0.72x)
    // SG long metal studs bite deep into wet soil (1.35x, +35% over baseline)
    let studFactor = 1.0;
    if (this.studType === 'fg_plastic') {
      studFactor = turfCondition === 'wet_slick' ? 0.72 : 1.0;
    } else {
      studFactor = turfCondition === 'wet_slick' ? 1.35 : turfCondition === 'dry_heavy' ? 1.05 : 1.0;
    }

    const grassFactor = pitchSurface ? pitchSurface.getGrassTractionFactor() : 1.0;
    const studHardnessFactor = pitchSurface
      ? pitchSurface.getStudHardnessTractionFactor(currentState.position.x, currentState.position.y, this.studType)
      : 1.0;
    const localWear = pitchSurface ? pitchSurface.getWearAt(currentState.position.x, currentState.position.y) : 0.0;
    const wearFactor = 1.0 - 0.45 * localWear;
    // Divot hazard: balance mitigates grip loss (Mechanic 4)
    const divotsNearby = pitchSurface ? pitchSurface.getDivotsNear(currentState.position, 0.35, 0.40, simTime) : [];
    const divotPenalty = divotsNearby.length > 0 ? (0.70 + 0.18 * balFactor) : 1.0;

    // Cleat Rut Hazard: planting across an existing furrow compromises lateral footing
    const isNearRut = pitchSurface ? pitchSurface.isNearRut(currentState.position, 0.35) : false;
    const rutPenalty = isNearRut ? (0.76 + 0.14 * balFactor) : 1.0;

    // Fatigue Stability Reduction: tired stabilizer muscles delay eccentric ankle arrest
    const fatigueRatio = Math.max(0, (0.35 - currentState.stamina) / 0.35);
    const fatigueTractionPenalty = 1.0 - 0.15 * fatigueRatio;

    const availableTraction =
      baseTC *
      turfFactor *
      studFactor *
      grassFactor *
      studHardnessFactor *
      wearFactor *
      divotPenalty *
      rutPenalty *
      fatigueTractionPenalty;

    const isApplyingGroundForce = strideState.phase === 'stance' || strideState.isDoubleSupport;
    const playerMassKg = Math.max(1, this.attributes.weightKg);
    const requestedGroundAcc = isApplyingGroundForce ? targetAcc : Vector2.zero();
    const requestedGroundForceN = requestedGroundAcc.scale(playerMassKg);
    const tractionDemand = requestedGroundForceN.length() / (playerMassKg * 9.81);
    const maxGroundForceN = availableTraction * playerMassKg * 9.81;
    const maxAvailableForce = maxGroundForceN / playerMassKg;

    // Hazard Perturbation Impulse (Mechanic 4: Physical lateral micro-deflection on rough ground)
    if (divotsNearby.length > 0 && currentSpeed > 0.8 && strideState.phase === 'stance') {
      const rawPerturb = 0.25;
      const damping = 1.0 - 0.90 * balFactor;
      const perturbSign = divotsNearby[0].id % 2 === 0 ? 1 : -1;
      finalAcc = finalAcc.add(normalUnit.scale(perturbSign * rawPerturb * damping * 8.0));
    }

    // Coulomb friction bounds the net force the planted foot can transmit, including
    // perturbations from rough ground. Slip classification uses the step-averaged request.
    if (isApplyingGroundForce && finalAcc.scale(playerMassKg).length() > maxGroundForceN) {
      finalAcc = finalAcc.normalize().scale(maxGroundForceN / playerMassKg);
    }

    // Check if player requested an intentional controlled ground slide / slide tackle
    const requestedSlide = intent.requestSlide && this.slipStatus.type === 'none' && currentSpeed > 2.8;

    // Handle Active Slip Recovery vs New Traction Loss
    if (this.slipStatus.timer > 0) {
      const remainingTimer = Math.max(0, this.slipStatus.timer - dt);
      const isStopped = currentSpeed < 0.25 && (this.slipStatus.type === 'controlled_slide' || this.slipStatus.type === 'wipeout');
      if (remainingTimer === 0 || isStopped) {
        if (pitchSurface && this.slideStartPos) {
          const slideVec = currentState.position.sub(this.slideStartPos);
          const slideDist = slideVec.length();
          if (slideDist > 0.5) {
            const localMoisture = pitchSurface.getMoistureAt(this.slideStartPos.x, this.slideStartPos.y);
            const isWaterlogged = localMoisture >= 0.70;
            // On waterlogged turf, standing water cushions rootzone so furrow is shorter/shallower
            const maxFurrowLen = isWaterlogged ? 1.8 : 3.2;
            const furrowEnd = slideDist > maxFurrowLen
              ? this.slideStartPos.add(slideVec.normalize().scale(maxFurrowLen))
              : currentState.position;
            pitchSurface.createRut(
              this.slideStartPos,
              furrowEnd,
              this.slipStatus.type === 'wipeout' ? 0.85 : 0.65,
              simTime
            );
          }
          this.slideStartPos = null;
        }
        this.slipStatus = {
          type: 'none',
          skidVelocity: Vector2.zero(),
          timer: 0,
          initialDuration: 0,
          tractionDemand,
          availableTraction,
          slipFoot: null,
          isControlled: false,
        };
      } else {
        this.slipStatus = {
          ...this.slipStatus,
          timer: remainingTimer,
          tractionDemand,
          availableTraction,
        };

        const localMoisture = pitchSurface
          ? pitchSurface.getMoistureAt(currentState.position.x, currentState.position.y)
          : (turfCondition === 'wet_slick' ? 0.65 : 0.25);
        // Hydrodynamic drag in standing water/puddles (moisture > 0.70)
        const hydroDrag = localMoisture > 0.70 ? 2.8 * (localMoisture - 0.70) * currentSpeed : 0;

        if (this.slipStatus.type === 'wipeout') {
          if (!this.slideStartPos) {
            this.slideStartPos = currentState.position.clone();
          }
          const slideDecel = currentSpeed > 0.15 ? 0.35 * 9.81 + hydroDrag : 0;
          finalAcc = currentSpeed > 0.15 ? currentVel.normalize().scale(-slideDecel) : Vector2.zero();
        } else if (this.slipStatus.type === 'controlled_slide') {
          const slideDecel = currentSpeed > 0.15 ? turfProps.skidFriction * 9.81 + hydroDrag : 0;
          finalAcc = currentSpeed > 0.15 ? currentVel.normalize().scale(-slideDecel) : Vector2.zero();
        } else if (this.slipStatus.type === 'micro_slip') {
          // Stumble: propulsion and steering severely compromised (50% reduction)
          finalAcc = finalAcc.scale(0.50);
        }
      }
    } else if (requestedSlide) {
      // Intentional Controlled Slide Trigger
      const skidFriction = turfProps.skidFriction;
      const localMoisture = pitchSurface
        ? pitchSurface.getMoistureAt(currentState.position.x, currentState.position.y)
        : (turfCondition === 'wet_slick' ? 0.65 : 0.25);
      const hydroDrag = localMoisture > 0.70 ? 2.8 * (localMoisture - 0.70) * currentSpeed : 0;
      const effectiveDecel = skidFriction * 9.81 + hydroDrag;
      const duration = Math.min(1.6, Math.max(0.45, (currentSpeed / effectiveDecel) * 0.82));
      this.slideStartPos = currentState.position.clone();
      this.slipStatus = {
        type: 'controlled_slide',
        skidVelocity: currentVel.clone(),
        timer: duration,
        initialDuration: duration,
        tractionDemand,
        availableTraction,
        slipFoot: strideState.currentFoot,
        isControlled: true,
      };
      const slideDecel = currentSpeed > 0.15 ? effectiveDecel : 0;
      finalAcc = currentSpeed > 0.15 ? currentVel.normalize().scale(-slideDecel) : Vector2.zero();
    } else {
      // Ground reaction forces and cleat traction limits apply strictly during foot-ground stance contact
      if (isApplyingGroundForce && tractionDemand > availableTraction) {
        const slipRatio = tractionDemand / Math.max(availableTraction, 1e-6);
        const plantPos = strideState.plantPosition ?? currentState.position;

        const tier = pitchSurface ? pitchSurface.getPitchTier() : null;
        const shearAcc = requestedGroundAcc.length();
        const isTurning = Math.abs(latAcc) > 1.8;

        // Straight-line propulsion can be self-regulated to the grip ceiling. Material
        // lateral/cutting demand exceeds that capacity as a contact failure and slips.
        if (!isTurning) {
          const maxGripForce = maxGroundForceN / playerMassKg;
          if (finalAcc.length() > maxGripForce) finalAcc = finalAcc.normalize().scale(maxGripForce);
          this.slipStatus = {
            type: 'none',
            skidVelocity: Vector2.zero(),
            timer: 0,
            initialDuration: 0,
            tractionDemand: finalAcc.length() / 9.81,
            availableTraction,
            slipFoot: null,
            isControlled: false,
          };
        } else {
          const localMoisture = pitchSurface
            ? pitchSurface.getMoistureAt(plantPos.x, plantPos.y)
            : (turfCondition === 'wet_slick' ? 0.65 : 0.25);
          // FG molded plastic studs on wet grass/puddles slide across surface without tearing sod
          const isSlickOrPuddle = localMoisture >= 0.50 && this.studType === 'fg_plastic';

          if (slipRatio > 1.28) {
            // Full Wipeout: complete loss of footing
            const duration = 0.72 * (1.0 - 0.40 * (this.attributes.balance / 100));
            this.slideStartPos = currentState.position.clone();
            if (pitchSurface && (!tier || shearAcc > tier.divotShearThreshold) && !isSlickOrPuddle) {
              pitchSurface.createDivot(
                plantPos,
                currentVel.length() > 0.1 ? currentVel.angle() : currentFacing,
                0.85,
                simTime
              );
            }
            this.slipStatus = {
              type: 'wipeout',
              skidVelocity: currentVel.clone(),
              timer: duration,
              initialDuration: duration,
              tractionDemand,
              availableTraction,
              slipFoot: strideState.currentFoot,
              isControlled: false,
            };
            const slideDecel = currentSpeed > 0.15 ? 0.35 * 9.81 : 0;
            finalAcc = currentSpeed > 0.15 ? currentVel.normalize().scale(-slideDecel) : Vector2.zero();
          } else if (slipRatio > 1.05) {
            // Micro-Slip / Stumble
            const duration = 0.35 * (1.0 - 0.50 * (this.attributes.balance / 100));
            if (pitchSurface && (!tier || shearAcc > tier.divotShearThreshold) && !isSlickOrPuddle) {
              pitchSurface.createDivot(plantPos, currentFacing, 0.45, simTime);
            }
            this.slipStatus = {
              type: 'micro_slip',
              skidVelocity: currentVel.scale(0.8),
              timer: duration,
              initialDuration: duration,
              tractionDemand,
              availableTraction,
              slipFoot: strideState.currentFoot,
              isControlled: false,
            };
            // Clamp force to available traction limit
            if (finalAcc.length() > maxAvailableForce) {
              finalAcc = finalAcc.normalize().scale(maxAvailableForce);
            }
          } else {
            // Traction Saturation (Demand within 5% of grip ceiling):
            // Cleats grip up to maximum available traction. No slip status, no stumble, no divot.
            if (finalAcc.length() > maxAvailableForce) {
              finalAcc = finalAcc.normalize().scale(maxAvailableForce);
            }
          }
        }
      } else {
        this.slipStatus = {
          type: 'none',
          skidVelocity: Vector2.zero(),
          timer: 0,
          initialDuration: 0,
          tractionDemand,
          availableTraction,
          slipFoot: null,
          isControlled: false,
        };

        // Pitch wear and divots during normal aggressive maneuvers
        if (pitchSurface) {
          const tier = pitchSurface.getPitchTier();
          const shearThreshold = tier.divotShearThreshold;
          const maneuverShearAcc = requestedGroundAcc.length();

          if (strideState.phase === 'stance' && isDemandingMove) {
            const plantPos =
              strideState.plantPosition ??
              (strideState.currentFoot === 'left' ? strideState.leftFootPos : strideState.rightFootPos) ??
              currentState.position;

            // Step-normalized footstep wear (independent of 1/v dwell time):
            // Effective cadence guarantees step fraction is well-bounded even at low starting speeds
            const effCadence = Math.max(1.5, strideState.cadence);
            const stepFraction = 2.0 * effCadence * dt;

            // Biomechanical shear factor: explosive acceleration & plant cuts exert higher horizontal GRF
            const shearFactor = 1.0 + Math.min(2.5, maneuverShearAcc / 6.0);

            // Tier durability factor (Tier 1 hybrid: 0.08x, Tier 4 clay: 1.15x)
            const tierWear = pitchSurface.getTierWearMultiplier();

            // Rootzone moisture plasticization factor
            const wetMult = pitchSurface.getMoistureWearMultiplier(plantPos.x, plantPos.y);

            // Calibrated base wear per footstep contact
            const baseWearPerStep = 0.004;
            const wearInc = baseWearPerStep * stepFraction * shearFactor * tierWear * wetMult;

            // Apply at actual planted cleat footprint radius
            pitchSurface.addWear(plantPos.x, plantPos.y, 0.20, wearInc);
          }

          const isCuttingPlant = isCutting && currentSpeed > 4.5 && maneuverShearAcc > shearThreshold;
          const isHardBrakePlant = isBrakingPlant && currentSpeed > 4.5 && Math.abs(longAcc) > shearThreshold;

          if (
            (isCuttingPlant || isHardBrakePlant) &&
            strideState.phase === 'stance' &&
            strideState.phaseProgress > 0.15 &&
            strideState.phaseProgress < 0.70 &&
            simTime - this.lastDivotTime > 0.32
          ) {
            const plantPos = strideState.plantPosition ?? currentState.position;
            const localMoisture = pitchSurface.getMoistureAt(plantPos.x, plantPos.y);
            const isSlickOrPuddle = localMoisture >= 0.50 && this.studType === 'fg_plastic';
            if (!isSlickOrPuddle) {
              const heading = isHardBrakePlant ? currentFacing + Math.PI : currentFacing;
              const sev = Math.min(1.0, 0.35 + 0.65 * ((maneuverShearAcc - shearThreshold) / 5.0));
              pitchSurface.createDivot(plantPos, heading, sev, simTime);
              this.lastDivotTime = simTime;
            }
          }
        }
      }
    }

    // 6. Semi-Implicit Euler Integration
    let newVelocity = currentVel.add(finalAcc.scale(dt));

    // Zero out velocity when stopped or when active braking reaches zero
    if (!isDemandingMove && (newVelocity.length() < 0.20 || currentVel.dot(newVelocity) <= 0)) {
      newVelocity = Vector2.zero();
    }

    // When fully stopped and not demanding movement: enforce clean resting stance
    if (newVelocity.length() === 0 && !isDemandingMove) {
      strideState = {
        ...strideState,
        cadence: 0,
        strideLength: 0,
        phase: 'stance',
        phaseProgress: 1.0,
        isDoubleSupport: true,
        isBraking: false,
        plantPosition: null,
      };
    }

    const newPosition = currentState.position.add(newVelocity.scale(dt));

    // When sliding or wiping out: enforce realistic slide tackle lower body pose
    // Lead leg extended along slide direction, trailing leg bent/tucked under hip
    if (this.slipStatus.type === 'controlled_slide' || this.slipStatus.type === 'wipeout') {
      const slideDir = newVelocity.length() > 0.1 ? newVelocity.normalize() : Vector2.fromAngle(currentFacing);
      const slideNormal = new Vector2(-slideDir.y, slideDir.x);
      const isLeadLeft = this.slipStatus.slipFoot === 'left' || this.slipStatus.type === 'wipeout';

      const leadFootPos = newPosition.add(slideDir.scale(0.52)).add(slideNormal.scale(isLeadLeft ? 0.08 : -0.08));
      const trailFootPos = newPosition.sub(slideDir.scale(0.24)).add(slideNormal.scale(isLeadLeft ? -0.14 : 0.14));

      strideState = {
        ...strideState,
        cadence: 0,
        strideLength: 0,
        phase: 'stance',
        phaseProgress: 1.0,
        isDoubleSupport: false,
        isBraking: true,
        leftFootPos: isLeadLeft ? leadFootPos : trailFootPos,
        rightFootPos: isLeadLeft ? trailFootPos : leadFootPos,
        plantPosition: leadFootPos,
      };
    }

    // 7. Stamina Drain / Recovery with Pitch-Coupled Metabolic Work
    const localMoisture = pitchSurface
      ? pitchSurface.getMoistureAt(currentState.position.x, currentState.position.y)
      : (turfCondition === 'wet_slick' ? 0.65 : turfCondition === 'dry_heavy' ? 0.10 : 0.25);
    const grassHeight = pitchSurface ? pitchSurface.getGrassHeight() : 24.0;
    const grassWork = Math.max(0, (grassHeight - 24.0) / 12.0);
    const pitchFatigueMultiplier = Math.min(
      2.2,
      1.0 + 0.40 * localMoisture + 0.35 * grassWork + 0.50 * localWear
    );

    let newStamina = currentState.stamina;
    const staminaEfficiency = 0.75 + 0.50 * (this.attributes.stamina / 100);
    if (intent.gait === 'sprint' && isDemandingMove) {
      newStamina = Math.max(
        0,
        newStamina - dt * (0.05 / staminaEfficiency) * pitchFatigueMultiplier
      );
    } else if (intent.gait === 'jog' && isDemandingMove && localMoisture >= 0.70) {
      newStamina = Math.max(0, newStamina - dt * 0.015 * (localMoisture - 0.70));
    } else {
      const mudRecoveryDamping = Math.max(0.40, 1.0 - 0.60 * Math.max(0, localMoisture - 0.50));
      newStamina = Math.min(
        1.0,
        newStamina + dt * (0.08 * staminaEfficiency * mudRecoveryDamping)
      );
    }

    // 8. 3D Body Lean & Shoulder Counter-Rotation
    const facingFwd = Vector2.fromAngle(currentFacing);
    const facingNormal = new Vector2(-facingFwd.y, facingFwd.x);

    // Fore-aft acceleration lean (forward on acceleration, backward on braking)
    const leanLongAcc = targetAcc.dot(facingFwd);
    let baseFwdLean = Math.max(
      -SIM_CONFIG.PLAYER_BODY.MAX_ACCEL_LEAN,
      Math.min(
        SIM_CONFIG.PLAYER_BODY.MAX_ACCEL_LEAN,
        (leanLongAcc / maxPropAcc) * SIM_CONFIG.PLAYER_BODY.MAX_ACCEL_LEAN
      )
    );

    // Sprint Drive-Phase Forward Pitch Boost (Morin Acceleration Profile)
    if (leanLongAcc > 0 && currentSpeed < 4.5) {
      const driveFactor = (1.0 - currentSpeed / 4.5) * (leanLongAcc / maxPropAcc);
      baseFwdLean += driveFactor * SIM_CONFIG.PLAYER_BODY.DRIVE_PHASE_LEAN_BOOST;
    }
    const fwdLean = baseFwdLean;

    // Lateral centripetal turn bank (inward bank during cornering, stabilized by balance)
    const leanLatAcc = targetAcc.dot(facingNormal);
    const maxBankLean = SIM_CONFIG.PLAYER_BODY.MAX_BANK_LEAN * (0.80 + 0.35 * balFactor);
    const bankLean = Math.max(
      -maxBankLean,
      Math.min(
        maxBankLean,
        (leanLatAcc / maxLatGripBase) * maxBankLean
      )
    );

    let headOffset = facingFwd.scale(fwdLean).add(facingNormal.scale(bankLean));

    // Dynamic Crouch during High-G Lateral Plant Cuts (Mechanic 5: lowering COM like Messi)
    const crouchDepth = -0.045 * balFactor * Math.min(1.0, Math.abs(latAcc) / maxLatGripBase);
    let effectiveBounce = verticalBounce + crouchDepth;

    if (this.slipStatus.type === 'wipeout' || this.slipStatus.type === 'controlled_slide') {
      const slideDir = currentVel.length() > 0.1 ? currentVel.normalize() : facingFwd;
      headOffset = slideDir.scale(0.35); // body prone sliding forward
      effectiveBounce = -0.15; // hip & thigh dropped to turf
    } else if (this.slipStatus.type === 'micro_slip') {
      headOffset = headOffset.add(normalUnit.scale(0.08 * Math.sin(simTime * 25.0)));
    }

    // Axial Gaze Precedence (Head Leads Torso into Turns)
    let targetHeadYaw = 0;
    if (isDemandingMove && intent.moveDir.lengthSq() > 0.04) {
      const desiredAngle = intent.moveDir.angle();
      const gazeDiff = this.normalizeAngle(desiredAngle - currentFacing);
      targetHeadYaw = Math.max(
        -SIM_CONFIG.PLAYER_BODY.MAX_GAZE_LEAD,
        Math.min(SIM_CONFIG.PLAYER_BODY.MAX_GAZE_LEAD, gazeDiff * 0.45)
      );
    }
    // Smoothly track gaze yaw (fast neck response ~60ms)
    const headYawAlpha = Math.min(1.0, dt * 16.0);
    const headYaw = currentState.headYaw + (targetHeadYaw - currentState.headYaw) * headYawAlpha;

    // Shoulder / Arm Counter-Pumping:
    const speedRatio = Math.min(1.0, currentSpeed / maxSprintSpeed);
    const armPumpAmp = speedRatio * SIM_CONFIG.PLAYER_BODY.ARM_PUMP_MAX;
    const footSign = strideState.currentFoot === 'left' ? 1 : -1;
    const shoulderAngle = Math.sin(strideState.phaseProgress * Math.PI) * footSign * armPumpAmp;

    const nextState: PlayerState = {
      id: currentState.id,
      position: newPosition,
      velocity: newVelocity,
      facing: currentFacing,
      angularVelocity: nextAngularVelocity,
      stamina: newStamina,
      gait: intent.gait ?? 'jog',
      stride: strideState,
      headOffset,
      shoulderAngle: newVelocity.length() < 0.05 ? 0 : shoulderAngle,
      headYaw,
      verticalBounce: newVelocity.length() < 0.05 ? 0 : effectiveBounce,
      footedness: this.footedness,
      cutStatus,
      attributes: this.attributes,
      curveIndex,
      studType: this.studType,
      slipStatus: this.slipStatus,
      pitchFatigueMultiplier,
    };

    // Reduced vertical COM dynamics: stance feet generate a spring-damper ground
    // reaction, while flight follows gravity. The horizontal model uses the same
    // force convention below, with mass canceling naturally in Coulomb friction.
    const comHeightAtRest = this.attributes.heightCm / 100 * SIM_CONFIG.PLAYER_BODY.COM_HEIGHT_RATIO;
    const currentVerticalOffset = currentState.contactState
      ? currentState.contactState.centerOfMass.z - comHeightAtRest
      : currentState.verticalBounce;
    let verticalVelocity = currentState.contactState?.centerOfMassVelocity.z ?? 0;
    const hasVerticalSupport = strideState.phase === 'stance' || strideState.isDoubleSupport;
    const enteredFlight = currentState.stride.phase === 'stance' && strideState.phase === 'flight';
    if (enteredFlight) {
      const flightApex = SIM_CONFIG.PLAYER_BODY.VERTICAL_BOUNCE_MAX *
        Math.max(0.25, Math.min(1, currentSpeed / SIM_CONFIG.GAIT_SPEEDS.sprint));
      verticalVelocity = Math.max(verticalVelocity, Math.sqrt(2 * 9.81 * flightApex));
    }

    let verticalOffset = currentVerticalOffset;
    let verticalAcceleration = -9.81;
    let totalNormalLoad = 0;
    if (hasVerticalSupport) {
      const springFrequency = SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_SPRING_HZ;
      const dampingRatio = SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_DAMPING_RATIO;
      const targetOffset = Math.max(-0.12, Math.min(SIM_CONFIG.PLAYER_BODY.VERTICAL_BOUNCE_MAX, effectiveBounce));
      const requestedVerticalAcceleration = springFrequency * springFrequency * (targetOffset - currentVerticalOffset)
        - 2 * dampingRatio * springFrequency * verticalVelocity;
      totalNormalLoad = Math.max(0, Math.min(SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_MAX_SUPPORT_G * playerMassKg * 9.81,
        playerMassKg * (9.81 + requestedVerticalAcceleration)));
      verticalAcceleration = totalNormalLoad / playerMassKg - 9.81;
    }

    verticalVelocity += verticalAcceleration * dt;
    verticalOffset += verticalVelocity * dt;
    if (verticalOffset < SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_MIN_OFFSET) {
      verticalOffset = SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_MIN_OFFSET;
      if (verticalVelocity < 0) verticalVelocity = 0;
      if (hasVerticalSupport) {
        totalNormalLoad = playerMassKg * 9.81;
        verticalAcceleration = 0;
      }
    }

    const contactState = buildPlayerContactState(
      nextState,
      verticalOffset,
      verticalVelocity,
      verticalAcceleration,
      dt,
      currentState,
      finalAcc
    );

    return { ...nextState, contactState };
  }

  /**
   * Directional speed factor based on angle relative to torso facing:
   * 0 rad (forward) = 1.0
   * PI/2 rad (lateral shuffle) = 0.65 (modulated by balance: 0.56 to 0.74)
   * PI rad (backward) = 0.55
   */
  private calculateDirectionalSpeedFactor(relativeAngle: number, balFactor: number = 0.80): number {
    const halfPi = Math.PI / 2;
    const sideBonus = 0.18 * (balFactor - 0.50);
    const effectiveSideFactor = Math.max(
      0.45,
      Math.min(0.85, SIM_CONFIG.KINEMATICS.SPEED_FACTOR_SIDE + sideBonus)
    );

    if (relativeAngle <= halfPi) {
      // Forward to sideways [0, PI/2]
      const t = relativeAngle / halfPi;
      return 1.0 - (1.0 - effectiveSideFactor) * (1 - Math.cos(t * halfPi));
    } else {
      // Sideways to backward [PI/2, PI]
      const t = (relativeAngle - halfPi) / halfPi;
      return (
        effectiveSideFactor -
        (effectiveSideFactor - SIM_CONFIG.KINEMATICS.SPEED_FACTOR_BACK) * t
      );
    }
  }

  private normalizeAngle(rad: number): number {
    while (rad > Math.PI) rad -= 2 * Math.PI;
    while (rad < -Math.PI) rad += 2 * Math.PI;
    return rad;
  }

  reset(position: Vector2, facing: number): void {
    this.strideEngine.reset(position, facing);
    this.facingHoldTarget = null;
    this.slideStartPos = null;
    this.cutSettleTimer = 0;
    this.cutSettleDuration = 0;
    this.slipStatus = {
      type: 'none',
      skidVelocity: Vector2.zero(),
      timer: 0,
      initialDuration: 0,
      tractionDemand: 0,
      availableTraction: 1.25,
      slipFoot: null,
      isControlled: false,
    };
  }
}
