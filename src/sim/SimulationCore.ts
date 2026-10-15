import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SIM_CONFIG } from './config';
import { BootZoneId } from './collision/BootZones';
import { KickIntent, KickSwingController } from './collision/KickSwingController';
import { ContactBody, extractPlayerContactBodies } from './collision/ContactBody';
import { ContactManifold, SweptCollisionResolver } from './collision/SweptCollision';
import { LocomotionSystem } from './locomotion/LocomotionSystem';
import { BallPhysics } from './physics/BallPhysics';
import { PitchSurface } from './physics/PitchSurface';
import {
  BALL_PRESETS,
  BallModelConfig,
  BallState,
  FootDominance,
  Intent,
  PitchRut,
  PitchSurfaceState,
  PitchTierId,
  PitchTierProfile,
  PLAYER_PRESETS,
  PlayerAttributes,
  PlayerFootedness,
  PlayerState,
  StudType,
  TurfCondition,
  WindCondition,
} from './types';

/**
 * Headless Deterministic Simulation Core (120 Hz).
 * Pure TypeScript with zero DOM/browser dependencies.
 * Integrates Player Locomotion, 3D Aerodynamic Ball Physics, and Pitch Surface / Wear.
 */
export class SimulationCore {
  private readonly locomotion: LocomotionSystem;
  private readonly ball: BallPhysics;
  private readonly pitchSurface: PitchSurface;
  private currentState: PlayerState;
  private previousState: PlayerState;
  private currentBallState: BallState;
  private previousBallState: BallState;
  private readonly kickController: KickSwingController = new KickSwingController();
  private lastContactBodies: ContactBody[] = [];
  private simTime: number = 0;
  private readonly presetKeys: string[] = [
    'balanced',
    'explosive_agilist',
    'lengthy_powerhouse',
    'speed_demon',
    'heavy_anchor',
  ];
  private currentPresetIndex: number = 0;

  private readonly ballModelKeys: string[] = [
    'modern_match',
    'jabulani_2010',
    'classic_telstar',
    'futsal_lowbounce',
    'retro_leather',
  ];
  private currentBallModelIndex: number = 0;

  private readonly turfConditions: TurfCondition[] = [
    'standard',
    'wet_slick',
    'dry_heavy',
  ];
  private currentTurfIndex: number = 0;

  private readonly pitchTierKeys: PitchTierId[] = [
    'tier1_elite_hybrid',
    'tier2_pro_sand',
    'tier3_semipro_loam',
    'tier4_grassroots_clay',
  ];
  private currentPitchTierIndex: number = 0;

  private readonly precipitationLevels: number[] = [0, 15, 35];
  private currentPrecipitationIndex: number = 0;

  private readonly windPresets: WindCondition[] = [
    { speed: 0, heading: 0, gustIntensity: 0.1 },
    { speed: 6, heading: 0, gustIntensity: 0.2 }, // 6 m/s East
    { speed: 9, heading: Math.PI / 2, gustIntensity: 0.25 }, // 9 m/s North
    { speed: 13, heading: Math.PI, gustIntensity: 0.35 }, // 13 m/s West
  ];
  private currentWindIndex: number = 0;

