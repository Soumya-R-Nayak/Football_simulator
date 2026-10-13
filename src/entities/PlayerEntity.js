import { Vector2 } from '../math/Vector2.js';
import { Locomotion } from '../physics/Locomotion.js';
import { DribbleController } from '../physics/DribbleController.js';
import { PlayerAttributes } from '../physics/PlayerAttributes.js';

/**
 * Player Entity with physical locomotion, articulated stride/foot biomechanics,
 * discrete micro-touch dribbling, and FM24 Physical Attributes.
 */
export class PlayerEntity {
  constructor(options = {}) {
    this.name = options.name || 'Striker';
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

    this.dribble = new DribbleController(this);
    this.lastDribbleFoot = 'RIGHT';
    this.kickCooldown = 0.0;
    this.knockOnSurgeTimer = 0.0; // Auto-sprint burst after knocking ball into space

    // Biomechanical Gait & Stride Animation State
    this.gaitPhase = 0.0; // 0 to 2*PI stride cycle
    this.stepFrequency = 3.8; // Hz
    this.bodyLean = 0.0; // Bank angle in turns (radians)
    this.torsoPitch = 0.0; // Forward sprint lean (radians)

    // Telemetry properties
    this.currentAcceleration = 0.0;
    this.turningRadius = 0.0;

    // Trap & Hold State Machine
    this.isHoldingTrap = false;
    this.isBrakingToTrap = false;
    this.trapHoldDuration = 0.0;
    this.trapPocketDist = 0.65;      // 0.65m in front of player center (clearly ahead of torso)
    this.trapLateralOffset = 0.0;    // -0.52m (left) to +0.52m (right)
    this.trapTargetLateral = 0.0;

    // PES 2017 Rhythmic Hop & Real Touch Manipulation
    this.hopPhase = 0.0;           // 0 to 2*PI hop cycle
    this.hopFrequency = 3.8;       // Hz (3.6 - 4.0 Hz moving, 2.4 Hz idle)
    this.hopBounceZ = 0.0;         // Vertical CoM elevation (0 to 0.042m)
    this.lateralTorsoSway = 0.0;   // Lateral torso sway offset (m)
    this.torsoBankAngle = 0.0;     // Lateral bank angle into hop (rad)
    this.isHopping = false;        // Active hop footwork state
    this.soleActiveFoot = 'RIGHT'; // 'RIGHT' or 'LEFT' manipulating boot
    this.faceLockHeading = 0.0;    // Strafe heading lock (squared-up facing)
    this.isFaceLocked = false;

    this.kitColor = options.kitColor || '#3b82f6';
    this.secondaryKitColor = options.secondaryKitColor || '#1d4ed8';
    this.role = options.role || 'ATTACKER';
    this.isControlled = options.isControlled !== undefined ? options.isControlled : true;
    this.anchorPos = new Vector2(options.x || 50.0, options.y || 34.0);
    this.targetedTeammate = null;

    // PES Contextual First Touch, Stance Quality & Super Cancel State
    this.dummyCooldown = 0.0;
    this.firstTimeBuffer = null;
    this.lastStanceQuality = { powerFactor: 1.0, angleNoise: 0.0, isOffBalance: false };
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

  updateTeammateAI(dt, ball, pitch, environment = null) {
    if (this.kickCooldown > 0) this.kickCooldown -= dt;
    if (this.knockOnSurgeTimer > 0) this.knockOnSurgeTimer -= dt;
    if (this.actionNotification) {
      this.actionNotification.timer -= dt;
      if (this.actionNotification.timer <= 0) this.actionNotification = null;
    }

    // Residual velocity friction damping (stands at designated anchor)
    this.vel.multiply(Math.max(0, 1.0 - dt * 8.0));
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos = pitch.clampToPitch(this.pos, this.locomotion.radius + 0.1);

    // Idle breathing & subtle cadence
    this.gaitPhase += dt * 1.5;

    // Check incoming pass trajectory
    const toPlayer = Vector2.subtract(this.pos, ball.pos);
    const dist = toPlayer.magnitude();
    const ballSpeed = ball.vel.magnitude();
    const closingSpeed = dist > 0.05 ? ball.vel.dot(toPlayer.clone().normalize()) : 0;

    let receivedPass = false;

    if (dist < 5.2 && ballSpeed > 0.8 && closingSpeed > 0.4 && ball.z < 1.2) {
      // Rotate body to face incoming ball
      const desiredAngle = Math.atan2(-toPlayer.y, -toPlayer.x);
      this.heading = desiredAngle;

      // Trapping / reception zone
      if (this.isBallTrappable(ball, 0.48)) {
        this.dribble.executeTrapTouch(ball, Vector2.fromAngle(this.heading));
        receivedPass = true;
      }
    } else {
      // Idle state: attentively track ball carrier downfield
      const toBall = Vector2.subtract(ball.pos, this.pos);
      if (toBall.magnitudeSq() > 0.1) {
        this.heading = toBall.heading();
      }
    }

    return { receivedPass };
  }

  notifyAction(text, color = '#38bdf8', duration = 0.85) {
    this.actionNotification = { text, color, timer: duration, maxTimer: duration };
  }

  update(dt, ball, pitch, environment, desiredDir, gait) {
    if (this.kickCooldown > 0) {
      this.kickCooldown -= dt;
    }
    if (this.knockOnSurgeTimer > 0) {
      this.knockOnSurgeTimer -= dt;
    }
    if (this.dummyCooldown > 0) {
      this.dummyCooldown -= dt;
    }
    if (this.actionNotification) {
      this.actionNotification.timer -= dt;
      if (this.actionNotification.timer <= 0) {
        this.actionNotification = null;
      }
    }

    // Process buffered one-touch / first-time strike (PES instant first-time kick)
    if (this.firstTimeBuffer) {
      this.firstTimeBuffer.expires -= dt;
      if (this.firstTimeBuffer.expires <= 0) {
        this.firstTimeBuffer = null;
      } else if (this.isBallKickable(ball, 0.45)) {
        const act = this.firstTimeBuffer;
        this.firstTimeBuffer = null;
        this.notifyAction(`⚡ 1-TOUCH ${act.kickType.replace(/_/g, ' ')}`, '#38bdf8', 0.85);
        this.executeKick(ball, act.kickType, act.targetDir, act.power, act.spin);
      }
    }

    const prevSpeed = this.vel.magnitude();

    // 1. Position integration
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Boundary clamping
    this.pos = pitch.clampToPitch(this.pos, this.locomotion.radius + 0.1);

    const newSpeed = this.vel.magnitude();
    this.currentAcceleration = (newSpeed - prevSpeed) / dt;
    this.turningRadius = this.locomotion.calculateTurningRadius(newSpeed);

    const distToBall = this.pos.dist(ball.pos);
    const isCloseControl = (this.isHoldingTrap && !this.isBrakingToTrap) || (gait === 'JOCKEY' && this.isBallInTouchEnvelope(ball, 0.15));
    const isMoving = desiredDir && desiredDir.magnitudeSq() > 0.05;

    // 2. PES 2017 Rhythmic Hop Oscillator & Squaring Up
    if (isCloseControl) {
      this.isHopping = true;
      this.isFaceLocked = true;

      // Hop Cadence: 3.8 Hz when moving/hopping laterally, 2.4 Hz idle
      this.hopFrequency = isMoving ? 3.8 : 2.4;
      this.hopPhase = (this.hopPhase + this.hopFrequency * Math.PI * 2 * dt) % (Math.PI * 2);

      // Vertical Center of Mass bounce (0 to 0.042m peak elevation)
      this.hopBounceZ = Math.max(0, Math.sin(this.hopPhase)) * 0.042;

      const facing = Vector2.fromAngle(this.faceLockHeading || this.heading);
      const lateral = new Vector2(-facing.y, facing.x);
      const latDot = isMoving ? desiredDir.dot(lateral) : 0.0;

      this.lateralTorsoSway = Math.sin(this.hopPhase) * 0.035;
      this.torsoBankAngle = latDot * 0.22; // ~12.5° banking tilt into hop

      // Active manipulating boot vs stance support boot
      if (this.trapTargetLateral < -0.15) {
        this.soleActiveFoot = 'LEFT';
      } else if (this.trapTargetLateral > 0.15) {
        this.soleActiveFoot = 'RIGHT';
      } else {
        this.soleActiveFoot = Math.sin(this.hopPhase) >= 0 ? 'RIGHT' : 'LEFT';
      }

      // Torso remains squared up to faceLockHeading (maintaining facing downfield / opponent)
      if (desiredDir && desiredDir.magnitudeSq() > 0.1) {
        const fwdDot = desiredDir.dot(facing);
        if (fwdDot > 0.65) {
          const targetAngle = desiredDir.heading();
          let diff = targetAngle - this.faceLockHeading;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.faceLockHeading += diff * Math.min(1.0, dt * 6.0);
        }
      }
      this.heading = this.faceLockHeading;
      this.bodyLean = this.torsoBankAngle;
      this.torsoPitch = 0.06;
    } else {
      this.isHopping = false;
      this.isFaceLocked = false;
      this.hopBounceZ *= Math.max(0, 1.0 - dt * 16.0);
      this.lateralTorsoSway *= Math.max(0, 1.0 - dt * 16.0);
      this.torsoBankAngle *= Math.max(0, 1.0 - dt * 16.0);

      // Normal Running Heading & Body Orientation
      if (newSpeed > 0.1) {
        const targetAngle = this.vel.heading();
        let diff = targetAngle - this.heading;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.heading += diff * Math.min(1.0, dt * 14.0);
        this.faceLockHeading = this.heading;

        // Centripetal bank lean into turns: lean = (v² / R) / g
        const latAccel = (newSpeed * newSpeed) / Math.max(0.5, this.turningRadius);
        const turnSign = Math.sign(diff);
        this.bodyLean = Math.min(0.35, (latAccel / 9.81) * 0.45) * turnSign;

        // Forward torso sprint lean
        this.torsoPitch = (newSpeed / this.locomotion.sprintSpeed) * 0.22;

        // Update stride phase based on distance traveled
        this.stepFrequency = 2.8 + (newSpeed / this.locomotion.sprintSpeed) * 1.6;
        this.gaitPhase = (this.gaitPhase + this.stepFrequency * Math.PI * 2 * dt) % (Math.PI * 2);
      } else {
        this.bodyLean *= 0.85;
        this.torsoPitch *= 0.85;
      }
    }

    // 3. Stamina drain / recovery
    this.locomotion.updateStamina(newSpeed, dt);

    // 4. Trap & Hold Position Integration (Forward Pocket + Lateral Sole Roll)
    if (this.isHoldingTrap) {
      this.trapHoldDuration += dt;

      // Dispossession check: if ball was knocked away > 1.45m, break hold
      if (this.pos.dist(ball.pos) > 1.45) {
        this.releaseTrap(ball, 'DISPOSSESSED');
      } else {
        // Physical Braking Skid check:
        if (this.isBrakingToTrap) {
          if (this.vel.magnitude() <= 1.85) {
            this.isBrakingToTrap = false;
            this.isHopping = true;
          } else {
            // Deceleration torso lean backward against momentum
            this.torsoPitch = -0.18;
          }
        }

        // Smoothly interpolate lateral roll offset
        this.trapLateralOffset += (this.trapTargetLateral - this.trapLateralOffset) * Math.min(1.0, dt * 12.0);

        // Sinusoidal micro-hop oscillation in lateral position
        const facing = Vector2.fromAngle(this.heading);
        const lateral = new Vector2(-facing.y, facing.x);
        const isMovingLat = isMoving && Math.abs(desiredDir.dot(lateral)) > 0.25;
        const hopWave = (isMovingLat && !this.isBrakingToTrap) ? Math.sin(this.hopPhase) * 0.04 : 0.0;
        const finalLateral = this.trapLateralOffset + hopWave;

        const pocketPos = Vector2.add(
          this.pos,
          Vector2.add(
            Vector2.multiply(facing, this.trapPocketDist),
            Vector2.multiply(lateral, finalLateral)
          )
        );

        ball.pos.set(pocketPos.x, pocketPos.y);
        const rollSpeed = (this.trapTargetLateral - this.trapLateralOffset) * 4.5;
        ball.vel.set(this.vel.x + lateral.x * rollSpeed, this.vel.y + lateral.y * rollSpeed);
        ball.z = 0.0;
        ball.vz = 0.0;
        ball.backspin = 0.0;
        ball.isRolling = Math.abs(rollSpeed) > 0.08;
        ball.spinZ = -Math.sign(finalLateral || 1) * 22.0;
        ball.lastKickType = Math.abs(finalLateral) > 0.12 ? 'SOLE_ROLL' : 'TRAP_HOLD';

        // Suppress automatic stride kicks while holding
        this.dribble.touchCooldown = 0.20;
      }
    } else {
      // 5. Update Discrete Micro-Touch Dribbling with dynamic environment
      this.dribble.update(dt, ball, pitch, environment, desiredDir, gait);
    }
  }

  move(desiredDir, gait, dt, ball = null) {
    let activeGait = gait;

    if (this.isHoldingTrap) {
      // While holding trap, speed is strictly restricted to TRAP_HOLD (1.6 m/s max)
      // If user holds Sprint (Shift), break the trap with explosive PES burst!
      if (gait === 'SPRINT') {
        this.executeTrapBurst(ball, desiredDir);
        return;
      } else {
        activeGait = 'TRAP_HOLD';
      }
    } else if (this.knockOnSurgeTimer > 0) {
      activeGait = 'SPRINT';
    }

    let targetSpeed = this.locomotion.getTargetSpeed(activeGait);

    // Realistic Sprint Carrying Speed-Control Tradeoff:
    // When holding Sprint while actively carrying the ball (ball in forward reach),
    // cap sprint speed to ~7.6 m/s (14% dribble control penalty).
    // Only Knock-On bursts (knockOnSurgeTimer > 0) unleash full 8.8 m/s off-the-ball top speed!
    if (activeGait === 'SPRINT' && this.knockOnSurgeTimer <= 0 && ball && this.isBallInTouchEnvelope(ball, 0.20)) {
      targetSpeed = Math.min(targetSpeed, 7.6);
    }

    // High Control Stride Harmonization:
    // When carrying the ball, ensure high-control players never sprint/run past the ball.
    // If the ball is close to the boots, match player pace to ball forward momentum until touched ahead!
    if (ball && this.isBallInTouchEnvelope(ball, 0.15) && this.dribble.mode !== 'KNOCK_ON') {
      const { fwd } = this.getBallLocalCoords(ball);
      const skillRating = (this.dribble && this.dribble.skillRating) || 75;
      const controlQuality = Math.max(0, Math.min(1.0, (skillRating - 40) / 59.0));

      if (fwd < (0.32 + 0.10 * controlQuality) && fwd > -0.15) {
        const ballForwardVel = ball.vel.dot(Vector2.fromAngle(this.heading));
        const effectiveBallVel = Math.max(0.0, ballForwardVel);
        const maxPace = effectiveBallVel + (0.42 + 0.30 * (1.0 - controlQuality));
        targetSpeed = Math.min(targetSpeed, maxPace);
      }
    }

    this.vel = this.locomotion.updateVelocity(this.vel, desiredDir, targetSpeed, dt);

    // If holding trap, check if directional input is lateral to roll the ball to the side
    if (this.isHoldingTrap && desiredDir && desiredDir.magnitudeSq() > 0.1) {
      const facing = Vector2.fromAngle(this.heading);
      const lateral = new Vector2(-facing.y, facing.x);
      const latDot = desiredDir.dot(lateral);
      if (latDot < -0.28) {
        this.trapTargetLateral = -0.52; // Roll Left
      } else if (latDot > 0.28) {
        this.trapTargetLateral = 0.52;  // Roll Right
      } else if (desiredDir.dot(facing) > 0.55) {
        this.trapTargetLateral = 0.0;   // Re-center
      }
    }
  }

  /**
   * Project ball position into local coordinates relative to player center and heading.
   * fwd: forward along heading (positive ahead of pelvis, negative behind heels)
   * lat: lateral across body (positive to right, negative to left)
   */
  getBallLocalCoords(ball) {
    const dx = ball.pos.x - this.pos.x;
    const dy = ball.pos.y - this.pos.y;
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);
    return {
      fwd: dx * cosH + dy * sinH,
      lat: -dx * sinH + dy * cosH
    };
  }

