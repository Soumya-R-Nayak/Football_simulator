import { Vector2 } from '../math/Vector2.js';
import { PlayerAttributes } from './PlayerAttributes.js';

/**
 * Biomechanical Player Locomotion model incorporating inertia, realistic acceleration,
 * human foot-plant cutting/reversals (no airplane circles), and fatigue-scaled gaits.
 */
export class Locomotion {
  constructor(options = {}) {
    // Physical Attributes Profile (FM24 1-20 ratings + Height/Weight modulation)
    this.attributes = options.attributes instanceof PlayerAttributes
      ? options.attributes
      : (options.attributes ? new PlayerAttributes(options.attributes) : new PlayerAttributes(options));

    // Physical mass & anatomical reach dimensions
    this.mass = options.mass !== undefined ? options.mass : this.attributes.weight;
    this.radius = 0.35; // meters (0.70m shoulder diameter)
    this.controlRadius = 0.95; // meters (base forward reach envelope)
    this.footReachForward = options.footReachForward !== undefined ? options.footReachForward : this.attributes.footReachForward;
    this.footReachLateral = options.footReachLateral !== undefined ? options.footReachLateral : this.attributes.footReachLateral;
    this.footReachRear = 0.15; // meters (behind pelvis / at heels)

    // Base Gaits (m/s)
    this.walkSpeed = 1.8;   // 6.5 km/h (casual walk)
    this.jockeySpeed = 3.0; // 10.8 km/h (agile close control)
    const hasExplicitAttrs = options.attributes !== undefined || options.archetype !== undefined || options.agility !== undefined || options.pace !== undefined;

    this.baseSprintSpeed = options.topSpeed !== undefined ? options.topSpeed : (hasExplicitAttrs ? this.attributes.effectiveSprintSpeed : 8.8);
    this.baseRunSpeed = options.runSpeed !== undefined ? options.runSpeed : (this.baseSprintSpeed * 0.58);

    // Acceleration & Braking limits (m/s²)
    this.baseMaxAccel = options.maxAccel !== undefined ? options.maxAccel : (hasExplicitAttrs ? this.attributes.maxAcceleration : 4.8);
    this.maxBrake = options.maxBrake !== undefined ? options.maxBrake : 7.2; // m/s² (hard cleat brake)
    this.maxLatAccel = options.maxLatAccel !== undefined ? options.maxLatAccel : (hasExplicitAttrs ? this.attributes.maxLatAcceleration : 7.2);
    this.pivotAngularVelocity = hasExplicitAttrs ? this.attributes.pivotAngularVelocity : 22.0;

    // Dynamic current limits
    this.currentMaxAccel = this.baseMaxAccel;

    // Stamina (0 to 100%)
    this.stamina = 100.0;
    this.isExhausted = false;
  }

  syncAttributes(attributes = this.attributes) {
    this.attributes = attributes instanceof PlayerAttributes ? attributes : new PlayerAttributes(attributes);
    this.mass = this.attributes.weight;
    this.footReachForward = this.attributes.footReachForward;
    this.footReachLateral = this.attributes.footReachLateral;
    this.baseSprintSpeed = this.attributes.effectiveSprintSpeed;
    this.baseRunSpeed = this.attributes.effectiveRunSpeed;
    this.baseMaxAccel = this.attributes.maxAcceleration;
    this.currentMaxAccel = this.baseMaxAccel;
    this.maxLatAccel = this.attributes.maxLatAcceleration;
    this.pivotAngularVelocity = this.attributes.pivotAngularVelocity;
  }

  get sprintSpeed() {
    return this.getEffectiveSprintSpeed();
  }

  get runSpeed() {
    return this.getEffectiveRunSpeed();
  }

  getEffectiveRunSpeed() {
    // Stamina directly scales cruising jog speed: from 5.2 m/s down to 3.6 m/s
    const fatigueFactor = 0.68 + 0.32 * (this.stamina / 100.0);
    return this.baseRunSpeed * fatigueFactor;
  }

  getEffectiveSprintSpeed() {
    if (this.stamina < 8.0) return this.getEffectiveRunSpeed();
    const sprintFactor = 0.75 + 0.25 * (this.stamina / 100.0);
    return this.baseSprintSpeed * sprintFactor;
  }

