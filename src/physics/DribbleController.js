import { Vector2 } from '../math/Vector2.js';

/**
 * Discrete Micro-Touch Dribbling Controller.
 * Eliminates glued/tethered ball physics.
 * Dribbling is simulated as periodic micro-kicks with realistic free-rolling phases,
 * touch cadences, dynamic turf resistance, and skill-dependent dispersion noise.
 */
export class DribbleController {
  constructor(player) {
    this.player = player;

    // Dribble skill rating (50 = clumsy amateur, 99 = prime Messi)
    this.skillRating = 85;

    // Active dribble mode: 'CLOSE' | 'CRUISE' | 'KNOCK_ON'
    this.mode = 'CRUISE';

    // Touch timing state
    this.touchCooldown = 0.0;
    this.timeSinceLastTouch = 1.0; // Initially not carrying ball
    this.lastTouchFoot = 'RIGHT';  // Alternating footfall cadence
    this.lastTouchPos = new Vector2(0, 0);
    this.touchVfxTimer = 0.0;

    // Telemetry & contact attributes
    this.currentCadence = 3.3; // Live touch frequency in Hz (1.0 / strideTime)
    this.lastImpulse = 0.0;    // Magnitude of last cleat contact impulse (m/s)
    this.lastTouchSurface = 'OUTSIDE'; // 'OUTSIDE' | 'INSTEP' | 'LACES' | 'SOLE'

    // Free-rolling vulnerability tracking
    this.isBallFreeRolling = true;
  }