  /**
   * Anatomical foot reach envelope:
   * Feet swing forward and laterally from the pelvis.
   * Modulated by player height (longer legs extend reach further).
   */
  isBallInTouchEnvelope(ball, padding = 0.0) {
    const { fwd, lat } = this.getBallLocalCoords(ball);
    const xc = 0.35;
    const reachFwd = this.attributes ? this.attributes.footReachForward : 1.05;
    const reachLat = this.attributes ? this.attributes.footReachLateral : 0.65;
    const aFwd = (reachFwd - xc) + padding;
    const skillBonus = (this.dribble && this.dribble.skillRating >= 85) ? 0.08 : 0.0;
    const aRear = 0.50 + skillBonus + padding * 0.60;
    const bLat = reachLat + padding;

    const xDiff = fwd - xc;
    const a = (xDiff >= 0) ? aFwd : aRear;
    return (xDiff * xDiff) / (a * a) + (lat * lat) / (bLat * bLat) <= 1.0;
  }

  /**
   * Tight boot pocket: nestled closely right in front of the boots for secure control.
   */
  isBallInBootPocket(ball) {
    const { fwd, lat } = this.getBallLocalCoords(ball);
    return fwd >= 0.10 && fwd <= 0.68 && Math.abs(lat) <= 0.42;
  }

