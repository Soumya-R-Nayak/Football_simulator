import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import { PitchSurface } from './PitchSurface';
import {
  BALL_PRESETS,
  BallFlightState,
  BallModelConfig,
  BallState,
  DragRegime,
  TURF_PRESETS,
  TurfCondition,
  WindCondition,
} from '../types';

/**
 * 3D Aerodynamic Ball Physics Core (FIFA Quality Pro Multi-Ball Simulation).
 * Simulates:
 * - Real-world ball model presets (Modern Match, Jabulani 2010, Classic Telstar 32, Futsal Low-Bounce, Retro Leather)
 * - Dynamic Drag Crisis: Reynolds-number dependent drag drop from subcritical to supercritical turbulent flow
 * - Chaotic Knuckleball Seam Aerodynamics: asymmetric vortex shedding on low-spin driven strikes
 * - Atmospheric Wind Vectors & Gust Dynamics: relative airspeed coupling to Drag and Magnus tensors
 * - Non-Linear Spin Parameter (S = r·ω/v) producing late-flight sharp Magnus curl
 * - Turf Condition Profiles (Standard, Wet Slick, Dry Heavy)
 * - Inelastic turf collision with tangential spin-momentum exchange (backspin check-up vs topspin surge)
 * - Dynamic ground slip-to-roll transition & turf rolling resistance
 */
export class BallPhysics {
  private position: Vector3;
  private velocity: Vector3;
  private spin: Vector3; // Angular velocity (rad/s)
  private flightState: BallFlightState = 'at_rest';
  private lastContactTime: number = -1;

  // Active Ball Model and Turf Profile
  private model: BallModelConfig;
  private turfCondition: TurfCondition = 'standard';
  private dragRegime: DragRegime = 'subcritical';
  private isKnuckling: boolean = false;
  private knucklePhase: number = 0; // Cumulative phase for chaotic seam vortex shedding
  private wind: WindCondition = { speed: 0.0, heading: 0.0, gustIntensity: 0.20 };

