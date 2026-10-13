/**
 * Metric Canvas 2D Renderer with Articulated Biomechanical Player Sprites.
 * Draws IFAB pitch markings, grass striping, animated feet/cleats synced to stride gait,
 * torso banking lean, and micro-touch contact ripples.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(playerOrPlayers, ball, environment, pitch, camera, input, trainingCourse = null) {
    const ctx = this.ctx;
    const playerList = Array.isArray(playerOrPlayers) ? playerOrPlayers : [playerOrPlayers];
    const activePlayer = playerList.find(p => p.isControlled) || playerList[0];

    // Clear background
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply Camera translation and zoom scale (meters to pixels)
    camera.applyTransform(ctx);

    try {
      // 1. Draw Turf Grass & Markings
      this.drawTurf(ctx, pitch, environment);
      this.drawPitchLines(ctx, pitch);
      this.drawGoals(ctx, pitch);

      // 2. Draw Ground Shadows
      for (const p of playerList) {
        this.drawPlayerShadow(ctx, p);
      }
      this.drawBallShadow(ctx, ball);

      // 3. Draw Micro-Touch Contact Ripple VFX (when foot strikes ball)
      for (const p of playerList) {
        this.drawTouchVfx(ctx, p);
      }

      // 4. Draw Pass Targeting Lane & Reticle (when teammate is targeted)
      if (activePlayer && activePlayer.targetedTeammate) {
        this.drawPassTargeting(ctx, activePlayer, activePlayer.targetedTeammate, input);
      }

      // 4.5 Draw Training Cones & Obstacle Drill Visuals
      if (trainingCourse && trainingCourse.active) {
        this.drawTrainingCones(ctx, trainingCourse);
      }

      // 5. Draw Articulated Players
      for (const p of playerList) {
        const isControlled = (p === activePlayer);
        this.drawArticulatedPlayer(ctx, p, ball, isControlled ? input : null, isControlled);
      }

      // 6. Draw 3D-Elevated Ball
      this.drawBall(ctx, ball);
    } catch (err) {
      console.error('Canvas render error:', err);
    } finally {
      camera.restoreTransform(ctx);
    }
  }

  drawTrainingCones(ctx, trainingCourse) {
    if (!trainingCourse || !trainingCourse.active || !trainingCourse.cones || trainingCourse.cones.length === 0) return;

    ctx.save();

    // 1. Draw Course Track Guidelines & Navigation Weave Paths
    if (trainingCourse.mode === 'SLALOM') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.18, 0.14]);
      ctx.beginPath();
      const first = trainingCourse.cones[0].pos;
      ctx.moveTo(first.x - 2.8, first.y);
      trainingCourse.cones.forEach((c, i) => {
        const sideY = (i % 2 === 0) ? -1.15 : 1.15;
        ctx.lineTo(c.pos.x, c.pos.y + sideY);
      });
      const last = trainingCourse.cones[trainingCourse.cones.length - 1].pos;
      ctx.lineTo(last.x + 2.8, last.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (trainingCourse.mode === 'ZIGZAG') {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.50)';
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.18, 0.14]);
      ctx.beginPath();
      trainingCourse.cones.forEach((c, i) => {
        if (i === 0) ctx.moveTo(c.pos.x - 2.2, c.pos.y);
        ctx.lineTo(c.pos.x, c.pos.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (trainingCourse.mode === 'BOX') {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.50)';
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.20, 0.16]);
      ctx.strokeRect(47.0, 30.5, 10.0, 7.0);
      ctx.setLineDash([]);
    }

    // 2. Draw Start & Finish Gate Banners
    const firstCone = trainingCourse.cones[0].pos;
    const lastCone = trainingCourse.cones[trainingCourse.cones.length - 1].pos;

    // Start Gate Banner (2.8m west of first cone)
    const startX = firstCone.x - 2.8;
    const startY = firstCone.y;
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.moveTo(startX, startY - 1.3);
    ctx.lineTo(startX, startY + 1.3);
    ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 0.28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('🚩 START', startX, startY - 1.4);

    // Finish Gate Banner (2.8m east of last cone)
    const finishX = lastCone.x + 2.8;
    const finishY = lastCone.y;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.moveTo(finishX, finishY - 1.3);
    ctx.lineTo(finishX, finishY + 1.3);
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 0.28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('🏁 FINISH', finishX, finishY - 1.4);

    // 3. Draw Each Cone with High-Contrast 3D Layers & Numbered Badge
    for (const cone of trainingCourse.cones) {
      const wobbleX = (cone.wobbleOffset && typeof cone.wobbleOffset.x === 'number') ? cone.wobbleOffset.x : 0;
      const wobbleY = (cone.wobbleOffset && typeof cone.wobbleOffset.y === 'number') ? cone.wobbleOffset.y : 0;
      const cx = cone.pos.x + wobbleX;
      const cy = cone.pos.y + wobbleY;
      const r = cone.radius || 0.18;

      // A. Ground Cast Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.arc(cx + 0.07, cy + 0.08, r * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // B. Fluorescent Orange Octagonal/Circular Base Skirt
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.20, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.025;
      ctx.strokeStyle = '#9a3412';
      ctx.stroke();

      // C. Primary Cone Body (Vibrant High-Visibility Neon Orange)
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
      ctx.fill();

      // D. Reflective White Vinyl Safety Stripe
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.018;
      ctx.stroke();

      // E. Upper Cone Apex (Bright Amber Highlight)
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.44, 0, Math.PI * 2);
      ctx.fill();

      // F. Top Cutout Center Hole
      ctx.fillStyle = '#7c2d12';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      ctx.fill();

      // G. Impact Wave Ripple (when struck)
      if (cone.hitTimer > 0) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.35 + (0.35 - cone.hitTimer) * 1.5), 0, Math.PI * 2);
        ctx.stroke();
      }

      // H. Floating Cone Number Pill Badge (#1, #2...)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
      ctx.beginPath();
      ctx.arc(cx, cy - r - 0.28, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 0.025;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 0.20px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cone.id), cx, cy - r - 0.28);
    }

    ctx.restore();
  }

  drawTurf(ctx, pitch, environment) {
    const stripeWidth = 5.526;
    const numStripes = 19;

    let lightGreen = '#16a34a';
    let darkGreen = '#15803d';

    if (environment.turfType === 'WET') {
      lightGreen = '#059669';
      darkGreen = '#047857';
    } else if (environment.turfType === 'LONG') {
      lightGreen = '#15803d';
      darkGreen = '#166534';
    }

    for (let i = 0; i < numStripes; i++) {
      ctx.fillStyle = (i % 2 === 0) ? lightGreen : darkGreen;
      ctx.fillRect(i * stripeWidth, 0, stripeWidth, pitch.width);
    }
  }

  drawPitchLines(ctx, pitch) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = pitch.lineWidth;

    // Touchlines
    ctx.strokeRect(0, 0, pitch.length, pitch.width);

    // Halfway line
    ctx.beginPath();
    ctx.moveTo(pitch.halfLength, 0);
    ctx.lineTo(pitch.halfLength, pitch.width);
    ctx.stroke();

    // Center circle & center mark
    ctx.beginPath();
    ctx.arc(pitch.halfLength, pitch.halfWidth, pitch.centerCircleRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pitch.halfLength, pitch.halfWidth, 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Left Penalty Box & 6-Yard Box
    ctx.strokeRect(0, pitch.penaltyTop, pitch.penaltyDepth, pitch.penaltyWidth);
    ctx.strokeRect(0, pitch.goalAreaTop, pitch.goalAreaDepth, pitch.goalAreaWidth);
    ctx.beginPath();
    ctx.arc(pitch.penaltySpotDist, pitch.halfWidth, 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pitch.penaltySpotDist, pitch.halfWidth, pitch.penaltyArcRadius, -0.93, 0.93);
    ctx.stroke();

    // Right Penalty Box & 6-Yard Box
    ctx.strokeRect(pitch.length - pitch.penaltyDepth, pitch.penaltyTop, pitch.penaltyDepth, pitch.penaltyWidth);
    ctx.strokeRect(pitch.length - pitch.goalAreaDepth, pitch.goalAreaTop, pitch.goalAreaDepth, pitch.goalAreaWidth);
    ctx.beginPath();
    ctx.arc(pitch.length - pitch.penaltySpotDist, pitch.halfWidth, 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pitch.length - pitch.penaltySpotDist, pitch.halfWidth, pitch.penaltyArcRadius, Math.PI - 0.93, Math.PI + 0.93);
    ctx.stroke();

    // Corner Arcs
    ctx.beginPath();
    ctx.arc(0, 0, pitch.cornerArcRadius, 0, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, pitch.width, pitch.cornerArcRadius, -Math.PI / 2, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pitch.length, 0, pitch.cornerArcRadius, Math.PI / 2, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pitch.length, pitch.width, pitch.cornerArcRadius, Math.PI, -Math.PI / 2);
    ctx.stroke();
  }

  drawGoals(ctx, pitch) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = pitch.postDiameter;

    // Left Goal
    ctx.strokeRect(-pitch.goalDepth, pitch.goalTop, pitch.goalDepth, pitch.goalWidth);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(-pitch.goalDepth, pitch.goalTop, pitch.goalDepth, pitch.goalWidth);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, pitch.goalTop, pitch.postDiameter / 2, 0, Math.PI * 2);
    ctx.arc(0, pitch.goalBottom, pitch.postDiameter / 2, 0, Math.PI * 2);
    ctx.fill();

    // Right Goal
    ctx.strokeRect(pitch.length, pitch.goalTop, pitch.goalDepth, pitch.goalWidth);
    ctx.fillRect(pitch.length, pitch.goalTop, pitch.goalDepth, pitch.goalWidth);

    ctx.beginPath();
    ctx.arc(pitch.length, pitch.goalTop, pitch.postDiameter / 2, 0, Math.PI * 2);
    ctx.arc(pitch.length, pitch.goalBottom, pitch.postDiameter / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawShadows(ctx, playerOrPlayers, ball) {
    const list = Array.isArray(playerOrPlayers) ? playerOrPlayers : [playerOrPlayers];
    for (const p of list) {
      this.drawPlayerShadow(ctx, p);
    }
    this.drawBallShadow(ctx, ball);
  }

  drawPlayerShadow(ctx, player) {
    // Player ground shadow (modulates with vertical hop elevation hopBounceZ)
    const hopZ = player.hopBounceZ || 0.0;
    const shadowScale = Math.max(0.68, 1.0 - hopZ * 2.8);
    const shadowAlpha = Math.max(0.12, 0.32 - hopZ * 2.2);
    const shadowOffsetX = 0.08 + hopZ * 1.5;
    const shadowOffsetY = 0.12 + hopZ * 1.8;

    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(
      player.pos.x + shadowOffsetX,
      player.pos.y + shadowOffsetY,
      player.locomotion.radius * 1.1 * shadowScale,
      player.locomotion.radius * 0.7 * shadowScale,
      player.heading,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  drawBallShadow(ctx, ball) {
    // Ball ground shadow (scales with elevation z)
    const shadowBallScale = Math.max(0.35, 1.0 - ball.z * 0.15);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(ball.pos.x + 0.05, ball.pos.y + 0.08, ball.radius * shadowBallScale, (ball.radius * 0.6) * shadowBallScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTouchVfx(ctx, player) {
    if (player.dribble && player.dribble.touchVfxTimer > 0) {
      const alpha = player.dribble.touchVfxTimer / 0.15;
      const rippleR = 0.35 * (1.0 - alpha * 0.5);

      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(player.dribble.lastTouchPos.x, player.dribble.lastTouchPos.y, rippleR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawPassTargeting(ctx, kicker, targetInfo, input) {
    const receiver = targetInfo.receiver;
    if (!receiver) return;

    let targetLeadPos = receiver.pos.clone();
    const kickType = (input && input.pendingThrough) ? 'GROUND_THROUGH'
      : ((input && input.pendingLoft) ? 'LOFT_CHIP' : 'SHORT_PASS');
    const userPower = (input && input.pendingPass) ? input.pendingPass.power
      : ((input && input.pendingThrough) ? input.pendingThrough.power : 0.5);

    if (input && input.passing) {
      const leadCalc = input.passing.calculateLeadTarget(kicker, receiver, kickType, userPower);
      targetLeadPos = leadCalc.targetPos;
    }

    ctx.save();
    // 1. Passing Lane Guideline from Kicker to Lead Target
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 0.035;
    ctx.setLineDash([0.18, 0.14]);
    ctx.beginPath();
    ctx.moveTo(kicker.pos.x, kicker.pos.y);
    ctx.lineTo(targetLeadPos.x, targetLeadPos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Glowing Reticle around Target Teammate
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 0.032;
    ctx.beginPath();
    ctx.arc(receiver.pos.x, receiver.pos.y, receiver.locomotion.radius + 0.28, 0, Math.PI * 2);
    ctx.stroke();

    // Corner crosshairs on reticle
    const r = receiver.locomotion.radius + 0.36;
    ctx.beginPath();
    ctx.moveTo(receiver.pos.x - r, receiver.pos.y);
    ctx.lineTo(receiver.pos.x - r + 0.14, receiver.pos.y);
    ctx.moveTo(receiver.pos.x + r - 0.14, receiver.pos.y);
    ctx.lineTo(receiver.pos.x + r, receiver.pos.y);
    ctx.moveTo(receiver.pos.x, receiver.pos.y - r);
    ctx.lineTo(receiver.pos.x, receiver.pos.y - r + 0.14);
    ctx.moveTo(receiver.pos.x, receiver.pos.y + r - 0.14);
    ctx.lineTo(receiver.pos.x, receiver.pos.y + r);
    ctx.stroke();

    // 3. Lead Corridor Destination Marker for Through Balls
    if (input && (input.isChargingThrough || input.pendingThrough)) {
      ctx.fillStyle = 'rgba(168, 85, 247, 0.85)';
      ctx.beginPath();
      ctx.arc(targetLeadPos.x, targetLeadPos.y, 0.20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.025;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.arc(targetLeadPos.x, targetLeadPos.y, 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Distance Label (meters)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 0.40px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const midX = (kicker.pos.x + receiver.pos.x) * 0.5;
    const midY = (kicker.pos.y + receiver.pos.y) * 0.5 - 0.35;
    ctx.fillText(`🎯 ${targetInfo.distance.toFixed(1)}m`, midX, midY);

    ctx.restore();
  }

  drawArticulatedPlayer(ctx, player, ball, input, isControlled = true) {
    const distToBall = player.pos.dist(ball.pos);
    const inReach = player.isBallInTouchEnvelope ? player.isBallInTouchEnvelope(ball, 0.0) : (distToBall < 1.05);
    const isBallNear = distToBall < 2.5;

    // Active Selection Triangle Cursor above active player head (PES/FIFA style)
    if (isControlled) {
      ctx.save();
      const cursorY = player.pos.y - player.locomotion.radius - 0.48;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(player.pos.x, cursorY);
      ctx.lineTo(player.pos.x - 0.18, cursorY - 0.26);
      ctx.lineTo(player.pos.x + 0.18, cursorY - 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.025;
      ctx.stroke();
      ctx.restore();
    }

    // 1. Realistic Forward-Biased Anatomical Foot Reach Envelope
    if (isBallNear) {
      ctx.save();
      ctx.translate(player.pos.x, player.pos.y);
      ctx.rotate(player.heading + player.bodyLean);

      // Draw smooth asymmetrical foot-reach envelope in local player coordinates
      // (Forward reach extends 1.05m ahead, sides reach 0.65m, rear curves tightly at heels -0.15m)
      ctx.beginPath();
      const steps = 36;
      const xc = 0.35;
      const aFwd = 0.70;
      const aRear = 0.50;
      const bLat = 0.65;
      for (let i = 0; i <= steps; i++) {
        const phi = (i / steps) * Math.PI * 2;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);
        const a = (cosP >= 0) ? aFwd : aRear;
        const lx = xc + a * cosP;
        const ly = bLat * sinP;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.closePath();

      if (player.isHoldingTrap) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.09)';
        ctx.fill();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 0.035;
        ctx.stroke();
      } else if (inReach) {
        const inPocket = player.isBallInBootPocket ? player.isBallInBootPocket(ball) : true;
        if (inPocket && !player.dribble.isBallFreeRolling) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 0.028;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.05)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.lineWidth = 0.024;
          ctx.setLineDash([0.08, 0.06]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // Approaching ball: subtle tactical dashed outline showing forward reach
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 0.018;
        ctx.setLineDash([0.06, 0.08]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw sweet-spot boot pocket indicator (0.42m ahead, between cleats)
      const isTouchPulse = player.dribble.touchVfxTimer > 0;
      ctx.beginPath();
      ctx.arc(0.42, 0.0, 0.16, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.strokeStyle = player.isHoldingTrap
        ? 'rgba(16, 185, 129, 0.75)'
        : (isTouchPulse ? 'rgba(56, 189, 248, 0.95)' : 'rgba(56, 189, 248, 0.35)');
      ctx.lineWidth = isTouchPulse ? 0.032 : 0.018;
      ctx.stroke();

      ctx.restore();

      if (player.isHoldingTrap) {
        // Draw active sole contact guideline from player to ball in forward pocket
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
        ctx.lineWidth = 0.03;
        ctx.setLineDash([0.06, 0.06]);
        ctx.beginPath();
        ctx.moveTo(player.pos.x, player.pos.y);
        ctx.lineTo(ball.pos.x, ball.pos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 2. Transform Context to Player Center & Heading
    ctx.save();
    ctx.translate(player.pos.x, player.pos.y);
    ctx.rotate(player.heading + player.bodyLean); // Banking lean into turns

    const speed = player.vel.magnitude();
    const hopZ = player.hopBounceZ || 0.0;
    const hopScale = 1.0 + hopZ * 0.75;
    const torsoSwayY = player.lateralTorsoSway || 0.0;

    // Feet / Cleat Kinematics
    if (player.isHoldingTrap) {
      // PES 2017 Real Touch / Futsal Sole-Roll Footwork:
      // Manipulating boot rests forward on top/side of ball in forward pocket
      const manFootX = player.trapPocketDist - 0.10;
      const manFootY = player.trapLateralOffset;
      const isRightActive = player.soleActiveFoot === 'RIGHT';

      // Stance support boot hops in rhythm on turf underneath player
      const stanceFootX = Math.cos(player.hopPhase) * 0.03;
      const stanceFootY = isRightActive ? -0.16 : 0.16;

      if (isRightActive) {
        this.drawBoot(ctx, manFootX, manFootY, true, '#10b981'); // Emerald sole contact on ball
        this.drawBoot(ctx, stanceFootX, stanceFootY, false);      // Hopping support boot
      } else {
        this.drawBoot(ctx, stanceFootX, stanceFootY, false);      // Hopping support boot
        this.drawBoot(ctx, manFootX, manFootY, true, '#10b981'); // Emerald sole contact on ball
      }
    } else if (player.isHopping) {
      // Rapid shuffle-hopping in close control / jockey stance
      const strideLength = 0.12;
      const rightFootX = Math.sin(player.hopPhase) * strideLength;
      const leftFootX = -Math.sin(player.hopPhase) * strideLength;
      const hipY = 0.16;
      this.drawBoot(ctx, rightFootX, hipY, false);
      this.drawBoot(ctx, leftFootX, -hipY, false);
    } else {
      // Standard running stride articulation
      const strideScale = Math.min(1.0, speed / 3.0);
      const strideLength = 0.18 + (speed / player.locomotion.sprintSpeed) * 0.18;
      const rightFootX = Math.sin(player.gaitPhase) * strideLength * strideScale;
      const leftFootX = -Math.sin(player.gaitPhase) * strideLength * strideScale;
      const hipY = 0.15;
      this.drawBoot(ctx, rightFootX, hipY, player.dribble.lastTouchFoot === 'RIGHT' && player.dribble.touchVfxTimer > 0);
      this.drawBoot(ctx, leftFootX, -hipY, player.dribble.lastTouchFoot === 'LEFT' && player.dribble.touchVfxTimer > 0);
    }

    // 3. Tactical Directional Aim Chevron / Guide Cone (0.40m to 1.35m ahead for active player)
    if (isControlled) {
      const stance = player.lastStanceQuality || { powerFactor: 1.0, isOffBalance: false };
      let chevronColor = '#38bdf8';
      if (stance.isOffBalance || stance.powerFactor < 0.70) {
        chevronColor = '#ef4444'; // Red warning for scuffed/off-balance pass
      } else if (stance.powerFactor < 0.88) {
        chevronColor = '#f59e0b'; // Amber half-turn
      }

      ctx.strokeStyle = chevronColor;
      ctx.lineWidth = 0.022;
      ctx.setLineDash([0.08, 0.08]);
      ctx.beginPath();
      ctx.moveTo(0.40, 0);
      ctx.lineTo(1.20, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tactical Facing Arrow Head at 1.35m ahead
      ctx.fillStyle = chevronColor;
      ctx.beginPath();
      ctx.moveTo(1.35, 0);
      ctx.lineTo(1.15, -0.09);
      ctx.lineTo(1.20, 0);
      ctx.lineTo(1.15, 0.09);
      ctx.closePath();
      ctx.fill();

      // Visual pulse if PES action buffer is currently armed
      if (player.firstTimeBuffer) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        ctx.arc(1.25, 0, 0.16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 4. Draw Athletic Torso / Jersey (Anatomical Chest vs Back Distinction)
    const torsoX = player.torsoPitch;
    const torsoRx = 0.16 * hopScale;
    const torsoRy = 0.23 * hopScale;

    // Back Half of Jersey
    ctx.fillStyle = player.secondaryKitColor || '#1d4ed8';
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoSwayY, torsoRx, torsoRy, 0, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.fill();

    // Front Chest Half of Jersey
    ctx.fillStyle = player.kitColor || '#3b82f6';
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoSwayY, torsoRx, torsoRy, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Jersey Outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.ellipse(torsoX, torsoSwayY, torsoRx, torsoRy, 0, 0, Math.PI * 2);
    ctx.stroke();

    // White Chest Collar / V-Neck (Points forward towards +X)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(torsoX + 0.05, torsoSwayY - 0.08);
    ctx.lineTo(torsoX + 0.12, torsoSwayY);
    ctx.lineTo(torsoX + 0.05, torsoSwayY + 0.08);
    ctx.stroke();

    // Jersey Number (Centered on back half)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 0.13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(player.number || '10'), torsoX - 0.05, torsoSwayY);

    // 5. Draw Head & Prominent Directional Visor Wedge
    const headX = torsoX + 0.12;
    ctx.fillStyle = '#fde047'; // Athlete Hair / Cap
    ctx.beginPath();
    ctx.arc(headX, torsoSwayY, 0.11 * hopScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 0.02;
    ctx.stroke();

    // Sharp, High-Contrast Cyan Visor Wedge Pointing Forward
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(headX + 0.18, torsoSwayY);
    ctx.lineTo(headX + 0.04, torsoSwayY - 0.09);
    ctx.lineTo(headX + 0.07, torsoSwayY);
    ctx.lineTo(headX + 0.04, torsoSwayY + 0.09);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.02;
    ctx.stroke();

    ctx.restore();

    // Power Charge Meter if charging shot, pass, or through ball
    let activePower = null;
    let powerColor = '#ef4444';
    let powerLabel = 'POWER';

    if (input) {
      if (input.isChargingPass || input.pendingPass) {
        const val = input.isChargingPass ? input.passChargeTime : input.pendingPass.power;
        const isDriven = input.isDrivenPass || (input.pendingPass && input.pendingPass.isDriven);
        activePower = val;
        powerColor = isDriven ? '#38bdf8' : '#10b981'; // Cyan if driven, Green if pass
        powerLabel = isDriven ? 'DRIVEN PASS' : 'PASS';
      } else if (input.isChargingThrough || input.pendingThrough) {
        const val = input.isChargingThrough ? input.throughChargeTime : input.pendingThrough.power;
        const isLofted = input.isLoftedThrough || (input.pendingThrough && input.pendingThrough.isLofted);
        activePower = val;
        powerColor = isLofted ? '#a855f7' : '#0284c7'; // Purple if lofted, Blue if through
        powerLabel = isLofted ? 'CHIPPED THROUGH' : 'THROUGH BALL';
      } else if (input.isChargingLoft || input.pendingLoft) {
        const val = input.isChargingLoft ? input.loftChargeTime : input.pendingLoft.power;
        const isClearance = input.isClearance || (input.pendingLoft && input.pendingLoft.isClearance);
        activePower = val;
        powerColor = isClearance ? '#f97316' : '#a855f7'; // Orange if clearance, Purple if loft
        powerLabel = isClearance ? 'CLEARANCE' : (val < 0.45 ? 'CHIP SCOOP' : 'LOFTED PASS');
      } else if (input.isChargingShot || input.pendingShot) {
        const val = input.isChargingShot ? input.shotChargeTime : input.pendingShot.power;
        const isFinesse = input.isFinesseShot || (input.pendingShot && input.pendingShot.kickType === 'FINESSE_SHOT');
        activePower = val;
        powerColor = isFinesse ? '#ec4899' : (input.isChargingShot ? '#f59e0b' : '#ef4444');
        powerLabel = isFinesse ? 'FINESSE SHOT' : 'SHOT';
      }
    }

    if (activePower !== null) {
      const barW = 1.25;
      const barH = 0.16;
      const barX = player.pos.x - barW / 2;
      const barY = player.pos.y - player.locomotion.radius - 0.55;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(barX, barY, barW, barH);

      ctx.fillStyle = powerColor;
      const fillW = barW * Math.min(1.0, activePower / 1.0);
      ctx.fillRect(barX, barY, fillW, barH);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.02;
      ctx.strokeRect(barX, barY, barW, barH);

      // Render crisp label above bar
      ctx.save();
      ctx.font = 'bold 0.12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${powerLabel} ${Math.round(activePower * 100)}%`, player.pos.x, barY - 0.03);
      ctx.restore();
    }

    // Dynamic Stamina Meter beneath player
    const stamVal = player.locomotion.stamina;
    if (stamVal < 98.0) {
      const stamW = 0.90; // meters wide
      const stamH = 0.08; // meters high
      const stamX = player.pos.x - stamW / 2;
      const stamY = player.pos.y + player.locomotion.radius + 0.22;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(stamX, stamY, stamW, stamH);

      let stamColor = '#10b981'; // Emerald
      if (stamVal < 30.0) stamColor = '#ef4444'; // Red
      else if (stamVal < 60.0) stamColor = '#f59e0b'; // Amber

      ctx.fillStyle = stamColor;
      ctx.fillRect(stamX, stamY, stamW * (stamVal / 100.0), stamH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 0.015;
      ctx.strokeRect(stamX, stamY, stamW, stamH);
    }

    // Overhead PES Action Notification Badge
    if (player.actionNotification && player.actionNotification.timer > 0) {
      const notif = player.actionNotification;
      const alpha = Math.min(1.0, notif.timer / 0.18);
      const badgeY = player.pos.y - player.locomotion.radius - 0.88;

      ctx.save();
      // Generous, bold metric font (0.34m high) so it remains instantly readable at all zoom heights
      ctx.font = 'bold 0.34px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(notif.text).width;
      const boxW = Math.max(1.10, textW + 0.35);
      const boxH = 0.44;

      // Deep obsidian backdrop with high-contrast colored stroke
      ctx.fillStyle = `rgba(15, 23, 42, ${0.92 * alpha})`;
      ctx.fillRect(player.pos.x - boxW / 2, badgeY - boxH / 2, boxW, boxH);

      ctx.strokeStyle = notif.color;
      ctx.lineWidth = 0.035;
      ctx.strokeRect(player.pos.x - boxW / 2, badgeY - boxH / 2, boxW, boxH);

      // Text with drop shadow
      ctx.fillStyle = notif.color;
      ctx.fillText(notif.text, player.pos.x, badgeY);
      ctx.restore();
    }
  }

  drawBoot(ctx, forwardX, lateralY, isContactFoot, accentColor = null) {
    ctx.save();
    ctx.translate(forwardX, lateralY);

    // Boot body
    ctx.fillStyle = isContactFoot ? (accentColor || '#38bdf8') : '#1e293b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.10, 0.055, 0, 0, Math.PI * 2);
    ctx.fill();

    // Boot tip / toe
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0.08, 0, 0.035, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Cleat studs ring if sole contact
    if (accentColor) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.015;
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBall(ctx, ball) {
    const drawY = ball.pos.y - ball.z;
    const drawR = ball.radius + ball.z * 0.015;

    // Ball body
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.pos.x, drawY, drawR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.025;
    ctx.stroke();

    // Classic pentagon center
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(ball.pos.x, drawY, drawR * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // Sole Roll / Spin indicator
    if (Math.abs(ball.spinZ) > 5.0) {
      ctx.strokeStyle = (ball.lastKickType === 'SOLE_ROLL' || ball.lastKickType === 'TRAP_HOLD') ? '#a855f7' : '#38bdf8';
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      ctx.arc(ball.pos.x, drawY, drawR * 1.25, 0, Math.PI);
      ctx.stroke();
    }
  }
}