  constructor(initialPosition: Vector2 = Vector2.zero(), initialFacing: number = 0) {
    this.locomotion = new LocomotionSystem(initialPosition, initialFacing);
    this.pitchSurface = new PitchSurface();

    // Initial ball placement ~0.6m in front of player
    const initialBallPos = new Vector3(
      initialPosition.x + 0.6 * Math.cos(initialFacing),
      initialPosition.y + 0.6 * Math.sin(initialFacing),
      SIM_CONFIG.BALL.RADIUS
    );
    this.ball = new BallPhysics(initialBallPos);
    this.currentBallState = this.ball.getState();
    this.previousBallState = this.currentBallState;

    const initialPlayerState: PlayerState = {
      id: 'player-1',
      position: initialPosition,
      velocity: Vector2.zero(),
      facing: initialFacing,
      angularVelocity: 0,
      stamina: 1.0,
      gait: 'jog',
      stride: {
        currentFoot: 'left',
        phase: 'stance',
        phaseProgress: 0,
        cadence: 0,
        strideLength: SIM_CONFIG.STRIDE.STRIDE_LEN_WALK,
        plantPosition: null,
        stanceWidth: SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL,
        leftFootPos: new Vector2(
          initialPosition.x - (SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL / 2) * Math.sin(initialFacing),
          initialPosition.y + (SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL / 2) * Math.cos(initialFacing)
        ),
        rightFootPos: new Vector2(
          initialPosition.x + (SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL / 2) * Math.sin(initialFacing),
          initialPosition.y - (SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL / 2) * Math.cos(initialFacing)
        ),
        isBraking: false,
        chopStepsRemaining: 0,
        pelvicAngle: 0,
        lateralSway: 0,
        isDropStep: false,
        isDoubleSupport: false,
      },
      headOffset: Vector2.zero(),
      shoulderAngle: 0,
      headYaw: 0,
      verticalBounce: 0,
      footedness: this.locomotion.getFootedness(),
      cutStatus: {
        isCutting: false,
        plantFoot: null,
        isOutsideFoot: false,
        isDominantPlant: true,
        plantEfficiency: 1.0,
      },
      attributes: this.locomotion.getAttributes(),
      curveIndex: this.locomotion.getCurveIndex(),
      studType: this.locomotion.getStudType(),
      slipStatus: this.locomotion.getSlipStatus(),
      pitchFatigueMultiplier: 1.0,
    };

    this.currentState = initialPlayerState;
    this.previousState = initialPlayerState;
  }