  constructor(
    initialPositionOrModel?: Vector3 | BallModelConfig,
    model?: BallModelConfig,
    turf: TurfCondition = 'standard'
  ) {
    if (initialPositionOrModel && 'radius' in initialPositionOrModel && 'mass' in initialPositionOrModel) {
      this.model = initialPositionOrModel;
      this.position = new Vector3(0, 0, this.model.radius);
      this.turfCondition = turf;
    } else {
      this.position = (initialPositionOrModel as Vector3) ?? new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS);
      this.model = model ?? BALL_PRESETS.modern_match;
      this.turfCondition = turf;
    }
    this.velocity = Vector3.zero();
    this.spin = Vector3.zero();
  }

  get radius(): number {
    return this.model.radius;
  }

  get mass(): number {
    return this.model.mass;
  }

  get inertia(): number {
    return this.model.inertia;
  }

  get area(): number {
    return Math.PI * this.model.radius * this.model.radius;
  }

  getBallModel(): BallModelConfig {
    return this.model;
  }

  setBallModel(model: BallModelConfig): void {
    this.model = model;
    // Adjust ground contact altitude if resting on turf
    if (this.position.z <= this.model.radius + 1e-3 && Math.abs(this.velocity.z) < 1e-3) {
      this.position = new Vector3(this.position.x, this.position.y, this.model.radius);
    }
  }

  getTurfCondition(): TurfCondition {
    return this.turfCondition;
  }

  setTurfCondition(turf: TurfCondition): void {
    this.turfCondition = turf;
  }

  getWind(): WindCondition {
    return this.wind;
  }

  setWind(windOrSpeed: WindCondition | number, heading: number = 0, gustIntensity: number = 0.20): void {
    if (typeof windOrSpeed === 'object') {
      this.wind = {
        speed: Math.max(0, windOrSpeed.speed),
        heading: windOrSpeed.heading,
        gustIntensity: Math.max(0, Math.min(1.0, windOrSpeed.gustIntensity ?? 0.20)),
      };
    } else {
      this.wind = {
        speed: Math.max(0, windOrSpeed),
        heading,
        gustIntensity: Math.max(0, Math.min(1.0, gustIntensity)),
      };
    }
  }

  getState(): BallState {
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      spin: this.spin.clone(),
      flightState: this.flightState,
      lastContactTime: this.lastContactTime,
      modelId: this.model.id,
      dragRegime: this.dragRegime,
      isKnuckling: this.isKnuckling,
      turfCondition: this.turfCondition,
      wind: { ...this.wind },
    };
  }

  setState(state: BallState): void {
    this.position = state.position.clone();
    this.velocity = state.velocity.clone();
    this.spin = state.spin.clone();
    this.flightState = state.flightState;
    this.lastContactTime = state.lastContactTime;
    if (state.modelId && BALL_PRESETS[state.modelId]) {
      this.model = BALL_PRESETS[state.modelId];
    }
    if (state.turfCondition) {
      this.turfCondition = state.turfCondition;
    }
    this.dragRegime = state.dragRegime ?? 'subcritical';
    this.isKnuckling = state.isKnuckling ?? false;
  }

  reset(position: Vector3 = new Vector3(0, 0, this.radius)): void {
    this.position = position;
    this.velocity = Vector3.zero();
    this.spin = Vector3.zero();
    this.flightState = 'at_rest';
    this.lastContactTime = 0;
    this.dragRegime = 'subcritical';
    this.isKnuckling = false;
    this.knucklePhase = 0;
  }

  /**
   * Applies an instantaneous strike impulse J (N·s = kg·m/s) at contact offset r (meters from ball center).
   * Generates both linear velocity change (Δv = J / m) and rotational spin change (Δω = (r × J) / I).
   */
  applyImpulse(impulse: Vector3, contactOffset: Vector3 = Vector3.zero()): void {
    this.velocity = this.velocity.add(impulse.scale(1 / this.mass));

    if (contactOffset.lengthSq() > 1e-6) {
      const torqueImpulse = contactOffset.cross(impulse);
      const deltaSpin = torqueImpulse.scale(1 / this.inertia);
      this.spin = this.spin.add(deltaSpin);
    }

    if (this.velocity.z > 0.1 || this.position.z > this.radius + 0.01) {
      this.flightState = 'flight';
    } else if (this.velocity.length() > SIM_CONFIG.BALL.STOP_VELOCITY_THRESHOLD) {
      this.flightState = 'rolling';
    }
  }

  /**
   * Helper to launch realistic shots, passes, and lobs.
   * @param speed Initial speed in m/s (e.g. 10 - 32 m/s)
   * @param elevationDeg Vertical launch angle in degrees (e.g. 0° ground, 12° driven, 28° chip)
   * @param headingRad Horizontal direction in radians (0 = East, -PI/2 = North, etc.)
   * @param sidespinRps Sidespin in revolutions/sec (+ for counter-clockwise / inside curl, - for outside / trivela)
   * @param backspinRps Backspin in revolutions/sec (+ for backspin lift, - for topspin dip)
   */
  kick(
    speed: number,
    elevationDeg: number,
    headingRad: number,
    sidespinRps: number = 0,
    backspinRps: number = 0
  ): void {
    const elevRad = (elevationDeg * Math.PI) / 180;
    const cosElev = Math.cos(elevRad);
    const sinElev = Math.sin(elevRad);

    const vx = speed * cosElev * Math.cos(headingRad);
    const vy = speed * cosElev * Math.sin(headingRad);
    const vz = speed * sinElev;

    // Convert spin from revolutions per second (RPS) to rad/s
    const omegaZ = sidespinRps * 2 * Math.PI;

    // Heading perpendicular vector for backspin/topspin axis:
    // For ball heading in (cos(h), sin(h)), backspin axis is (sin(h), -cos(h), 0)
    // so that ω × v produces positive z (upward lift) for positive backspin
    const backspinRadS = backspinRps * 2 * Math.PI;
    const omegaX = Math.sin(headingRad) * backspinRadS;
    const omegaY = -Math.cos(headingRad) * backspinRadS;

    this.velocity = new Vector3(vx, vy, vz);
    this.spin = new Vector3(omegaX, omegaY, omegaZ);

    if (vz > 0.2 || this.position.z > this.radius + 0.01) {
      this.flightState = 'flight';
    } else {
      this.flightState = 'rolling';
    }
  }

  step(dt: number, simTime: number, pitchSurface?: PitchSurface): BallState {
    const groundZ =
      this.radius +
      (pitchSurface
        ? pitchSurface.getTopographyHeight(this.position.x, this.position.y)
        : 0);
    const isSettledOnTurf =
      this.position.z <= groundZ + 1e-4 && Math.abs(this.velocity.z) < 1e-3;

    if (!isSettledOnTurf) {
      this.stepInFlight(dt, simTime, pitchSurface);
    } else {
      this.stepOnTurf(dt, simTime, pitchSurface);
    }

    // Pitch boundary clamping & soft bounce off perimeter advertising boards
    const halfLen = SIM_CONFIG.PITCH.LENGTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;
    const halfWidth = SIM_CONFIG.PITCH.WIDTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;

    if (Math.abs(this.position.x) > halfLen) {
      const signX = Math.sign(this.position.x);
      this.position = new Vector3(signX * halfLen, this.position.y, this.position.z);
      this.velocity = new Vector3(-this.velocity.x * 0.45, this.velocity.y * 0.85, this.velocity.z);
    }

    if (Math.abs(this.position.y) > halfWidth) {
      const signY = Math.sign(this.position.y);
      this.position = new Vector3(this.position.x, signY * halfWidth, this.position.z);
      this.velocity = new Vector3(this.velocity.x * 0.85, -this.velocity.y * 0.45, this.velocity.z);
    }

    return this.getState();
  }

  /**
   * Flight physics integration (Gravity, Drag Crisis, Knuckleball Aerodynamics, Magnus Lift/Swerve, Spin Decay).
   */
  private stepInFlight(
    dt: number,
    simTime: number = 0,
    pitchSurface?: PitchSurface
  ): void {
    const v = this.velocity;

    // Atmospheric wind vector with dynamic low-frequency gust modulation
    let windV = Vector3.zero();
    if (this.wind.speed > 0) {
      const gust =
        1.0 +
        this.wind.gustIntensity *
          Math.sin(simTime * 0.45 + 1.2) *
          Math.cos(simTime * 0.28);
      const effSpeed = Math.max(0, this.wind.speed * gust);
      windV = new Vector3(
        effSpeed * Math.cos(this.wind.heading),
        effSpeed * Math.sin(this.wind.heading),
        0
      );
    }

    // Relative airspeed of ball with respect to moving air mass
    const vRel = v.sub(windV);
    const speedRel = vRel.length();

    // 1. Gravity (g = 9.81 m/s² downward)
    const gravAcc = new Vector3(0, 0, -SIM_CONFIG.BALL.GRAVITY);

    // 2. Dynamic Drag Crisis (governed by relative Reynolds number)
    let dragAcc = Vector3.zero();
    if (speedRel > 0.05) {
      const vc = this.model.criticalSpeed;
      const w = 3.0; // Transition zone half-width in m/s

      let cd: number;
      if (speedRel < vc - w) {
        this.dragRegime = 'subcritical';
        cd = this.model.baseCd;
      } else if (speedRel > vc + w) {
        this.dragRegime = 'supercritical';
        cd = this.model.supercriticalCd;
      } else {
        this.dragRegime = 'transitional';
        const u = (speedRel - (vc - w)) / (2 * w);
        const s = u * u * (3 - 2 * u); // Smooth cubic Hermite
        cd = this.model.baseCd + s * (this.model.supercriticalCd - this.model.baseCd);
      }

      const dragMag =
        0.5 *
        SIM_CONFIG.BALL.AIR_DENSITY *
        cd *
        this.area *
        speedRel *
        speedRel;
      dragAcc = vRel.normalize().scale(-dragMag / this.mass);
    } else {
      this.dragRegime = 'subcritical';
    }

    // 3. Chaotic Knuckleball Seam Aerodynamics (relative vortex shedding)
    let knuckleAcc = Vector3.zero();
    const spinMag = this.spin.length();

    if (speedRel > 18.0 && spinMag < 6.0 && this.model.seamRoughness > 0.05) {
      this.isKnuckling = true;
      // Strouhal shedding frequency St ≈ (0.18 * v_rel) / d
      const freq = (0.18 * speedRel) / (2 * this.radius);
      this.knucklePhase += freq * 2 * Math.PI * dt;

      // Coordinate frame orthogonal to relative flight velocity
      const vDir = vRel.normalize();
      const upRef = Math.abs(vDir.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const perp1 = vDir.cross(upRef).normalize();
      const perp2 = vDir.cross(perp1).normalize();

      // Dipole lateral force scaling with dynamic pressure and seam roughness
      const knuckleMag =
        0.5 *
        SIM_CONFIG.BALL.AIR_DENSITY *
        (0.20 * this.model.seamRoughness) *
        this.area *
        speedRel *
        speedRel;

      const w1 = Math.sin(this.knucklePhase);
      const w2 = Math.cos(this.knucklePhase * 1.37 + 1.15);

      const knuckleForce = perp1.scale(w1 * knuckleMag).add(perp2.scale(w2 * knuckleMag * 0.75));
      knuckleAcc = knuckleForce.scale(1 / this.mass);
    } else {
      this.isKnuckling = false;
    }

    // 4. Non-Linear Magnus Lift & Lateral Curl: F_magnus ∝ (ω × v_rel)
    let magnusAcc = Vector3.zero();

    if (spinMag > 0.1 && speedRel > 0.5) {
      // Dimensionless spin parameter Sp = (r * ω) / v_rel
      const spinParam = (this.radius * spinMag) / speedRel;
      // Non-linear sports engineering lift curve: saturates at high spin ratio, produces late-curl
      const cL =
        (spinParam / (0.35 + 1.25 * spinParam)) *
        SIM_CONFIG.BALL.LIFT_COEFFICIENT_MAX *
        this.model.magnusGain;

      const cross = this.spin.cross(vRel);
      const crossLen = cross.length();

      if (crossLen > 1e-4) {
        const magnusMag =
          0.5 * SIM_CONFIG.BALL.AIR_DENSITY * cL * this.area * speedRel * speedRel;
        magnusAcc = cross.normalize().scale(magnusMag / this.mass);
      }
    }

    // Net acceleration in flight
    const totalAcc = gravAcc.add(dragAcc).add(knuckleAcc).add(magnusAcc);

    // Semi-implicit Euler integration
    this.velocity = this.velocity.add(totalAcc.scale(dt));
    this.position = this.position.add(this.velocity.scale(dt));

    // 5. Aerodynamic Spin Decay in Flight (boundary layer skin friction)
    if (spinMag > 0.01 && speedRel > 0.1) {
      const spinDecayRate = SIM_CONFIG.BALL.SPIN_DRAG_FACTOR * speedRel;
      const spinDecayFactor = Math.max(0, 1 - spinDecayRate * dt);
      this.spin = this.spin.scale(spinDecayFactor);
    }

    const groundZ =
      this.radius +
      (pitchSurface
        ? pitchSurface.getTopographyHeight(this.position.x, this.position.y)
        : 0);

    // Check turf collision
    if (this.position.z <= groundZ) {
      this.handleTurfImpact(pitchSurface);
    } else {
      this.flightState = 'flight';
    }
  }

  /**
   * Turf impact resolution (restitution bounce & tangential spin-momentum transfer).
   */
  private handleTurfImpact(pitchSurface?: PitchSurface): void {
    const groundZ =
      this.radius +
      (pitchSurface
        ? pitchSurface.getTopographyHeight(this.position.x, this.position.y)
        : 0);
    this.position = new Vector3(this.position.x, this.position.y, groundZ);

    const turfProps = TURF_PRESETS[this.turfCondition];
    let moistureRestitutionMult = 1.0;
    let soilRestitutionMult = 1.0;
    if (pitchSurface) {
      const moisture = pitchSurface.getMoistureAt(this.position.x, this.position.y);
      if (moisture > 0.65) {
        // Splashing into standing water puddle absorbs impact energy (water displacement damping)
        moistureRestitutionMult = Math.max(0.40, 1.0 - 0.35 * (moisture - 0.65));
      }
      soilRestitutionMult = pitchSurface.getSoilRestitutionMultiplier(this.position.x, this.position.y);
    }

    const effectiveRestitution = Math.min(
      0.95,
      this.model.restitution * turfProps.restitutionMult * moistureRestitutionMult * soilRestitutionMult
    );

    if (this.velocity.z < 0) {
      // Inelastic vertical rebound
      const reboundVz = -this.velocity.z * effectiveRestitution;

      if (reboundVz < SIM_CONFIG.BALL.STOP_BOUNCE_THRESHOLD) {
        // Settle onto turf
        this.velocity = new Vector3(this.velocity.x, this.velocity.y, 0);
        this.flightState =
          this.velocity.length() > SIM_CONFIG.BALL.STOP_VELOCITY_THRESHOLD
            ? 'rolling'
            : 'at_rest';
      } else {
        this.velocity = new Vector3(this.velocity.x, this.velocity.y, reboundVz);
        this.flightState = 'bounce';
      }

      // Tangential velocity of bottom contact point: v_contact = v_xy + (ω × r_contact)
      // r_contact = (0, 0, -r). ω × (0, 0, -r) = (-ω_y * r, ω_x * r, 0)
      const slipVx = this.velocity.x - this.spin.y * this.radius;
      const slipVy = this.velocity.y + this.spin.x * this.radius;
      const slipSpeed = Math.sqrt(slipVx * slipVx + slipVy * slipVy);

      if (slipSpeed > 0.05) {
        // Friction impulse on bounce transfers spin into linear velocity or vice versa
        // Normal impulse Jn = m * (1 + e) * |vz_incoming|
        const normImpulse = this.mass * (1 + effectiveRestitution) * Math.abs(this.velocity.z);
        const maxFrictionImpulse = turfProps.skidFriction * normImpulse;
        const slipImpulse = Math.min(
          maxFrictionImpulse,
          (this.mass * slipSpeed) / (1 + (this.mass * this.radius * this.radius) / this.inertia)
        );

        const slipDirX = slipVx / slipSpeed;
        const slipDirY = slipVy / slipSpeed;

        // Decelerate linear slip
        const newVx = this.velocity.x - (slipImpulse / this.mass) * slipDirX;
        const newVy = this.velocity.y - (slipImpulse / this.mass) * slipDirY;
        this.velocity = new Vector3(newVx, newVy, this.velocity.z);

        // Impart torque on spin: τ = r_contact × (-F_friction)
        // (0, 0, -r) × (-slipDirX, -slipDirY, 0) = (-r * slipDirY, r * slipDirX, 0)
        const torqueImpulseX = -this.radius * slipDirY * slipImpulse;
        const torqueImpulseY = this.radius * slipDirX * slipImpulse;
        this.spin = new Vector3(
          this.spin.x + torqueImpulseX / this.inertia,
          this.spin.y + torqueImpulseY / this.inertia,
          this.spin.z * 0.75 // Sidespin heavily damped on turf impact
        );
      }
    }
  }

  /**
   * Ground rolling and turf friction integration (Sliding skid vs. Pure rolling).
   */
  private stepOnTurf(dt: number, simTime: number, pitchSurface?: PitchSurface): void {
    const groundZ =
      this.radius +
      (pitchSurface
        ? pitchSurface.getTopographyHeight(this.position.x, this.position.y)
        : 0);
    this.position = new Vector3(this.position.x, this.position.y, groundZ);
    this.velocity = new Vector3(this.velocity.x, this.velocity.y, 0);

    const turfProps = TURF_PRESETS[this.turfCondition];
    const speed = this.velocity.length();

    // Check if stopped
    if (speed < SIM_CONFIG.BALL.STOP_VELOCITY_THRESHOLD) {
      this.velocity = Vector3.zero();
      this.spin = Vector3.zero();
      this.flightState = 'at_rest';
      this.dragRegime = 'subcritical';
      this.isKnuckling = false;
      return;
    }

    // Check for divot or rut perturbation when rolling across scarred turf
    if (pitchSurface && speed > 0.4) {
      const divotHit = pitchSurface.checkBallDivotCollision(this.position, this.radius, simTime);
      const rutHit = !divotHit ? pitchSurface.checkBallRutCollision(this.position, this.radius, simTime) : null;
      const surfaceObstacle = divotHit || rutHit;

      if (surfaceObstacle) {
        // Impart vertical micro-bob: ball pops out of turf into a low bounce
        const heading = Math.atan2(this.velocity.y, this.velocity.x) + surfaceObstacle.lateralJitter;
        const perturbedSpeed = Math.max(0, speed * (1.0 - 0.08 * surfaceObstacle.resistanceMult));
        this.velocity = new Vector3(
          perturbedSpeed * Math.cos(heading),
          perturbedSpeed * Math.sin(heading),
          surfaceObstacle.verticalKick
        );
        this.position = new Vector3(this.position.x, this.position.y, this.radius + 0.015);
        this.flightState = 'bounce';
        this.lastContactTime = simTime;
        return;
      }
    }

    // Check ground topography undulations (micro-bumps, hollows, slope hops)
    if (pitchSurface && speed > 0.5) {
      const topo = pitchSurface.getTopographyAt(this.position.x, this.position.y);
      const slopeVel = -(
        this.velocity.x * (topo.normal.x / topo.normal.z) +
        this.velocity.y * (topo.normal.y / topo.normal.z)
      );

      // Upward slope bump pop: if slope velocity is positive and exceeds threshold, ball lifts into a micro-bob
      // Trigger threshold: 0.12 m/s on bumpy pitches (Tier 4 easily reaches 0.25 - 0.45 m/s)
      if (slopeVel > 0.12 && simTime - this.lastContactTime > 0.20) {
        this.velocity = new Vector3(
          this.velocity.x * 0.96,
          this.velocity.y * 0.96,
          Math.min(0.55, slopeVel * 0.90)
        );
        this.position = new Vector3(
          this.position.x,
          this.position.y,
          this.radius + topo.height + 0.012
        );
        this.flightState = 'bounce';
        this.lastContactTime = simTime;
        return;
      }

      // Lateral slope deflection: gravity normal component accelerates ball down slope
      const gravSlopeAccX = topo.normal.x * SIM_CONFIG.BALL.GRAVITY;
      const gravSlopeAccY = topo.normal.y * SIM_CONFIG.BALL.GRAVITY;
      this.velocity = new Vector3(
        this.velocity.x + gravSlopeAccX * dt,
        this.velocity.y + gravSlopeAccY * dt,
        0
      );
    }

    // Relative slip speed between ball bottom surface and grass
    const slipVx = this.velocity.x - this.spin.y * this.radius;
    const slipVy = this.velocity.y + this.spin.x * this.radius;
    const slipSpeed = Math.sqrt(slipVx * slipVx + slipVy * slipVy);

    if (slipSpeed > 0.08) {
      // Skid / Sliding Phase: Kinetic friction slows ball and generates rolling spin
      const frictionForce =
        turfProps.skidFriction * this.mass * SIM_CONFIG.BALL.GRAVITY;
      const slipDirX = slipVx / slipSpeed;
      const slipDirY = slipVy / slipSpeed;

      const accX = -(frictionForce / this.mass) * slipDirX;
      const accY = -(frictionForce / this.mass) * slipDirY;

      this.velocity = new Vector3(
        this.velocity.x + accX * dt,
        this.velocity.y + accY * dt,
        0
      );

      // Torque from sliding friction spins ball toward pure roll
      const torqueX = -this.radius * slipDirY * frictionForce;
      const torqueY = this.radius * slipDirX * frictionForce;

      this.spin = new Vector3(
        this.spin.x + (torqueX / this.inertia) * dt,
        this.spin.y + (torqueY / this.inertia) * dt,
        this.spin.z * Math.max(0, 1 - 6.0 * dt)
      );

      this.flightState = 'rolling';
    } else {
      // Pure Rolling Phase: Coulomb rolling resistance scaled by grass height, moisture, and soil compaction (CIV)
      const grassFrictionMult = pitchSurface ? pitchSurface.getRollingFrictionMultiplier() : 1.0;
      const soilFrictionMult = pitchSurface ? pitchSurface.getSoilRollingFrictionMultiplier(this.position.x, this.position.y) : 1.0;
      let rollDecel = turfProps.rollingFriction * grassFrictionMult * soilFrictionMult * SIM_CONFIG.BALL.GRAVITY;

      // Surface moisture & standing water puddle dynamics
      if (pitchSurface) {
        const moisture = pitchSurface.getMoistureAt(this.position.x, this.position.y);
        if (moisture < 0.65) {
          // Moderate dampness lubricates grass blades slightly (up to -18% rolling friction)
          rollDecel *= Math.max(0.70, 1.0 - 0.22 * moisture);
        } else {
          // Saturated standing water puddle (m >= 0.65):
          // Hydrodynamic drag rapidly bleeds velocity at low/medium speeds
          const puddleExcess = moisture - 0.65; // 0.0 to 0.35
          if (speed < 14.0) {
            // Drag force from fluid displacement: ball bogs down abruptly in puddle
            const waterDragDecel = (1.2 + 8.0 * puddleExcess) * SIM_CONFIG.BALL.GRAVITY;
            rollDecel += waterDragDecel;
          } else {
            // High-speed hydroplaning skim (v >= 14 m/s): partial surface skimming
            const hydroplaneSkimDecel = (0.4 + 2.2 * puddleExcess) * SIM_CONFIG.BALL.GRAVITY;
            rollDecel += hydroplaneSkimDecel;
          }
        }
      }

      const currentSpeed = this.velocity.length();
      const newSpeed = Math.max(0, currentSpeed - rollDecel * dt);

      if (newSpeed === 0) {
        this.velocity = Vector3.zero();
        this.spin = Vector3.zero();
        this.flightState = 'at_rest';
        this.dragRegime = 'subcritical';
        this.isKnuckling = false;
        return;
      }

      const dir = this.velocity.normalize();
      this.velocity = dir.scale(newSpeed);

      // Lock angular velocity to pure roll condition: v = ω × r
      this.spin = new Vector3(
        -this.velocity.y / this.radius,
        this.velocity.x / this.radius,
        this.spin.z * Math.max(0, 1 - 8.0 * dt)
      );

      this.flightState = 'rolling';
    }

    this.position = this.position.add(this.velocity.scale(dt));
    this.lastContactTime = simTime;
  }
}
