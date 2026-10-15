import { Vector2 } from '../math/Vector2.js';
import { Locomotion } from '../physics/Locomotion.js';
import { PlayerAttributes } from '../physics/PlayerAttributes.js';

/**
 * Player Entity: physical locomotion, body kinematics (orientation, bank lean, sprint pitch),
 * gait phase stride cycles, and physical attributes.
 */
export class PlayerEntity {
  constructor(options = {}) {
    this.name = options.name || 'Player';
    this.number = options.number || 10;
    this.pos = new Vector2(options.x || 50.0, options.y || 34.0);
    this.vel = new Vector2(0, 0);
    this.heading = 0.0; // radians

    const hasCustomAttrs = options.attributes !== undefined || options.archetype !== undefined;

    // FM24 Physical Attributes Profile + Height/Weight Biomechanics
    if (options.attributes instanceof PlayerAttributes) {
      this.attributes = options.attributes;
    } else if (typeof options.archetype === 'string') {
      this.attributes = PlayerAttributes.createArchetype(options.archetype);
    } else {
      this.attributes = new PlayerAttributes(options.attributes || options);
    }

    this.height = options.height || this.attributes.height;
    this.weight = options.weight || this.attributes.weight;

    this.locomotion = new Locomotion({
      attributes: this.attributes,
      mass: this.weight,
      maxBrake: options.maxBrake || 6.8,
      ...(hasCustomAttrs ? {} : {
        topSpeed: options.topSpeed !== undefined ? options.topSpeed : 8.8,
        runSpeed: options.runSpeed !== undefined ? options.runSpeed : 5.2,
        maxAccel: options.maxAccel !== undefined ? options.maxAccel : 4.8,
        maxLatAccel: options.maxLatAccel !== undefined ? options.maxLatAccel : 7.2
      })
    });

    // Biomechanical Gait & Stride Animation State
    this.gaitPhase = 0.0; // 0 to 2*PI stride cycle
    this.stepFrequency = 3.8; // Hz
    this.bodyLean = 0.0; // Bank angle in turns (radians)
    this.torsoPitch = 0.0; // Forward sprint lean (radians)

    // Telemetry properties
    this.currentAcceleration = 0.0;
    this.turningRadius = 0.0;
    this._lastSpeed = 0.0;
    this._movedThisFrame = false;

    this.kitColor = options.kitColor || '#3b82f6';
    this.secondaryKitColor = options.secondaryKitColor || '#1d4ed8';
    this.role = options.role || 'PLAYER';
    this.isControlled = options.isControlled !== undefined ? options.isControlled : true;
    this.actionNotification = null; // { text, color, timer, maxTimer }
  }

  setAttributes(attributes) {
    if (attributes instanceof PlayerAttributes) {
      this.attributes = attributes;
    } else {
      this.attributes = new PlayerAttributes(attributes);
    }
    this.height = this.attributes.height;
    this.weight = this.attributes.weight;
    this.locomotion.syncAttributes(this.attributes);
  }

  setArchetype(name) {
    const attrs = PlayerAttributes.createArchetype(name);
    this.setAttributes(attrs);
    this.notifyAction(`👤 ARCHETYPE: ${name.toUpperCase()}`, '#38bdf8', 1.0);
  }

  notifyAction(text, color = '#38bdf8', duration = 0.8) {
    this.actionNotification = { text, color, timer: duration, maxTimer: duration };
  }

  canInterceptAirborneBall(ball) {
    if (!ball) return false;
    const reach = this.attributes ? this.attributes.aerialReach : (this.height + 0.60);
    const dist = this.pos.dist(ball.pos);
    return ball.z <= reach && dist <= (this.locomotion.radius + ball.radius + 0.40);
  }

  move(desiredDir, gait, dt, ball = null) {
    const targetSpeed = this.locomotion.getTargetSpeed(gait);

    const prevSpeed = this.vel.magnitude();
    this.vel = this.locomotion.updateVelocity(this.vel, desiredDir, targetSpeed, dt);
    const newSpeed = this.vel.magnitude();
    this.currentAcceleration = (dt > 0) ? (newSpeed - prevSpeed) / dt : 0.0;
    this._movedThisFrame = true;
    this._lastSpeed = newSpeed;

    if (ball) {
      this.resolveBallContact(ball);
    }
  }