  isBallKickable(ball, reachPadding = 0.35) {
    const cooldownCleared = (this.kickCooldown <= 0 || this.isHoldingTrap);
    return cooldownCleared && ball.z < 0.85 && this.isBallInTouchEnvelope(ball, reachPadding);
  }

  isBallTrappable(ball, reachPadding = 0.50) {
    return this.kickCooldown <= 0 && ball.z <= 1.65 && this.isBallInTouchEnvelope(ball, reachPadding);
  }

  /**
   * Check if player can reach an airborne ball with their head/body (incorporating Height + Jumping Reach leap).
   */
  canInterceptAirborneBall(ball) {
    const reach = this.attributes ? this.attributes.aerialReach : (this.height + 0.60);
    return ball.z <= reach && this.isBallInTouchEnvelope(ball, 0.40);
  }

  calculateStanceQuality(targetDir) {
    if (!targetDir || targetDir.magnitudeSq() < 1e-4) {
      return { powerFactor: 1.0, angleNoise: 0.0, isOffBalance: false };
    }
    // If in close control or trap hold, the player is already perfectly balanced
    if (this.isHoldingTrap || this.isHopping) {
      return { powerFactor: 1.0, angleNoise: 0.005, isOffBalance: false };
    }

    const currentFacing = this.heading;
    const targetAngle = targetDir.heading();
    let diff = targetAngle - currentFacing;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const absDiff = Math.abs(diff);

    // Speed factor: sprinting reduces balance
    const speedRatio = this.vel.magnitude() / this.locomotion.sprintSpeed;

    // Attribute-derived balance stability floor and angular noise
    const balanceFloor = this.attributes ? this.attributes.stanceBalanceFloor : 0.52;
    const maxNoise = this.attributes ? this.attributes.stanceAngleNoise : 0.18;

    if (absDiff < 0.60) {
      // Direct forward pass (< 35°): optimal balance
      const powerFactor = Math.max(0.88, 1.0 - speedRatio * 0.12);
      return { powerFactor, angleNoise: 0.02 * speedRatio, isOffBalance: false };
    } else if (absDiff < 1.65) {
      // Half-turn pass (35° to 95°): moderate balance penalty
      const powerFactor = Math.max(0.72, 0.85 - speedRatio * 0.18);
      const angleNoise = 0.05 + speedRatio * 0.08;
      return { powerFactor, angleNoise, isOffBalance: false };
    } else {
      // Blind / 180° turnaround pass (> 95°): off-balance penalty (modulated by Balance attribute)
      const powerFactor = Math.max(0.40, balanceFloor - speedRatio * 0.22);
      const angleNoise = (maxNoise * 0.85) + speedRatio * (maxNoise * 0.65);
      return { powerFactor, angleNoise, isOffBalance: true };
    }
  }