  step(intent: Intent, dt: number = SIM_CONFIG.LOOP.FIXED_DT): void {
    this.previousState = this.currentState;
    this.previousBallState = this.currentBallState;
    let nextState = this.locomotion.step(
      this.currentState,
      intent,
      dt,
      this.pitchSurface,
      this.getTurfCondition(),
      this.simTime
    );

    // Pitch boundary clamping (with runoff margin)
    const halfLen = SIM_CONFIG.PITCH.LENGTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;
    const halfWidth = SIM_CONFIG.PITCH.WIDTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;

    let clampedX = Math.max(-halfLen, Math.min(halfLen, nextState.position.x));
    let clampedY = Math.max(-halfWidth, Math.min(halfWidth, nextState.position.y));

    if (clampedX !== nextState.position.x || clampedY !== nextState.position.y) {
      nextState = {
        ...nextState,
        position: new Vector2(clampedX, clampedY),
        velocity: Vector2.zero(), // Stop at barrier
      };
    }

    this.currentState = nextState;
    this.pitchSurface.step(dt);

    // Step kinematic kick swing controller
    this.kickController.step(dt, this.currentState);

    // Relative swept collision sub-stepping loop tracking tickElapsed
    let tickElapsed = 0;
    const maxSubsteps = SIM_CONFIG.COLLISION.MAX_SUBSTEPS;

    for (let s = 0; s < maxSubsteps; s++) {
      const remDt = dt - tickElapsed;
      if (remDt <= SIM_CONFIG.COLLISION.SUBSTEP_EPSILON) break;

      const tauStart = Math.min(1.0, tickElapsed / dt);
      const override = this.kickController.getBootOverride();
      const overrideLeft = override && override.foot === 'left' ? override.data : undefined;
      const overrideRight = override && override.foot === 'right' ? override.data : undefined;

      const bodies = extractPlayerContactBodies(
        this.previousState,
        this.currentState,
        dt,
        tauStart,
        overrideLeft,
        overrideRight
      );
      this.lastContactBodies = bodies;

      let earliestHit: ContactManifold | null = null;
      const bState = this.ball.getState();

      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const hit = SweptCollisionResolver.checkCollision(
          bState.position,
          bState.velocity,
          this.ball.radius,
          body,
          remDt
        );
        if (hit && (!earliestHit || hit.toi < earliestHit.toi)) {
          earliestHit = hit;
        }
      }

      if (!earliestHit) {
        // No further collision in remaining interval: integrate standard flight/roll
        this.currentBallState = this.ball.step(remDt, this.simTime + tickElapsed, this.pitchSurface);
        tickElapsed = dt;
        break;
      }

      // Advance ball up to exact moment of impact
      const subDuration = Math.max(0, earliestHit.toi * remDt);
      if (subDuration > SIM_CONFIG.COLLISION.SUBSTEP_EPSILON) {
        this.currentBallState = this.ball.step(subDuration, this.simTime + tickElapsed, this.pitchSurface);
        tickElapsed += subDuration;
      }

      // Exact normalized fraction of tick at impact: t = tickElapsed / dt
      const tauImpact = Math.min(1.0, tickElapsed / dt);
      const ballAtImpact = this.ball.getState();

      let bodyAtHit = earliestHit.body;
      let contactManifold: ContactManifold = earliestHit;

      // 2 iterations: re-pose bodies at tauImpact and recompute contact point, normal, penetration, and sParam
      for (let iter = 0; iter < 2; iter++) {
        const bodiesAtImpact = extractPlayerContactBodies(
          this.previousState,
          this.currentState,
          dt,
          tauImpact,
          overrideLeft,
          overrideRight
        );
        bodyAtHit = bodiesAtImpact.find((b) => b.id === earliestHit!.body.id) ?? bodyAtHit;

        const refined = SweptCollisionResolver.refineContactGeometry(
          ballAtImpact.position,
          this.ball.radius,
          bodyAtHit
        );

        contactManifold = {
          body: bodyAtHit,
          toi: earliestHit.toi,
          contactPoint: refined.contactPoint,
          normal: refined.normal,
          penetration: refined.penetration,
          sParam: refined.sParam,
        };
      }

      const manifoldAtHit = contactManifold;

      // Resolve contact impulse & Coulomb friction
      const ballAtHit = this.ball.getState();
      const impulseRes = SweptCollisionResolver.resolveImpulse(
        manifoldAtHit,
        ballAtHit.velocity,
        ballAtHit.spin,
        this.ball.mass,
        this.ball.inertia,
        this.ball.radius
      );

      // Record contact telemetry marker for visualization
      if (impulseRes.contactZone) {
        this.kickController.recordContact(
          manifoldAtHit.contactPoint,
          manifoldAtHit.normal,
          impulseRes.contactZone,
          impulseRes.netImpulse,
          this.simTime + tickElapsed
        );
      }

      // Apply linear impulse
      this.ball.applyImpulse(impulseRes.deltaV.scale(this.ball.mass));

      // Apply spin delta and positional separation
      const postImpulse = this.ball.getState();
      let correctedPos = postImpulse.position.add(impulseRes.posCorrection);

      // Ground pin clamping: keep ball above turf level
      if (correctedPos.z < this.ball.radius) {
        correctedPos = new Vector3(correctedPos.x, correctedPos.y, this.ball.radius);
        if (postImpulse.velocity.z < 0) {
          this.ball.setState({
            ...postImpulse,
            position: correctedPos,
            velocity: new Vector3(
              postImpulse.velocity.x,
              postImpulse.velocity.y,
              Math.max(0, -postImpulse.velocity.z * SIM_CONFIG.COLLISION.GROUND_PIN_REBOUND_FACTOR)
            ),
            spin: postImpulse.spin.add(impulseRes.deltaOmega),
          });
        } else {
          this.ball.setState({
            ...postImpulse,
            position: correctedPos,
            spin: postImpulse.spin.add(impulseRes.deltaOmega),
          });
        }
      } else {
        this.ball.setState({
          ...postImpulse,
          position: correctedPos,
          spin: postImpulse.spin.add(impulseRes.deltaOmega),
        });
      }
    }