  update(dt, ball = null, pitch = null, environment = null, desiredDir = null, gait = 'RUN') {
    if (this.actionNotification) {
      this.actionNotification.timer -= dt;
      if (this.actionNotification.timer <= 0) {
        this.actionNotification = null;
      }
    }

    // 1. Position integration
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Pitch clamping
    if (pitch && pitch.clampToPitch) {
      this.pos = pitch.clampToPitch(this.pos, this.locomotion.radius + 0.1);
    }

    const newSpeed = this.vel.magnitude();
    if (!this._movedThisFrame) {
      this.currentAcceleration = (dt > 0 && typeof this._lastSpeed === 'number')
        ? (newSpeed - this._lastSpeed) / dt
        : 0.0;
    }
    this._movedThisFrame = false;
    this._lastSpeed = newSpeed;
    this.turningRadius = this.locomotion.calculateTurningRadius(newSpeed);

    // 2. Body Orientation & Kinematic Banking
    const pivotRate = this.locomotion.pivotAngularVelocity || 22.0;

    if (newSpeed > 0.1) {
      // Moving: body smoothly tracks velocity direction, with slight lookahead towards desired input direction
      const velAngle = this.vel.heading();
      let targetAngle = velAngle;
      if (desiredDir && desiredDir.magnitudeSq() > 0.1) {
        const inputAngle = desiredDir.heading();
        let diffInput = inputAngle - velAngle;
        while (diffInput < -Math.PI) diffInput += Math.PI * 2;
        while (diffInput > Math.PI) diffInput -= Math.PI * 2;
        targetAngle = velAngle + diffInput * 0.25;
      }

      let diff = targetAngle - this.heading;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      const maxTurn = Math.min(Math.abs(diff), Math.max(14.0, pivotRate) * dt);
      this.heading += Math.sign(diff) * maxTurn;

      // Centripetal bank lean into turns: lean = (v² / R) / g
      const latAccel = (newSpeed * newSpeed) / Math.max(0.5, this.turningRadius);
      const turnSign = Math.sign(diff);
      this.bodyLean = Math.min(0.35, (latAccel / 9.81) * 0.45) * turnSign;

      // Forward torso sprint lean
      this.torsoPitch = (newSpeed / this.locomotion.sprintSpeed) * 0.22;

      // Stride phase based on speed
      this.stepFrequency = 2.8 + (newSpeed / this.locomotion.sprintSpeed) * 1.6;
      this.gaitPhase = (this.gaitPhase + this.stepFrequency * Math.PI * 2 * dt) % (Math.PI * 2);
    } else {
      // Stationary: pivot smoothly towards input direction
      if (desiredDir && desiredDir.magnitudeSq() > 0.1) {
        const targetAngle = desiredDir.heading();
        let diff = targetAngle - this.heading;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const maxTurn = Math.min(Math.abs(diff), pivotRate * dt);
        this.heading += Math.sign(diff) * maxTurn;
      }
      this.bodyLean *= 0.85;
      this.torsoPitch *= 0.85;
    }

    // 3. Stamina update
    this.locomotion.updateStamina(newSpeed, dt);

    // 4. Elastic physical ball contact (simple bump if ball is touched)
    if (ball) {
      this.resolveBallContact(ball);
    }
  }

  /**
   * Simple physical circular contact between player body and ball.
   * Prevents ball from penetrating player body; imparts realistic impulse when bumped.
   */
  resolveBallContact(ball) {
    if (!ball || ball.z > 0.6) return;
    const dx = ball.pos.x - this.pos.x;
    const dy = ball.pos.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    const minDist = this.locomotion.radius + ball.radius;

    if (dist < minDist && dist > 1e-4) {
      const nx = dx / dist;
      const ny = dy / dist;
      const penetration = minDist - dist;

      // Push ball out of player volume
      ball.pos.x += nx * penetration;
      ball.pos.y += ny * penetration;

      // Impart physical elastic impulse
      const relVx = ball.vel.x - this.vel.x;
      const relVy = ball.vel.y - this.vel.y;
      const normalVel = relVx * nx + relVy * ny;

      if (normalVel < 0) {
        const restitution = 0.55;
        const impulse = -(1 + restitution) * normalVel;
        ball.vel.x += nx * impulse;
        ball.vel.y += ny * impulse;
        ball.isRolling = true;
      }
    }
  }
}