  executeKick(ball, kickType, targetDir, power = 1.0, spin = 0.0, customSpeed = null, customLoft = null, customBackspin = null) {
    if (!this.isBallKickable(ball, 0.45)) return false;

    // From balanced trap / close control stance: instant striking window without windup latency
    const wasTrapHold = this.isHoldingTrap;
    if (wasTrapHold) {
      this.isHoldingTrap = false;
      this.isFaceLocked = false;
      this.kickCooldown = 0.12;
    } else {
      this.kickCooldown = 0.26;
    }
    this.dribble.touchCooldown = 0.38; // Lock out immediate micro-touch after intentional kick

    const stance = this.calculateStanceQuality(targetDir);
    this.lastStanceQuality = stance;

    let speed = 10.0;
    let loft = 0.0;
    let spinZ = spin;
    let backspin = 0.0;

    if (customSpeed !== null) {
      speed = customSpeed * stance.powerFactor;
      if (customLoft !== null) loft = customLoft;
      if (customBackspin !== null) backspin = customBackspin;
    } else {
      switch (kickType) {
      case 'SHORT_PASS':
        // Variable strength short pass: 4.8 m/s (light layoff) to 13.5 m/s (crisp ground pass)
        speed = (4.8 + power * 8.7) * stance.powerFactor;
        loft = stance.isOffBalance ? 0.12 : 0.0;
        break;
      case 'DRIVEN_PASS':
        // Driven punch pass: 11.0 m/s to 18.5 m/s (crisp low drill without rivaling shots)
        speed = (11.0 + power * 7.5) * stance.powerFactor;
        loft = 0.25;
        break;
      case 'GROUND_THROUGH':
        // Through pass into open corridor: 6.5 m/s (short slip) to 17.5 m/s (deep through ball)
        speed = (6.5 + power * 11.0) * stance.powerFactor;
        loft = 0.0;
        break;
      case 'LOFTED_THROUGH':
        // Chipped through pass with variable distance & loft:
        speed = (8.0 + power * 7.5) * stance.powerFactor;
        loft = 3.6 + power * 2.6;
        backspin = -24.0 - power * 22.0;
        break;
      case 'SHOT':
        // Power-charged strike: 16.0 m/s (placed finish ~58 km/h) to 32.0 m/s (screamer ~115 km/h)
        speed = (16.0 + power * 16.0) * stance.powerFactor;
        // Vertical elevation: 1.0 m/s (low driven finish, peak ~0.15m) up to 6.2 m/s (upper-90 rocket, peak ~1.96m near crossbar 2.44m)
        loft = (1.0 + power * 5.2) * (stance.isOffBalance ? 1.25 : 1.0);
        break;
      case 'FINESSE_SHOT':
        // PES R2 Controlled / Curling Placement Shot: 14.0 m/s to 26.0 m/s
        speed = (14.0 + power * 12.0) * stance.powerFactor;
        // Dipping elevation: 1.8 m/s (curling grounder) up to 5.6 m/s (high bending dip over keeper, peak ~1.6m)
        loft = (1.8 + power * 3.8) * (stance.isOffBalance ? 1.25 : 1.0);
        spinZ = spin !== 0 ? spin : -42.0;
        break;
      case 'LOFT_CHIP':
        // Variable strength chipped scoop / lofted pass:
        // power = 0.18 -> speed ~ 8.4 m/s, loft ~ 4.5 m/s (short delicate chip over slide tackle)
        // power = 0.60 -> speed ~ 14.1 m/s, loft ~ 6.8 m/s (mid-range lofted pass / cross)
        // power = 1.00 -> speed ~ 19.5 m/s, loft ~ 9.0 m/s (long lofted ball, high arc)
        speed = (6.0 + power * 13.5) * stance.powerFactor;
        loft = 3.5 + power * 5.5; // 3.5 - 9.0 m/s vertical lift
        backspin = -28.0 - power * 20.0; // -28.0 to -48.0 rad/s
        break;
      case 'CLEARANCE':
        // Booming defensive clearance upfield into safety (40-60m distance, 10-12m peak elevation)
        speed = (14.0 + power * 12.0) * stance.powerFactor; // 14.0 - 26.0 m/s
        loft = 6.5 + power * 4.5; // 6.5 - 11.0 m/s high clearing arc
        backspin = -36.0 - power * 12.0; // -36.0 to -48.0 rad/s
        break;
      }
    }

    const angleDeviation = (Math.random() - 0.5) * 2.0 * stance.angleNoise;
    const finalDir = Vector2.fromAngle(targetDir.heading() + angleDeviation);

    ball.kick(finalDir, speed, loft, spinZ, this, kickType, backspin);
    this.dribble.triggerVfx(ball.pos);

    const powerPct = Math.round(power * 100);
    if (stance.isOffBalance) {
      this.notifyAction(`⚠️ OFF-BALANCE (${Math.round(stance.powerFactor * 100)}%)`, '#ef4444', 0.9);
    } else {
      switch (kickType) {
        case 'GROUND_THROUGH':
          this.notifyAction(`🎯 THROUGH BALL (${powerPct}%)`, '#38bdf8', 0.85);
          break;
        case 'LOFTED_THROUGH':
          this.notifyAction(`🚀 CHIPPED THROUGH (${powerPct}%)`, '#38bdf8', 0.85);
          break;
        case 'FINESSE_SHOT':
          this.notifyAction(`💫 FINESSE SHOT (${powerPct}%)`, '#ec4899', 0.9);
          break;
        case 'SHOT':
          this.notifyAction(`⚡ SHOT (${powerPct}%)`, '#ef4444', 0.8);
          break;
        case 'DRIVEN_PASS':
          this.notifyAction(`⚡ DRIVEN PASS (${powerPct}%)`, '#38bdf8', 0.75);
          break;
        case 'SHORT_PASS':
          this.notifyAction(`👟 PASS (${powerPct}%)`, '#10b981', 0.7);
          break;
        case 'LOFT_CHIP':
          if (power < 0.45) {
            this.notifyAction(`🌀 CHIP SCOOP (${powerPct}%)`, '#10b981', 0.8);
          } else {
            this.notifyAction(`🚀 LOFTED PASS (${powerPct}%)`, '#a855f7', 0.85);
          }
          break;
        case 'CLEARANCE':
          this.notifyAction(`⚡ CLEARANCE (${powerPct}%)`, '#f97316', 0.85);
          break;
      }
    }
    return true;
  }