    const leftoverDt = dt - tickElapsed;
    if (leftoverDt > SIM_CONFIG.COLLISION.SUBSTEP_EPSILON) {
      this.currentBallState = this.ball.step(leftoverDt, this.simTime + tickElapsed, this.pitchSurface);
    }

    this.simTime += dt;
  }

  getCurrentState(): PlayerState {
    return this.currentState;
  }

  getPreviousState(): PlayerState {
    return this.previousState;
  }

  getSimTime(): number {
    return this.simTime;
  }

  getContactBodies(): readonly ContactBody[] {
    return this.lastContactBodies;
  }

  reset(position: Vector2 = Vector2.zero(), facing: number = 0): void {
    this.locomotion.reset(position, facing);
    this.simTime = 0;

    const resetState: PlayerState = {
      id: 'player-1',
      position,
      velocity: Vector2.zero(),
      facing,
      angularVelocity: 0,
      stamina: 1.0,
      gait: 'jog',
      stride: {
        currentFoot: 'left',
        phase: 'stance',
        phaseProgress: 0,
        cadence: 0,
        strideLength: SIM_CONFIG.STRIDE.STRIDE_LEN_WALK,
        plantPosition: null,
        stanceWidth: SIM_CONFIG.STRIDE.STANCE_WIDTH_NORMAL,
        leftFootPos: position,
        rightFootPos: position,
        isBraking: false,
        chopStepsRemaining: 0,
        pelvicAngle: 0,
        lateralSway: 0,
        isDropStep: false,
        isDoubleSupport: true,
      },
      headOffset: Vector2.zero(),
      shoulderAngle: 0,
      headYaw: 0,
      verticalBounce: 0,
      footedness: this.locomotion.getFootedness(),
      cutStatus: {
        isCutting: false,
        plantFoot: null,
        isOutsideFoot: false,
        isDominantPlant: true,
        plantEfficiency: 1.0,
      },
      attributes: this.locomotion.getAttributes(),
      curveIndex: this.locomotion.getCurveIndex(),
      studType: this.locomotion.getStudType(),
      slipStatus: this.locomotion.getSlipStatus(),
      pitchFatigueMultiplier: 1.0,
    };

    this.currentState = resetState;
    this.previousState = resetState;
    this.kickController.reset();

    const ballPos = new Vector3(
      position.x + 0.6 * Math.cos(facing),
      position.y + 0.6 * Math.sin(facing),
      SIM_CONFIG.BALL.RADIUS
    );
    this.ball.reset(ballPos);
    this.currentBallState = this.ball.getState();
    this.previousBallState = this.currentBallState;
  }

  getAttributes(): PlayerAttributes {
    return this.locomotion.getAttributes();
  }

  setAttributes(attributes: PlayerAttributes): void {
    this.locomotion.setAttributes(attributes);
    this.currentState = {
      ...this.currentState,
      attributes,
      curveIndex: this.locomotion.getCurveIndex(),
      footedness: attributes.footedness,
    };
  }

  setStamina(stamina: number): void {
    const clamped = Math.max(0, Math.min(1.0, stamina));
    this.currentState = {
      ...this.currentState,
      stamina: clamped,
    };
  }

  cyclePreset(): PlayerAttributes {
    this.currentPresetIndex = (this.currentPresetIndex + 1) % this.presetKeys.length;
    const key = this.presetKeys[this.currentPresetIndex];
    const newPreset = PLAYER_PRESETS[key];
    this.setAttributes(newPreset);
    return newPreset;
  }

  setPreset(key: string): PlayerAttributes {
    const preset = PLAYER_PRESETS[key];
    if (preset) {
      const idx = this.presetKeys.indexOf(key);
      if (idx !== -1) this.currentPresetIndex = idx;
      this.setAttributes(preset);
      return preset;
    }
    return this.getAttributes();
  }

  toggleFootedness(): PlayerFootedness {
    const current = this.locomotion.getFootedness().dominantFoot;
    let nextFoot: FootDominance;
    let nextWeak: number;

    if (current === 'right') {
      nextFoot = 'left';
      nextWeak = 0.2; // Left-footed (weak right 1-star)
    } else if (current === 'left') {
      nextFoot = 'both';
      nextWeak = 1.0; // Ambipedal (both feet 5-star)
    } else {
      nextFoot = 'right';
      nextWeak = 0.2; // Right-footed (weak left 1-star)
    }

    const newFootedness: PlayerFootedness = {
      dominantFoot: nextFoot,
      weakFootAbility: nextWeak,
    };
    this.locomotion.setFootedness(newFootedness);

    // Synchronize active attributes footedness
    const updatedAttrs: PlayerAttributes = {
      ...this.locomotion.getAttributes(),
      footedness: newFootedness,
    };
    this.locomotion.setAttributes(updatedAttrs);
    this.currentState = {
      ...this.currentState,
      attributes: updatedAttrs,
      footedness: newFootedness,
    };
    return newFootedness;
  }

  setFootedness(footedness: PlayerFootedness): void {
    this.locomotion.setFootedness(footedness);
    const updatedAttrs: PlayerAttributes = {
      ...this.locomotion.getAttributes(),
      footedness,
    };
    this.locomotion.setAttributes(updatedAttrs);
    this.currentState = {
      ...this.currentState,
      attributes: updatedAttrs,
      footedness,
    };
  }

  getBallState(): BallState {
    return this.currentBallState;
  }

  getPreviousBallState(): BallState {
    return this.previousBallState;
  }

  getKickController(): KickSwingController {
    return this.kickController;
  }

  requestKick(intent: KickIntent): { success: boolean; reason?: string } {
    return this.kickController.requestKick(intent, this.currentState, this.currentBallState);
  }

  requestKickPreset(presetIndex: number, headingRad?: number): { success: boolean; reason?: string } {
    const heading = headingRad ?? this.currentState.facing;
    switch (presetIndex) {
      case 1:
        // Preset 1: Ground Pass (14 m/s, 0° elevation, medial inside boot)
        return this.requestKick({
          desiredSpeed: 14.0,
          elevationDeg: 0,
          headingRad: heading,
          contactZone: 'medial',
          ankleStiffness: 0.85,
        });
      case 2:
        // Preset 2: Curving Free-Kick (24 m/s, 12° elevation, +7 RPS sidespin curl)
        return this.requestKick({
          desiredSpeed: 24.0,
          elevationDeg: 12,
          headingRad: heading,
          sidespinRps: 7.0,
          backspinRps: 2.0,
          contactZone: 'medial',
          ankleStiffness: 0.95,
        });
      case 3:
        // Preset 3: Chipped Lob (16 m/s, 28° elevation, +5.5 RPS backspin lift)
        return this.requestKick({
          desiredSpeed: 16.0,
          elevationDeg: 28,
          headingRad: heading,
          backspinRps: 5.5,
          contactZone: 'toe',
          ankleStiffness: 0.75,
        });
      case 4:
        // Preset 4: Trivela Curve (22 m/s, 10° elevation, -6 RPS outside curl)
        return this.requestKick({
          desiredSpeed: 22.0,
          elevationDeg: 10,
          headingRad: heading,
          sidespinRps: -6.0,
          backspinRps: 1.5,
          contactZone: 'lateral',
          ankleStiffness: 0.90,
        });
      case 5:
        // Preset 5: Knuckleball Strike (28 m/s, 7.5° elevation, dead center laces, 0 spin)
        return this.requestKick({
          desiredSpeed: 28.0,
          elevationDeg: 7.5,
          headingRad: heading,
          sidespinRps: 0,
          backspinRps: 0,
          contactZone: 'instep',
          ankleStiffness: 1.0,
        });
      default:
        return { success: false, reason: `Unknown preset index ${presetIndex}` };
    }
  }

  requestClickKick(targetWorld: Vector2): { success: boolean; reason?: string } {
    const ballPos = this.currentBallState.position;
    const dx = targetWorld.x - ballPos.x;
    const dy = targetWorld.y - ballPos.y;
    const dist = Math.hypot(dx, dy);
    const heading = Math.atan2(dy, dx);

    const speed = Math.min(26, Math.max(12, dist * 1.4));
    const elevation = dist > 14 ? 8 : 0;
    const zone: BootZoneId = elevation > 0 ? 'instep' : 'medial';

    return this.requestKick({
      desiredSpeed: speed,
      elevationDeg: elevation,
      headingRad: heading,
      contactZone: zone,
      ankleStiffness: 0.88,
    });
  }

  /**
   * @deprecated Test-only manual ball mutation. Gameplay routes through requestKick().
   */
  kickBall(
    speed: number,
    elevationDeg: number,
    headingRad: number,
    sidespinRps: number = 0,
    backspinRps: number = 0
  ): void {
    this.ball.kick(speed, elevationDeg, headingRad, sidespinRps, backspinRps);
    this.currentBallState = this.ball.getState();
  }

  /**
   * @deprecated Test-only manual impulse application. Gameplay routes through requestKick().
   */
  applyBallImpulse(impulse: Vector3, contactOffset: Vector3 = Vector3.zero()): void {
    this.ball.applyImpulse(impulse, contactOffset);
    this.currentBallState = this.ball.getState();
  }

  resetBall(position?: Vector3): void {
    const targetPos =
      position ??
      new Vector3(
        this.currentState.position.x + 0.6 * Math.cos(this.currentState.facing),
        this.currentState.position.y + 0.6 * Math.sin(this.currentState.facing),
        this.ball.radius
      );
    this.ball.reset(targetPos);
    this.currentBallState = this.ball.getState();
    this.previousBallState = this.currentBallState;
  }

  cycleBallModel(): BallModelConfig {
    this.currentBallModelIndex =
      (this.currentBallModelIndex + 1) % this.ballModelKeys.length;
    const key = this.ballModelKeys[this.currentBallModelIndex];
    const model = BALL_PRESETS[key];
    this.ball.setBallModel(model);
    this.currentBallState = this.ball.getState();
    return model;
  }

  setBallModel(keyOrModel: string | BallModelConfig): BallModelConfig {
    const model =
      typeof keyOrModel === 'string'
        ? BALL_PRESETS[keyOrModel] ?? BALL_PRESETS.modern_match
        : keyOrModel;
    const idx = this.ballModelKeys.indexOf(model.id);
    if (idx !== -1) this.currentBallModelIndex = idx;
    this.ball.setBallModel(model);
    this.currentBallState = this.ball.getState();
    return model;
  }

  getBallModel(): BallModelConfig {
    return this.ball.getBallModel();
  }

  cycleTurfCondition(): TurfCondition {
    this.currentTurfIndex = (this.currentTurfIndex + 1) % this.turfConditions.length;
    const cond = this.turfConditions[this.currentTurfIndex];
    return this.setTurfCondition(cond);
  }

  setTurfCondition(cond: TurfCondition): TurfCondition {
    this.ball.setTurfCondition(cond);
    const idx = this.turfConditions.indexOf(cond);
    if (idx !== -1) this.currentTurfIndex = idx;
    if (cond === 'wet_slick') {
      this.pitchSurface.setBaseMoisture(0.65);
      this.pitchSurface.spawnNaturalPuddles();
      this.pitchSurface.setPrecipitation(15.0);
      this.currentPrecipitationIndex = 1;
      this.pitchSurface.setGrassHeight(22.0);
    } else if (cond === 'dry_heavy') {
      this.pitchSurface.clearPuddles();
      this.pitchSurface.setPrecipitation(0.0);
      this.currentPrecipitationIndex = 0;
      this.pitchSurface.setBaseMoisture(0.10);
      this.pitchSurface.setGrassHeight(32.0);
    } else {
      this.pitchSurface.clearPuddles();
      this.pitchSurface.setPrecipitation(0.0);
      this.currentPrecipitationIndex = 0;
      this.pitchSurface.setBaseMoisture(0.25);
      this.pitchSurface.setGrassHeight(24.0);
    }
    this.currentBallState = this.ball.getState();
    return cond;
  }

  getTurfCondition(): TurfCondition {
    return this.ball.getTurfCondition();
  }

  getWind(): WindCondition {
    return this.ball.getWind();
  }

  setWind(wind: WindCondition): void {
    this.ball.setWind(wind);
  }

  getPitchSurface(): PitchSurface {
    return this.pitchSurface;
  }

  getPitchSurfaceState(): PitchSurfaceState {
    return this.pitchSurface.getState();
  }

  getGrassHeight(): number {
    return this.pitchSurface.getGrassHeight();
  }

  setGrassHeight(heightMm: number): void {
    this.pitchSurface.setGrassHeight(heightMm);
  }

  changeGrassHeight(deltaMm: number): number {
    return this.pitchSurface.changeGrassHeight(deltaMm);
  }

  getBaseMoisture(): number {
    return this.pitchSurface.getBaseMoisture();
  }

  setBaseMoisture(moisture: number): void {
    this.pitchSurface.setBaseMoisture(moisture);
  }

  cycleMoisture(): number {
    return this.pitchSurface.cycleMoisture();
  }

  addWaterPuddle(center: Vector2, radius: number, intensity: number = 0.90): void {
    this.pitchSurface.addPuddle(center, radius, intensity);
  }

  getRuts(): readonly PitchRut[] {
    return this.pitchSurface.getRuts();
  }

  getStudType(): StudType {
    return this.locomotion.getStudType();
  }

  setStudType(type: StudType): void {
    this.locomotion.setStudType(type);
    this.currentState = {
      ...this.currentState,
      studType: type,
    };
  }

  toggleStudType(): StudType {
    const next = this.locomotion.toggleStudType();
    this.currentState = {
      ...this.currentState,
      studType: next,
    };
    return next;
  }

  getPitchTier(): PitchTierProfile {
    return this.pitchSurface.getPitchTier();
  }

  setPitchTier(tier: PitchTierId | PitchTierProfile): PitchTierProfile {
    this.pitchSurface.setPitchTier(tier);
    const tierProfile = this.pitchSurface.getPitchTier();
    const idx = this.pitchTierKeys.indexOf(tierProfile.id);
    if (idx !== -1) this.currentPitchTierIndex = idx;
    return tierProfile;
  }

  cyclePitchTier(): PitchTierProfile {
    this.currentPitchTierIndex = (this.currentPitchTierIndex + 1) % this.pitchTierKeys.length;
    const tierId = this.pitchTierKeys[this.currentPitchTierIndex];
    return this.setPitchTier(tierId);
  }

  getPrecipitation(): number {
    return this.pitchSurface.getPrecipitation();
  }

  setPrecipitation(mmH: number): void {
    this.pitchSurface.setPrecipitation(mmH);
  }

  cyclePrecipitation(): number {
    this.currentPrecipitationIndex =
      (this.currentPrecipitationIndex + 1) % this.precipitationLevels.length;
    const rate = this.precipitationLevels[this.currentPrecipitationIndex];
    this.setPrecipitation(rate);
    return rate;
  }

  cycleWind(): WindCondition {
    this.currentWindIndex = (this.currentWindIndex + 1) % this.windPresets.length;
    const wind = this.windPresets[this.currentWindIndex];
    this.setWind(wind);
    return wind;
  }

  getCleggHardness(x?: number, y?: number): number {
    return this.pitchSurface.getCleggHardness(x, y);
  }

  simulateMatchTraffic(minutes: number, intensity: number = 1.0): void {
    this.pitchSurface.simulateMatchTraffic(minutes, intensity);
  }

  clearPitchDamage(): void {
    this.pitchSurface.clearDamage();
  }

  clearPuddles(): void {
    this.pitchSurface.clearPuddles();
  }

  getSimulatedMatchMinutes(): number {
    return this.pitchSurface.getSimulatedMatchMinutes();
  }
}