  setSkill(rating) {
    this.skillRating = Math.max(40, Math.min(99, rating));
    if (this.player && this.player.attributes) {
      // Map 40-99 rating to FM24 1-20 scale
      const fmVal = Math.round(1 + ((this.skillRating - 40) / 59.0) * 19);
      this.player.attributes.dribbling = Math.max(1, Math.min(20, fmVal));
      this.player.attributes.technique = Math.max(1, Math.min(20, fmVal));
      this.player.attributes.firstTouch = Math.max(1, Math.min(20, fmVal));
      if (this.skillRating >= 95) {
        this.player.attributes.agility = 20;
        this.player.attributes.balance = 20;
      } else if (this.skillRating <= 55) {
        this.player.attributes.agility = Math.min(this.player.attributes.agility, fmVal);
        this.player.attributes.balance = Math.min(this.player.attributes.balance, fmVal);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
  }

  update(dt, ball, pitchOrDir, envOrGait, desiredDir, gait) {
    let pitch = null;
    let environment = null;
    let dir = null;
    let activeGait = 'RUN';

    if (pitchOrDir && (typeof pitchOrDir.magnitudeSq === 'function' || (pitchOrDir.x !== undefined && pitchOrDir.y !== undefined))) {
      // Called as: update(dt, ball, desiredDir, gait, environment)
      dir = pitchOrDir;
      activeGait = typeof envOrGait === 'string' ? envOrGait : 'RUN';
      environment = desiredDir || null;
    } else {
      // Called as: update(dt, ball, pitch, environment, desiredDir, gait)
      pitch = pitchOrDir;
      environment = envOrGait;
      dir = desiredDir;
      activeGait = gait || 'RUN';
    }

    this.timeSinceLastTouch += dt;
    if (this.touchCooldown > 0) {
      this.touchCooldown -= dt;
    }
    if (this.touchVfxTimer > 0) {
      this.touchVfxTimer -= dt;
    }

    // If player is executing a PES Dummy (letting ball roll through legs), bypass micro-touch
    if (this.player && this.player.dummyCooldown > 0) {
      this.isBallFreeRolling = true;
      return;
    }

    // Realistic anatomical foot reach envelope:
    // Touches happen in front of the player and to the sides where boots swing.
    // A ball trailing behind the player's heels cannot be touched or micro-kicked forward.
    const inTouchEnvelope = this.player.isBallInTouchEnvelope ? this.player.isBallInTouchEnvelope(ball, 0.0) : false;
    let canTouch = inTouchEnvelope && ball.z < 0.35 && this.touchCooldown <= 0;

    // High-Control Anti-Overrun Protection:
    // An elite/high-control player NEVER lets the ball slip behind their running stride.
    // If the ball is dropping within close reach of the boots (fwd in [0.05, 0.40m]),
    // high-control players take a reactive touch before the ball can drop behind the heels!
    // Dynamic Composite Control Quality from PlayerAttributes if available:
    let controlQuality = Math.max(0, Math.min(1.0, (this.skillRating - 40) / 59.0));
    if (this.player && this.player.attributes && typeof this.player.attributes.compositeDribbleQuality === 'number') {
      controlQuality = this.player.attributes.compositeDribbleQuality;
    }

    const ballLocal = (this.player && this.player.getBallLocalCoords) ? this.player.getBallLocalCoords(ball) : { fwd: 0.5, lat: 0 };
    if (!canTouch && inTouchEnvelope && ball.z < 0.35 && ballLocal.fwd > 0.05 && ballLocal.fwd <= (0.24 + 0.20 * controlQuality)) {
      if (this.touchCooldown <= (0.22 * controlQuality) || controlQuality >= 0.75) {
        canTouch = true;
      }
    }

    // Is the ball currently free-rolling in the vulnerability window?
    // Ball is only securely nestled if within the tight boot pocket and touch cooldown is clear.
    const inBootPocket = this.player.isBallInBootPocket ? this.player.isBallInBootPocket(ball) : false;
    this.isBallFreeRolling = !inBootPocket || this.touchCooldown > 0.05;

    if (canTouch) {
      let pushDir = dir ? dir.clone() : new Vector2(0, 0);
      if (pushDir.magnitudeSq() < 1e-4) {
        // Player is stationary / decelerating -> cushion and trap ball gently in front
        pushDir = Vector2.fromAngle(this.player.heading);
        this.executeTrapTouch(ball, pushDir);
      } else {
        // Player is moving -> execute controlled stride micro-touch
        pushDir.normalize();
        this.executeMicroTouch(ball, pushDir, activeGait, environment);
      }
    }
  }

  executeTrapTouch(ball, facingDir) {
    // Stationary trap / dead-stop cushioning
    const attrs = (this.player && this.player.attributes) ? this.player.attributes : null;
    let controlQuality = Math.max(0, Math.min(1.0, (this.skillRating - 40) / 59.0));
    let retention = 0.12 + (1.0 - controlQuality) * 0.44;

    if (attrs) {
      controlQuality = attrs.compositeDribbleQuality;
      retention = attrs.receptionRestitution;
    }
    const ballSpeed = ball.vel.magnitude();

    // Settle ball in front of player
    const targetOffset = Vector2.multiply(facingDir, this.player.locomotion.radius + ball.radius + 0.08);
    const targetBallPos = Vector2.add(this.player.pos, targetOffset);

    // Cushion incoming ball speed with ankle compliance:
    // Elite cushions cleanly (e ~ 0.08); Amateur has stiff-ankle bounce (e ~ 0.50)
    ball.vel.multiply(retention);

    // Stiff-ankle rebound on fast incoming ball for low First Touch players:
    if (ballSpeed > 2.5 && controlQuality < 0.60) {
      const reboundSpeed = 1.4 + (1.0 - controlQuality) * 1.5;
      const reboundVel = Vector2.multiply(facingDir, reboundSpeed);
      ball.vel.set(reboundVel.x, reboundVel.y);
      this.player.notifyAction('⚠️ HEAVY RECEPTION', '#ef4444', 0.85);
    } else {
      if (ballSpeed > 1.8 && controlQuality >= 0.80) {
        this.player.notifyAction('✨ VELVET FIRST TOUCH', '#10b981', 0.70);
      }
      // Gentle micro-nudge towards resting pocket
      const nudgeDir = Vector2.subtract(targetBallPos, ball.pos);
      const nudgeDist = nudgeDir.magnitude();
      if (nudgeDist > 0.05) {
        const nudgeSpeed = Math.min(0.85, nudgeDist * 1.5);
        const nudgeVel = nudgeDir.normalize().multiply(nudgeSpeed);
        ball.vel.set(nudgeVel.x, nudgeVel.y);
      } else {
        ball.vel.set(0, 0);
      }
    }

    ball.owner = null;
    ball.lastTouch = this.player;
    ball.spinZ = 0.0;
    ball.isRolling = ball.vel.magnitude() > 0.05;
    ball.lastKickType = 'TRAP_TOUCH';
    // Sluggish turnover for amateur players vs rapid organization for elite
    this.touchCooldown = 0.20 + (1.0 - controlQuality) * 0.15;
    this.currentCadence = 1.0 / this.touchCooldown;
    this.lastTouchSurface = 'SOLE';
    this.timeSinceLastTouch = 0.0;
    this.toggleFoot();
    this.triggerVfx(ball.pos);
  }

  executeDirectionalCut(ball, desiredDir, angleDiff, gait, environment = null) {
    const pSpeed = this.player.vel.magnitude();
    const attrs = (this.player && this.player.attributes) ? this.player.attributes : null;
    let controlQuality = Math.max(0, Math.min(1.0, (this.skillRating - 40) / 59.0));
    let skillFactor = (100 - this.skillRating) / 100.0;
    let cutRetention = 0.50 + 0.38 * controlQuality;
    let noiseFactor = skillFactor * 0.36;

    if (attrs) {
      controlQuality = attrs.compositeDribbleQuality;
      cutRetention = attrs.cutSpeedRetention;
      noiseFactor = attrs.directionalTouchNoise;
      skillFactor = 1.0 - controlQuality;
    }

    const speedRatio = Math.min(1.0, pSpeed / 7.6);
    const absTurn = Math.abs(angleDiff);

    // 1. Cleat Selection:
    // Turning Right (angleDiff > 0): Outside of Right Boot or Inside of Left Boot
    // Turning Left (angleDiff < 0): Outside of Left Boot or Inside of Right Boot
    const cutFoot = (angleDiff > 0) ? 'RIGHT' : 'LEFT';
    this.lastTouchFoot = cutFoot;
    if (this.player) {
      this.player.lastDribbleFoot = cutFoot;
    }

    // 2. Biomechanical Plant-and-Cut Deceleration Penalty:
    // Cutting sharply requires planting the support cleat and loading the knee/hip.
    // Elite players (high Agility + Technique) retain 85-90% exit speed; clunky players brake hard.
    const turnSeverity = absTurn / Math.PI; // 0.16 to 1.0
    const decelPercent = (0.05 + 0.16 * speedRatio * turnSeverity) * (1.20 - cutRetention * 0.50);
    this.player.vel.multiply(Math.max(0.48, 1.0 - decelPercent));

    // 3. Assistive Cut Redirection:
    // Touch dispersion error scales with Technique and entrance speed
    const maxCutNoise = noiseFactor * (0.60 + speedRatio * 0.55);
    const cutError = (Math.random() - 0.5) * 2.0 * maxCutNoise;
    const finalCutAngle = desiredDir.heading() + cutError;

    // Cut push speed: leads player cleanly into new running lane
    const rollDecel = environment ? environment.getRollingDeceleration() : 1.08;
    const recoveryStride = (0.24 + 0.16 * (1.0 - controlQuality)) + skillFactor * 0.10;
    const cutLeadPocket = 0.42 + 0.35 * (1.0 - controlQuality);
    const cutPushSpeed = Math.max(1.8, (this.player.vel.magnitude() * 0.95) + (cutLeadPocket / recoveryStride) + (0.5 * rollDecel * recoveryStride));

    const targetCutVel = Vector2.fromAngle(finalCutAngle, cutPushSpeed);
    const currVel = ball.vel.clone();
    const cutImpulse = Vector2.subtract(targetCutVel, currVel);
    const cutCompliance = 0.82 + 0.16 * controlQuality;
    const newCutVel = Vector2.add(currVel, Vector2.multiply(cutImpulse, cutCompliance));

    ball.vel.set(newCutVel.x, newCutVel.y);
    ball.owner = null;
    ball.lastTouch = this.player;
    ball.isRolling = true;
    ball.spinZ = (angleDiff > 0) ? -24.0 * (0.8 + 0.3 * (1.0 - controlQuality)) : 24.0 * (0.8 + 0.3 * (1.0 - controlQuality));
    ball.lastKickType = (absTurn > 2.0) ? '180_CUT' : 'DIRECTIONAL_CUT';
    this.lastImpulse = cutImpulse.magnitude();
    this.currentCadence = 1.0 / recoveryStride;
    this.lastTouchSurface = (absTurn > 1.2) ? 'INSTEP' : 'OUTSIDE';

    if (absTurn > 0.85) {
      const cutName = (absTurn > 2.0) ? '180° REVERSAL' : (this.lastTouchSurface === 'OUTSIDE' ? '⚡ OUTSIDE-BOOT CUT' : '⚡ DIRECTIONAL CUT');
      this.player.notifyAction(cutName, '#38bdf8', 0.65);
    }

    this.touchCooldown = recoveryStride;
    this.timeSinceLastTouch = 0.0;
    this.triggerVfx(ball.pos);
  }

  executeMicroTouch(ball, desiredDir, gait, environment = null) {
    const pSpeed = this.player.vel.magnitude();
    const ballSpeed = ball.vel.magnitude();
    const skill = this.skillRating;
    let skillFactor = (100 - skill) / 100.0;

    // Check turning angle relative to player's current facing heading
    const facingAngle = this.player.heading;
    const desiredAngle = desiredDir.heading();
    let angleDiff = desiredAngle - facingAngle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    const absTurn = Math.abs(angleDiff);

    // If making a sharp directional cut (>= ~30° or 0.52 rad) while moving:
    if (absTurn >= 0.52 && pSpeed > 0.5 && this.mode !== 'KNOCK_ON') {
      this.executeDirectionalCut(ball, desiredDir, angleDiff, gait, environment);
      return;
    }

    // Check if this is a first-touch collection of a slow or incoming ball
    const isFirstTouch = this.timeSinceLastTouch > 0.55 || ballSpeed < 0.8;

    // Control Quality metric: 0.0 (clunky 40) to 1.0 (Messi 99)
    const attrs = (this.player && this.player.attributes) ? this.player.attributes : null;
    let controlQuality = Math.max(0, Math.min(1.0, (this.skillRating - 40) / 59.0));
    let angleNoiseScale = skillFactor * 0.32;

    if (attrs) {
      controlQuality = attrs.compositeDribbleQuality;
      skillFactor = 1.0 - controlQuality;
      angleNoiseScale = attrs.directionalTouchNoise;
    }

    // Baseline Stride Time (Foot turnover) and Target Pocket Scaling:
    // Elite (Messi 99): tight 0.42m pocket, rapid 4.0 - 5.0 Hz foot turnover
    // Low-Skill (40-50): heavy 0.78 - 0.96m pocket (+40-70% lead), sluggish 2.2 - 2.8 Hz turnover
    let baseStrideTime = 0.35;
    let baseTargetPocket = 0.52;

    const isKnockOn = (this.mode === 'KNOCK_ON');

    if (isKnockOn) {
      baseStrideTime = 1.25;
      baseTargetPocket = 4.2 + pSpeed * 0.25;
      this.mode = 'CRUISE';
      if (this.player) {
        this.player.knockOnSurgeTimer = 1.30;
      }
    } else if (this.mode === 'CLOSE' || gait === 'JOCKEY' || gait === 'WALK') {
      baseStrideTime = (gait === 'WALK') 
        ? (0.22 + 0.14 * (1.0 - controlQuality)) 
        : (0.20 + 0.15 * (1.0 - controlQuality));
      baseTargetPocket = 0.36 + 0.26 * (1.0 - controlQuality);
    } else if (gait === 'SPRINT') {
      baseStrideTime = 0.29 + 0.16 * (1.0 - controlQuality);
      baseTargetPocket = 0.56 + 0.40 * (1.0 - controlQuality);
    } else {
      // Cruising run
      baseStrideTime = 0.25 + 0.16 * (1.0 - controlQuality);
      baseTargetPocket = 0.44 + 0.34 * (1.0 - controlQuality);
    }

    // Adaptive Stride Cadence Modulation:
    // 1. Deceleration / Traffic Chop-Steps:
    // When braking (accel < -0.8 m/s²) or navigating a curve (absTurn > 0.15 rad),
    // step cadence spikes to 5.0 - 6.0 Hz (strideTime drops by up to 26%),
    // drawing the pocket in tight for responsive control.
    // 2. Open-Turf Acceleration Elongation:
    // When accelerating linearly (accel > 1.2 m/s², absTurn < 0.20 rad),
    // stride time expands (+12%) and lead pocket opens ahead into stride.
    let strideTime = baseStrideTime;
    let targetPocket = baseTargetPocket;

    if (!isKnockOn) {
      const pAccel = (this.player && this.player.currentAcceleration) || 0.0;
      const decelDemand = Math.max(0, Math.min(1.0, -pAccel / 5.5));
      const curveDemand = Math.max(0, Math.min(1.0, absTurn / 0.50));
      const chopFactor = Math.max(decelDemand, curveDemand);

      const accelElongation = (absTurn < 0.20 && pAccel > 1.2) ? Math.min(1.0, (pAccel - 1.2) / 3.2) : 0.0;

      if (chopFactor > 0.05) {
        const chopReduction = 0.24 * chopFactor * (0.80 + 0.20 * controlQuality);
        strideTime = Math.max(0.18, baseStrideTime * (1.0 - chopReduction));
        targetPocket = Math.max(0.32, baseTargetPocket * (1.0 - 0.18 * chopFactor));
      } else if (accelElongation > 0.05) {
        const expandTime = 0.12 * accelElongation;
        strideTime = baseStrideTime * (1.0 + expandTime);
        targetPocket = baseTargetPocket + 0.12 * accelElongation;
      }

      // Random Heavy Touch Surge (Stumble):
      // Spikes on low-skill players, especially during sprints or sharp weaving
      const heavyRisk = (1.0 - controlQuality) * (gait === 'SPRINT' ? 0.24 : (absTurn > 0.25 ? 0.18 : 0.10));
      if (Math.random() < heavyRisk) {
        const surgeMultiplier = 1.45 + (1.0 - controlQuality) * 0.45; // 1.45x to 1.90x
        targetPocket *= surgeMultiplier;
        strideTime *= 1.30;
        this.player.notifyAction('⚠️ HEAVY TOUCH', '#f59e0b', 0.65);
      }
    }

    this.currentCadence = 1.0 / strideTime;

    // Closed-loop stride pocket targeting:
    // Calculates where the player will be at the next stride touch and leads the ball directly into targetPocket
    const rollDecel = environment ? environment.getRollingDeceleration() : 1.08;
    const accel = Math.max(0, (this.player && this.player.currentAcceleration) || 0.0);
    const playerTravelDist = pSpeed * strideTime + 0.5 * accel * strideTime * strideTime;

    const futurePlayerPos = Vector2.add(
      this.player.pos,
      Vector2.fromAngle(this.player.heading, playerTravelDist)
    );
    const pocketLeadVec = Vector2.multiply(desiredDir, targetPocket);
    const targetBallPos = Vector2.add(futurePlayerPos, pocketLeadVec);

    // Steer vector from current ball position to future target pocket
    let steerVec = Vector2.subtract(targetBallPos, ball.pos);
    const targetBallDist = steerVec.magnitude();

    // Required speed to land at targetBallPos compensating for turf friction
    const requiredSpeed = (targetBallDist / strideTime) + (0.5 * rollDecel * strideTime);

    // Closed-loop speed regulation:
    let baseSpeed = requiredSpeed;
    const ballLocal = (this.player && this.player.getBallLocalCoords) ? this.player.getBallLocalCoords(ball) : { fwd: 0.45, lat: 0 };

    if (isKnockOn) {
      baseSpeed = Math.max(baseSpeed, pSpeed + 4.50);
    } else if (isFirstTouch && pSpeed < 0.5) {
      // Soft first-touch gathering into stride when standing/slow: damp ball, do NOT kick it away!
      baseSpeed = Math.min(baseSpeed, Math.max(pSpeed + 0.28, ballSpeed * 0.5));
    } else if (ballLocal.fwd < 0.38 && pSpeed > 0.4) {
      // Ball is close to the boots: ensure minimum forward push speed so the player never overruns it
      const minPush = (pSpeed * 0.95) + (0.24 / strideTime) + (0.5 * rollDecel * strideTime);
      baseSpeed = Math.max(baseSpeed, minPush);
    }

    // Direction calculation:
    // Steer the ball towards the center of the pocket; high-control players funnel the ball precisely
    let finalSteerDir = desiredDir.clone();
    if (steerVec.magnitudeSq() > 1e-4) {
      steerVec.normalize();
      const steerBlend = 0.35 + 0.60 * controlQuality;
      finalSteerDir = Vector2.lerp(desiredDir, steerVec, steerBlend).normalize();
    }

    // Lateral drift dampening:
    // For high-control players, prevent cumulative lateral deviation from blowing out envelope width
    if (controlQuality > 0.7 && Math.abs(ballLocal.lat) > 0.15) {
      const headingVec = Vector2.fromAngle(this.player.heading);
      const latVec = new Vector2(-headingVec.y, headingVec.x);
      const correction = -Math.sign(ballLocal.lat) * 0.12 * controlQuality;
      finalSteerDir = Vector2.add(finalSteerDir, Vector2.multiply(latVec, correction)).normalize();
    }

    // Human skill noise (angle & force dispersion) - zero for elite control, higher for clunky
    // Elite (Messi 99): ~0.016 rad (0.9°); Amateur (40-50): 0.16 - 0.20 rad (±10° to ±16° drift)
    const maxAngleNoise = angleNoiseScale;
    const angleError = (Math.random() - 0.5) * 2.0 * maxAngleNoise;

    const maxForceNoise = skillFactor * 0.22;
    const forceError = (Math.random() - 0.5) * 2.0 * maxForceNoise;

    const finalAngle = finalSteerDir.heading() + angleError;
    const finalSpeed = Math.max(0.3, baseSpeed * (1.0 + forceError));
    const targetVel = Vector2.fromAngle(finalAngle, finalSpeed);

    // Physical Cleat Contact Impulse Physics:
    // Replaces rigid velocity overwrite with elastic momentum impulse & cushioning
    const currVel = ball.vel.clone();
    const velDiff = Vector2.subtract(targetVel, currVel);
    const impulseMag = velDiff.magnitude();
    this.lastImpulse = impulseMag;

    // Contact restitution & cleat impulse compliance:
    // Elite players (controlQuality near 1.0) exert pristine, compliant contact (98% target compliance).
    // Clunkier players experience slight contact slip & restitution imperfection (74% compliance).
    const cleatCompliance = 0.74 + 0.24 * controlQuality;
    const appliedImpulse = Vector2.multiply(velDiff, cleatCompliance);
    const newBallVel = Vector2.add(currVel, appliedImpulse);

    // Apply micro-kick velocity
    ball.vel.set(newBallVel.x, newBallVel.y);
    ball.owner = null; // 100% free rigid body
    ball.lastTouch = this.player;

    // Cleat Surface Spin Injection:
    // Alternating touches with the outside/laces of alternating boots impart subtle physical spin:
    // - RIGHT boot (outside of right laces): brushes right flank -> clockwise spin (spinZ < 0)
    // - LEFT boot (outside of left laces): brushes left flank -> counter-clockwise spin (spinZ > 0)
    const isRightFoot = (this.lastTouchFoot === 'RIGHT');
    const spinMagnitude = 8.5 * (0.5 + 0.5 * (1.0 - controlQuality));
    ball.spinZ = isRightFoot ? -spinMagnitude : spinMagnitude;
    ball.isRolling = true;
    ball.backspin = 0.0;
    ball.lastKickType = isKnockOn ? 'KNOCK_ON' : 'DRIBBLE_TOUCH';
    this.lastTouchSurface = (pSpeed > 6.0) ? 'LACES' : 'OUTSIDE';

    if (this.player) {
      this.player.lastDribbleFoot = this.lastTouchFoot;
    }

    // Update state
    this.touchCooldown = strideTime;
    this.timeSinceLastTouch = 0.0;
    this.toggleFoot();
    this.triggerVfx(ball.pos);
  }

  toggleFoot() {
    this.lastTouchFoot = (this.lastTouchFoot === 'RIGHT') ? 'LEFT' : 'RIGHT';
  }

  triggerVfx(pos) {
    this.lastTouchPos.set(pos.x, pos.y);
    this.touchVfxTimer = 0.15;
  }
}