  startTrapHold(ball) {
    if (!this.isBallTrappable(ball, 0.50)) return false;

    this.isHoldingTrap = true;
    this.trapHoldDuration = 0.0;
    this.trapLateralOffset = 0.0;
    this.trapTargetLateral = 0.0;
    this.kickCooldown = 0.0; // Ready for immediate pass or shot from balanced stance
    this.dribble.touchCooldown = 0.35;
    this.faceLockHeading = this.heading;
    this.isFaceLocked = true;

    // Physical Trapping Deceleration:
    // If moving faster than athletic trapping pace (> 1.85 m/s), engage realistic cleat-traction braking skid
    // rather than an unphysical instantaneous handbrake!
    const currentSpeed = this.vel.magnitude();
    const facing = Vector2.fromAngle(this.heading);

    // Cushion ball completely
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.backspin = 0.0;
    ball.spinZ = 0.0;

    if (currentSpeed > 1.85) {
      this.isBrakingToTrap = true;
      this.isHopping = false;
      this.notifyAction('🛑 BRAKING SKID', '#f59e0b', 0.85);
    } else {
      this.isBrakingToTrap = false;
      this.isHopping = true;
    }

    const pocketPos = Vector2.add(this.pos, Vector2.multiply(facing, this.trapPocketDist));
    ball.pos.set(pocketPos.x, pocketPos.y);
    ball.vel.set(this.vel.x, this.vel.y);

    ball.lastKickType = 'TRAP_HOLD';
    ball.lastTouch = this;
    this.dribble.triggerVfx(ball.pos);
    return true;
  }