  getTargetSpeed(gaitInput) {
    let target = this.getEffectiveRunSpeed();

    if (gaitInput === 'SPRINT') {
      target = this.getEffectiveSprintSpeed();
    } else if (gaitInput === 'RUN') {
      target = this.getEffectiveRunSpeed();
    } else if (gaitInput === 'JOCKEY') {
      target = this.jockeySpeed;
    } else if (gaitInput === 'WALK') {
      target = this.walkSpeed;
    } else if (gaitInput === 'TRAP_HOLD' || gaitInput === 'CLOSE_CONTROL') {
      target = 1.6; // Controlled rhythmic hopping shuffle pace (up to 1.6 m/s)
    }

    return target;
  }

  calculateTurningRadius(speed) {
    if (speed < 0.5) return 0.2;
    return (speed * speed) / this.maxLatAccel;
  }

  updateVelocity(currentVel, desiredDir, desiredSpeed, dt) {
    const currentSpeed = currentVel.magnitude();

    // 1. If no desired direction -> apply braking to standstill
    if (!desiredDir || desiredDir.magnitudeSq() < 1e-4) {
      if (currentSpeed > 0.01) {
        const brakeAmount = this.maxBrake * dt;
        const newSpeed = Math.max(0, currentSpeed - brakeAmount);
        return currentVel.clone().normalize().multiply(newSpeed);
      }
      return new Vector2(0, 0);
    }

    // Dynamic acceleration scaling based on stamina
    this.currentMaxAccel = this.baseMaxAccel * (0.65 + 0.35 * (this.stamina / 100.0));

    const targetHeading = desiredDir.heading();

    // 2. Low-speed threshold: prevent division-by-zero or angular singularities near rest
    if (currentSpeed < 0.05) {
      const newSpeed = Math.min(desiredSpeed, currentSpeed + this.currentMaxAccel * dt);
      return Vector2.fromAngle(targetHeading, newSpeed);
    }

    const currentHeading = currentVel.heading();
    let angleDiff = targetHeading - currentHeading;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    const absAngle = Math.abs(angleDiff);

    // 3. Lateral Acceleration & Steering Constraint: a_perp = v * |omega| <= maxLatAccel
    // The rate of change of the velocity vector is strictly bounded by available traction:
    // |omega| <= maxLatAccel / v
    const maxTurnRate = (this.maxLatAccel / currentSpeed) * dt;
    const turnStep = Math.sign(angleDiff) * Math.min(absAngle, maxTurnRate);
    const newHeading = currentHeading + turnStep;

    // 4. Longitudinal Momentum Management (Brake before / while redirecting):
    // Smooth, continuous steering-dependent speed target:
    // targetSpeed = desiredSpeed * ((1 + cos(absAngle)) / 2)^2
    // - Straight line (theta = 0): factor = 1.0, flat zero derivative preserves sprint speed.
    // - Cornering / cuts (theta > 0): smoothly reduces target speed to tighten turn radius and manage momentum.
    // - Reversals (theta -> 180°): targetSpeed -> 0, causing the player to heavily brake forward momentum into a curved U-turn apex before accelerating in the reverse direction.
    const cosAngle = Math.cos(absAngle);
    const targetSpeed = desiredSpeed * Math.pow(0.5 * (1.0 + cosAngle), 2);

    let newSpeed = currentSpeed;
    if (targetSpeed > currentSpeed) {
      newSpeed = Math.min(targetSpeed, currentSpeed + this.currentMaxAccel * dt);
    } else if (targetSpeed < currentSpeed) {
      newSpeed = Math.max(targetSpeed, currentSpeed - this.maxBrake * dt);
    }

    return Vector2.fromAngle(newHeading, newSpeed);
  }

  updateStamina(speed, dt) {
    if (speed > this.baseRunSpeed + 0.4) {
      // High-speed sprint: drains burst energy rapidly (~8s to ~15s continuous sprint)
      const drain = this.attributes ? this.attributes.staminaDrainRate : 9.5;
      this.stamina = Math.max(0, this.stamina - dt * drain);
    } else if (speed > this.jockeySpeed + 0.3) {
      // Cruising run: very slow aerobic drain
      this.stamina = Math.max(0, this.stamina - dt * 0.8);
    } else if (speed < this.jockeySpeed) {
      // Walking / Jockeying / Standing: catches breath and recovers stamina
      const recoveryRate = this.attributes 
        ? this.attributes.staminaRecoveryRate 
        : ((this.stamina < 30.0) ? 4.5 : 7.0);
      this.stamina = Math.min(100.0, this.stamina + dt * recoveryRate);
    }

    this.isExhausted = (this.stamina <= 5.0);
  }
}