  rollTrapLateral(direction = 1) {
    // direction: -1 (left) or 1 (right)
    if (!this.isHoldingTrap) return false;
    this.trapTargetLateral = direction * 0.52;
    this.dribble.triggerVfx(this.pos);
    return true;
  }

  executeTrapBurst(ball, desiredDir = null) {
    this.isHoldingTrap = false;
    this.isBrakingToTrap = false;
    this.trapHoldDuration = 0.0;
    this.trapLateralOffset = 0.0;
    this.trapTargetLateral = 0.0;
    this.knockOnSurgeTimer = 0.50; // Surge acceleration boost timer
    this.isFaceLocked = false;

    const burstDir = (desiredDir && desiredDir.magnitudeSq() > 0.1)
      ? desiredDir.clone().normalize()
      : Vector2.fromAngle(this.heading);

    // PES Explosive Impulse: +2.4 m/s velocity impulse pushing off coiled calves, clamped strictly to sprint top speed
    const currentSpeed = this.vel.magnitude();
    const burstSpeed = Math.min(this.locomotion.sprintSpeed, Math.max(4.2, currentSpeed + 2.4));
    this.vel = Vector2.multiply(burstDir, burstSpeed);

    if (ball) {
      const ballBurstSpeed = Math.min(this.locomotion.sprintSpeed + 1.8, this.vel.magnitude() + 1.8);
      ball.vel = Vector2.multiply(burstDir, Math.max(4.2, ballBurstSpeed));
      ball.pos = Vector2.add(this.pos, Vector2.multiply(burstDir, 0.72));
      ball.lastKickType = 'TRAP_BURST';
      ball.lastTouch = this;
      this.dribble.triggerVfx(ball.pos);
    }
    return true;
  }

  releaseTrap(ball, reason = 'RELEASE') {
    if (!this.isHoldingTrap) return;

    if (reason === 'BURST') {
      this.executeTrapBurst(ball);
      return;
    }

    this.isHoldingTrap = false;
    this.isBrakingToTrap = false;
    this.trapHoldDuration = 0.0;
    this.trapLateralOffset = 0.0;
    this.trapTargetLateral = 0.0;
    this.dribble.touchCooldown = 0.25;
    this.isFaceLocked = false;

    if (ball) {
      const facing = Vector2.fromAngle(this.heading);
      const releaseSpeed = this.vel.magnitude() + 0.4;
      ball.vel = Vector2.multiply(facing, Math.max(0.6, releaseSpeed));
      ball.lastKickType = 'TRAP_RELEASE';
      ball.lastTouch = this;
    }
  }

  executeTrap(ball, type = 'KILL', targetDir = null) {
    if (!this.isBallTrappable(ball, 0.50)) return false;

    if (type === 'KILL') {
      return this.startTrapHold(ball);
    } else if (type === 'DIRECTIONAL') {
      this.releaseTrap(ball);
      this.kickCooldown = 0.25;
      this.dribble.touchCooldown = 0.35;

      const baseDir = targetDir ? targetDir.clone().normalize() : Vector2.fromAngle(this.heading);
      
      // Technical skill dispersion error on directional traps
      const noise = this.attributes ? this.attributes.directionalTouchNoise : 0.12;
      const errorAngle = (Math.random() - 0.5) * 2.0 * noise;
      const dir = Vector2.fromAngle(baseDir.heading() + errorAngle);

      // Speed control: High Technique pushes ball cleanly into stride (3.4m/s); Low sprays it
      const techFactor = this.attributes ? (this.attributes.technique / 20.0) : 0.7;
      const touchSpeed = 3.2 + (1.0 - techFactor) * 0.8;
      ball.z = 0.0;
      ball.vz = 0.0;
      ball.backspin = 0.0;
      ball.vel = Vector2.multiply(dir, touchSpeed);

      ball.lastKickType = 'DIRECTIONAL_TRAP';
      ball.lastTouch = this;
      this.notifyAction(techFactor > 0.85 ? '✨ SILKY FIRST TOUCH' : '⚡ DIRECTIONAL TOUCH', '#38bdf8', 0.65);
      this.dribble.triggerVfx(ball.pos);
      return true;
    }
    return false;
  }

  executeMicroFlick(ball) {
    if (!this.isBallKickable(ball, 0.40)) return false;

    this.kickCooldown = 0.28;
    this.dribble.touchCooldown = 0.50; // Lock out ground touches while airborne

    const facing = Vector2.fromAngle(this.heading);
    const forwardSpeed = Math.max(2.0, this.vel.magnitude() + 1.2);

    ball.vel = Vector2.multiply(facing, forwardSpeed);
    ball.vz = 3.8; // Peak height approx (3.8²)/(2*9.81) ≈ 0.73m (clears tackles)
    ball.z = Math.max(0.06, ball.z);
    ball.lastKickType = 'MICRO_FLICK';
    ball.lastTouch = this;
    this.dribble.triggerVfx(ball.pos);
    return true;
  }

  executeSoleDragBack(ball) {
    if (!this.isBallKickable(ball, 0.35)) return false;

    this.kickCooldown = 0.26;
    this.dribble.touchCooldown = 0.36;

    const reverseDir = Vector2.fromAngle(this.heading + Math.PI);
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.vel = Vector2.multiply(reverseDir, 3.2);
    ball.lastKickType = 'SOLE_DRAG_BACK';
    ball.lastTouch = this;
    this.dribble.triggerVfx(ball.pos);
    return true;
  }

  executeSoleRoll(ball, side = 1) {
    if (!this.isBallKickable(ball, 0.35)) return false;

    this.kickCooldown = 0.26;
    this.dribble.touchCooldown = 0.36;

    const lateralDir = Vector2.fromAngle(this.heading + (side * Math.PI * 0.5));
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.vel = Vector2.multiply(lateralDir, 2.8);
    ball.lastKickType = 'SOLE_ROLL';
    ball.lastTouch = this;
    this.dribble.triggerVfx(ball.pos);
    return true;
  }

  executeKnockOnBurst(ball, desiredDir = null) {
    if (!this.isBallKickable(ball, 0.45)) return false;

    const burstDir = (desiredDir && desiredDir.magnitudeSq() > 0.1)
      ? desiredDir.clone().normalize()
      : Vector2.fromAngle(this.heading);

    this.isHoldingTrap = false;
    this.isFaceLocked = false;
    this.knockOnSurgeTimer = 1.30; // 1.3s sprint surge
    this.dribble.touchCooldown = 1.10; // Long stride free-rolling window

    // Knock ball firmly 4.8m to 6.2m into vacant open turf ahead
    const pushSpeed = Math.max(5.8, this.vel.magnitude() + 4.4);
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.vel = Vector2.multiply(burstDir, pushSpeed);
    ball.lastKickType = 'KNOCK_ON_BURST';
    ball.lastTouch = this;

    // Surge player sprint velocity forward
    this.vel = Vector2.multiply(burstDir, Math.max(5.2, this.vel.magnitude() + 1.8));

    this.notifyAction('💨 KNOCK-ON BURST', '#f59e0b', 0.9);
    this.dribble.triggerVfx(ball.pos);
    return true;
  }

  executeSuperCancel(ball = null) {
    // PES Super Cancel (R1 + R2 / Shift + Space):
    // Instantly breaks any action buffer, lock-in, or stance
    this.firstTimeBuffer = null;
    this.isHoldingTrap = false;
    this.isBrakingToTrap = false;
    this.isFaceLocked = false;
    this.knockOnSurgeTimer = 0.0;
    this.kickCooldown = 0.0;
    this.dribble.touchCooldown = 0.08;
    this.dummyCooldown = 0.0;
    this.notifyAction('⚡ SUPER CANCEL', '#f43f5e', 0.85);
    if (ball) {
      this.dribble.triggerVfx(this.pos);
    }
    return true;
  }

  executeFirstTouch(ball, receptionType = 'CUSHION', desiredDir = null) {
    if (receptionType === 'DUMMY') {
      const dist = this.pos.dist(ball.pos);
      if (dist > (this.locomotion.controlRadius + 0.55) || ball.z >= 0.85) return false;

      // PES Dummy (spreading stance to let ball run cleanly through legs without contact)
      this.dummyCooldown = 0.55;
      ball.lastKickType = 'DUMMY_RUN';
      this.notifyAction('👟 DUMMY RUN-THROUGH', '#a855f7', 1.0);
      this.dribble.triggerVfx(ball.pos);
      return true;
    }

    if (!this.isBallTrappable(ball, 0.50)) return false;

    if (receptionType === 'DIRECTIONAL') {
      const dir = (desiredDir && desiredDir.magnitudeSq() > 0.1)
        ? desiredDir.clone().normalize()
        : Vector2.fromAngle(this.heading);
      ball.z = 0.0;
      ball.vz = 0.0;
      ball.vel = Vector2.multiply(dir, 4.2);
      ball.lastKickType = 'DIRECTIONAL_TOUCH';
      ball.lastTouch = this;
      this.dribble.touchCooldown = 0.38;
      this.notifyAction('🎯 FIRST TOUCH', '#10b981', 0.8);
      this.dribble.triggerVfx(ball.pos);
      return true;
    }

    if (receptionType === 'BURST') {
      const dir = (desiredDir && desiredDir.magnitudeSq() > 0.1)
        ? desiredDir.clone().normalize()
        : Vector2.fromAngle(this.heading);
      ball.z = 0.0;
      ball.vz = 0.0;
      ball.vel = Vector2.multiply(dir, 6.2);
      ball.lastKickType = 'BURST_TOUCH';
      ball.lastTouch = this;
      this.knockOnSurgeTimer = 0.90;
      this.dribble.touchCooldown = 0.85;
      this.notifyAction('⚡ BURST TOUCH', '#f59e0b', 0.85);
      this.dribble.triggerVfx(ball.pos);
      return true;
    }

    // Default CUSHION
    const facing = Vector2.fromAngle(this.heading);
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.vel = Vector2.multiply(facing, 1.4);
    ball.lastKickType = 'CUSHION_TOUCH';
    ball.lastTouch = this;
    this.dribble.touchCooldown = 0.28;
    this.notifyAction('🟢 CUSHION TRAP', '#10b981', 0.8);
    this.dribble.triggerVfx(ball.pos);
    return true;
  }
}
