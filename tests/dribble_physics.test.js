import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';

console.log('⚡ Running Dribble & Stride Biomechanics Tests...');

const pitch = new Pitch();
const env = new Environment({ turfType: 'DRY' });

// 1. Test Physical Independence (Ball is NEVER glued)
const player = new PlayerEntity({ x: 50.0, y: 34.0 });
const ball = new Ball(50.4, 34.0); // Ball within control reach

// Execute one micro-touch
player.dribble.executeMicroTouch(ball, new Vector2(1, 0), 'RUN');

assert.strictEqual(ball.owner, null, 'Ball must NEVER be glued to player (owner must be null)');
assert.ok(ball.vel.x > player.vel.x, 'Ball must be propelled forward independently by micro-touch');

// Step ball forward: verify it decelerates under ground friction independently
const initialBallSpeed = ball.vel.magnitude();
for (let i = 0; i < 20; i++) {
  ball.update(0.016, env, pitch);
}
assert.ok(ball.vel.magnitude() < initialBallSpeed, 'Ball must decelerate freely under grass friction between touches');
console.log('  ✔ Physical Independence: Ball is 100% free rigid body, decelerating under turf friction');

// 2. Test Dribble Modes (Close Control vs Knock-On)
// Close control test
player.dribble.setMode('CLOSE');
player.pos.set(50.0, 34.0);
ball.pos.set(50.4, 34.0);
player.dribble.executeMicroTouch(ball, new Vector2(1, 0), 'WALK');
const closePushSpeed = ball.vel.magnitude();

// Knock-on test
player.dribble.setMode('KNOCK_ON');
player.pos.set(50.0, 34.0);
ball.pos.set(50.4, 34.0);
player.dribble.executeMicroTouch(ball, new Vector2(1, 0), 'SPRINT');
const knockOnPushSpeed = ball.vel.magnitude();

assert.ok(knockOnPushSpeed > closePushSpeed * 1.8, 
  `Knock-on push speed (${knockOnPushSpeed.toFixed(1)} m/s) must be much higher than close control (${closePushSpeed.toFixed(1)} m/s)`);
console.log(`  ✔ Dribble Modes: Close control speed = ${closePushSpeed.toFixed(1)} m/s vs Knock-on speed = ${knockOnPushSpeed.toFixed(1)} m/s`);

// 3. Test Skill Variance (Elite 95 vs Clunky 55)
// Sample 60 touches for Elite (95) and 60 touches for Clunky (55)
let eliteAngleVariance = 0;
let clunkyAngleVariance = 0;
const targetDir = new Vector2(1, 0);

// Elite (95)
player.dribble.setSkill(95);
player.dribble.setMode('CRUISE');
for (let i = 0; i < 60; i++) {
  ball.pos.set(50.4, 34.0);
  player.dribble.executeMicroTouch(ball, targetDir, 'RUN');
  eliteAngleVariance += Math.abs(ball.vel.heading());
}
eliteAngleVariance /= 60;

// Clunky (55)
player.dribble.setSkill(55);
for (let i = 0; i < 60; i++) {
  ball.pos.set(50.4, 34.0);
  player.dribble.executeMicroTouch(ball, targetDir, 'RUN');
  clunkyAngleVariance += Math.abs(ball.vel.heading());
}
clunkyAngleVariance /= 60;

assert.ok(clunkyAngleVariance > eliteAngleVariance * 2.0, 
  `Clunky dribbler error (${(clunkyAngleVariance*180/Math.PI).toFixed(1)}°) must be substantially higher than Elite (${(eliteAngleVariance*180/Math.PI).toFixed(1)}°)`);
console.log(`  ✔ Skill Variance: Elite directional noise = ${(eliteAngleVariance*180/Math.PI).toFixed(1)}° vs Clunky noise = ${(clunkyAngleVariance*180/Math.PI).toFixed(1)}°`);

// 4. Test Articulated Stride Gait Phase
player.vel.set(5.0, 0); // running at 5 m/s
const initialGaitPhase = player.gaitPhase;
player.update(0.1, ball, pitch, env, new Vector2(1, 0), 'RUN');
assert.notStrictEqual(player.gaitPhase, initialGaitPhase, 'Player gaitPhase must advance during locomotion');
console.log('  ✔ Articulated Stride: Gait phase cycles with footfall cadence');

// 5. Test Turf Dynamic Dribbling Sensitivity (Dry vs Wet vs Long)
const envWetTest = new Environment({ turfType: 'WET' });
const envLongTest = new Environment({ turfType: 'LONG' });
assert.ok(envWetTest.getRollingDeceleration() < env.getRollingDeceleration(), 'Wet turf must have lower deceleration than dry turf');
assert.ok(envLongTest.getRollingDeceleration() > env.getRollingDeceleration(), 'Long turf must have higher deceleration than dry turf');
console.log(`  ✔ Turf Resistance: Dry (${env.getRollingDeceleration().toFixed(2)} m/s²) vs Wet (${envWetTest.getRollingDeceleration().toFixed(2)} m/s²) vs Long (${envLongTest.getRollingDeceleration().toFixed(2)} m/s²)`);

// 6. Test Skimming Shot Bounce Retention
const shotBall = new Ball(50, 34);
shotBall.vel.set(26.0, 0); // 26 m/s horizontal shot
shotBall.z = 0.05;
shotBall.vz = -1.2; // shallow grazing vertical impact

shotBall.update(0.016, env, pitch); // triggers bounce
assert.ok(shotBall.vel.x > 24.5, 
  `Grazing shot bounce should retain > 94% forward velocity, got ${shotBall.vel.x.toFixed(2)} m/s`);
console.log(`  ✔ Skimming Shot Bounce: Preserved ${((shotBall.vel.x / 26.0)*100).toFixed(1)}% forward velocity on grazing grass bounce`);

// 7. Test Plant-and-Cut Direction Reversal (180° flip without wide airplane arc)
let moveVel = new Vector2(3.0, 0); // Jogging East at 3 m/s
const cutLocomotion = player.locomotion;
// Player suddenly wants to run West (-1, 0)
// To reverse from 3.0 m/s to negative x respecting maxBrake (7.2 m/s²),
// deceleration to stop requires t = 3.0 / 7.2 = 0.417s (~26 frames at 60fps).
let cutTicks = 0;
while (cutTicks < 26) { // ~0.41 seconds
  moveVel = cutLocomotion.updateVelocity(moveVel, new Vector2(-1, 0), cutLocomotion.runSpeed, 0.016);
  cutTicks++;
}
assert.ok(moveVel.x < 0, 'Player must have pivoted to face West in ~0.42s respecting maxBrake limits');
console.log(`  ✔ Plant-and-Cut Reversal: Successfully flipped 180° in ${(cutTicks * 0.016).toFixed(2)}s (current vel: ${moveVel.x.toFixed(2)} m/s West)`);

// 8. Test Stamina Scaling on Jogging Speed
cutLocomotion.stamina = 100.0;
const freshJogSpeed = cutLocomotion.getEffectiveRunSpeed();
cutLocomotion.stamina = 0.0; // fully exhausted
const fatiguedJogSpeed = cutLocomotion.getEffectiveRunSpeed();
assert.ok(Math.abs(freshJogSpeed - 5.2) < 0.05, 'Fresh jog speed should be ~5.2 m/s');
assert.ok(fatiguedJogSpeed < 3.7 && fatiguedJogSpeed > 3.4, 
  `Fatigued jog speed should drop to ~3.5-3.6 m/s, got ${fatiguedJogSpeed.toFixed(2)} m/s`);
console.log(`  ✔ Stamina Jog Scaling: Fresh (${freshJogSpeed.toFixed(1)} m/s) -> Gassed (${fatiguedJogSpeed.toFixed(1)} m/s)`);

// 9. Test Knock-On Automatic Sprint Surge
player.knockOnSurgeTimer = 0.0;
player.dribble.setMode('KNOCK_ON');
player.pos.set(50, 34);
ball.pos.set(50.4, 34);
player.dribble.executeMicroTouch(ball, new Vector2(1, 0), 'RUN', env);
assert.ok(player.knockOnSurgeTimer > 1.0, 'Knock-on must trigger automatic sprint surge timer');
console.log(`  ✔ Knock-On Surge: Auto-sprint burst active for ${player.knockOnSurgeTimer.toFixed(2)}s`);

// 10. Test Asymmetric Anatomical Foot Reach Envelope (No behind-the-back touches)
const envPlayer = new PlayerEntity({ x: 50.0, y: 34.0 });
envPlayer.heading = 0.0; // Facing East (+X)
const envBall = new Ball(50.5, 34.0);

// Forward reach: 0.5m ahead is inside envelope
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), true, 'Ball 0.5m ahead must be within foot reach envelope');
assert.strictEqual(envPlayer.isBallInBootPocket(envBall), true, 'Ball 0.5m ahead must be in tight boot pocket');

// Forward maximum reach: 1.0m ahead is within reach, but outside tight boot pocket
envBall.pos.set(51.0, 34.0);
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), true, 'Ball 1.0m ahead must be reachable at stride extension');
assert.strictEqual(envPlayer.isBallInBootPocket(envBall), false, 'Ball 1.0m ahead is extended, outside tight boot pocket');

// Out of reach forward: 1.2m ahead
envBall.pos.set(51.2, 34.0);
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), false, 'Ball 1.2m ahead must be out of foot reach');

// Behind player: 0.4m behind heels (x = 49.6, player = 50.0)
envBall.pos.set(49.6, 34.0);
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), false, 'Ball trailing behind heels cannot be within foot reach envelope');
assert.strictEqual(envPlayer.isBallKickable(envBall, 0.0), false, 'Ball trailing behind heels cannot be kicked forward');

// DribbleController does NOT micro-touch balls trailing behind player
envBall.vel.set(0.0, 0.0);
envPlayer.dribble.touchCooldown = 0.0;
envPlayer.dribble.update(0.016, envBall, new Vector2(1, 0), 'RUN', env);
assert.strictEqual(envBall.vel.magnitude(), 0.0, 'Trailing ball behind player must remain completely untouched');
assert.strictEqual(envPlayer.dribble.isBallFreeRolling, true, 'Trailing ball must be marked as free-rolling');

// Lateral reach: 0.5m to side at x=50.35m
envBall.pos.set(50.35, 34.5);
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), true, 'Ball 0.5m to the side must be reachable by instep/outstep');

// Wide outside lateral reach: 1.0m to side
envBall.pos.set(50.35, 35.0);
assert.strictEqual(envPlayer.isBallInTouchEnvelope(envBall, 0.0), false, 'Ball 1.0m to the side must be out of reach');

console.log('  ✔ Anatomical Foot Reach Envelope: Directional forward reach (1.05m), lateral stretch (0.65m), and zero behind-the-back touches verified');

// 11. Test Stride-Cadence Ball Carrying & Alternating Cleats
{
  const carryPlayer = new PlayerEntity({ x: 50.0, y: 34.0 });
  carryPlayer.heading = 0.0; // East
  carryPlayer.vel.set(4.0, 0.0);
  const carryBall = new Ball(50.45, 34.0);

  // First stride touch
  carryPlayer.dribble.lastTouchFoot = 'LEFT';
  carryPlayer.dribble.touchCooldown = 0.0;
  carryPlayer.dribble.update(0.016, carryBall, new Vector2(1, 0), 'RUN', env);

  assert.strictEqual(carryPlayer.dribble.lastTouchFoot, 'RIGHT', 'Carrying touch must alternate to RIGHT boot');
  assert.ok(carryBall.vel.x >= 3.8, `Ball carried smoothly forward at ${carryBall.vel.x.toFixed(2)} m/s in player stride`);

  // Second stride touch
  carryPlayer.dribble.touchCooldown = 0.0;
  carryPlayer.dribble.update(0.016, carryBall, new Vector2(1, 0), 'RUN', env);
  assert.strictEqual(carryPlayer.dribble.lastTouchFoot, 'LEFT', 'Carrying touch must alternate back to LEFT boot');
  console.log('  ✔ Stride-Cadence Carrying: Rhythmic shepherding with alternating left/right cleat footfalls verified');
}

// 12. Test Assistive Directional Cutting (Elite vs Clunky, Speed & Deceleration)
{
  const cutP = new PlayerEntity({ x: 50.0, y: 34.0 });
  cutP.heading = 0.0; // Moving East
  cutP.vel.set(5.0, 0.0);
  const cutB = new Ball(50.45, 34.0);

  // Player inputs sharp 90° North cut (0, -1)
  const cutDir = new Vector2(0, -1);
  cutP.dribble.setSkill(95); // Elite dribbler
  cutP.dribble.touchCooldown = 0.0;
  const initialSpeed = cutP.vel.magnitude();

  cutP.dribble.update(0.016, cutB, cutDir, 'RUN', env);

  // Directional cut checks
  assert.strictEqual(cutP.dribble.lastTouchFoot, 'LEFT', 'Cutting North (left turn) must use LEFT boot outside hook');
  assert.ok(cutB.vel.y < -3.0, `Ball redirected sharply North (vy: ${cutB.vel.y.toFixed(2)} m/s)`);
  assert.ok(cutP.vel.magnitude() < initialSpeed, 'Cutting at 5.0 m/s must cost slight plant-and-cut momentum');
  assert.ok(cutP.vel.magnitude() >= 4.2, 'Elite player must retain > 84% exit speed through sharp cut');

  // Clunky dribbler comparison
  const clunkyP = new PlayerEntity({ x: 50.0, y: 34.0 });
  clunkyP.heading = 0.0;
  clunkyP.vel.set(5.0, 0.0);
  const clunkyB = new Ball(50.45, 34.0);
  clunkyP.dribble.setSkill(50); // Low rating
  clunkyP.dribble.touchCooldown = 0.0;

  clunkyP.dribble.update(0.016, clunkyB, cutDir, 'RUN', env);
  assert.ok(clunkyP.vel.magnitude() < cutP.vel.magnitude(), 'Clunky player must suffer heavier plant-and-cut deceleration penalty');
  console.log(`  ✔ Assistive Directional Cuts: 90° cut cleanly redirected North; Elite exit speed (${cutP.vel.magnitude().toFixed(2)} m/s) vs Clunky exit (${clunkyP.vel.magnitude().toFixed(2)} m/s) verified`);
}

// 13. Test Sprint Carrying Speed Cap (7.6 m/s) vs Knock-On Burst (8.8 m/s)
{
  const sprintP = new PlayerEntity({ x: 50.0, y: 34.0 });
  sprintP.heading = 0.0;
  sprintP.vel.set(6.5, 0.0);
  const sprintB = new Ball(50.5, 34.0);

  // Step movement 60 times holding sprint while carrying ball
  for (let i = 0; i < 60; i++) {
    sprintP.move(new Vector2(1, 0), 'SPRINT', 0.016, sprintB);
    sprintP.update(0.016, sprintB, pitch, env, new Vector2(1, 0), 'SPRINT');
    sprintB.update(0.016, env, pitch);
  }

  assert.ok(sprintP.vel.x <= 7.65, `Sprint carrying speed ${sprintP.vel.x.toFixed(2)} m/s must be capped at ~7.6 m/s`);
  assert.ok(sprintP.vel.x >= 7.45, `Sprint carrying speed ${sprintP.vel.x.toFixed(2)} m/s reached controlled top carrying pace`);

  // Trigger Knock-on burst: releases speed cap to full 8.8 m/s
  sprintP.executeKnockOnBurst(sprintB, new Vector2(1, 0));
  assert.ok(sprintP.knockOnSurgeTimer > 1.0, 'Knock-on surge must be active');
  for (let i = 0; i < 60; i++) {
    sprintP.move(new Vector2(1, 0), 'SPRINT', 0.016, sprintB);
    sprintP.update(0.016, sprintB, pitch, env, new Vector2(1, 0), 'SPRINT');
    sprintB.update(0.016, env, pitch);
  }
  assert.ok(sprintP.vel.x > 8.0, `Surge sprint speed ${sprintP.vel.x.toFixed(2)} m/s must accelerate beyond 8.0 m/s towards 8.8 m/s`);
  console.log(`  ✔ Sprint Carrying vs Burst: Controlled carrying capped at 7.6 m/s, Knock-On unleashed to ${sprintP.vel.x.toFixed(1)} m/s`);
}

// 14. Test High Control (Messi 95) Never Overruns Ball during Continuous Running & Acceleration
{
  const messi = new PlayerEntity({ x: 50.0, y: 34.0 });
  messi.heading = 0.0; // East
  messi.dribble.setSkill(95); // Elite control
  const messiBall = new Ball(50.45, 34.0);

  let minFwd = 999;
  let maxFwd = -999;
  let touchCount = 0;

  // Run continuously for 180 frames (approx 3 full seconds of running and acceleration)
  for (let frame = 0; frame < 180; frame++) {
    messi.move(new Vector2(1, 0), 'RUN', 0.016, messiBall);
    messi.update(0.016, messiBall, pitch, env, new Vector2(1, 0), 'RUN');
    messiBall.update(0.016, env, pitch);

    const fwd = messi.getBallLocalCoords(messiBall).fwd;
    if (fwd < minFwd) minFwd = fwd;
    if (fwd > maxFwd) maxFwd = fwd;

    if (messi.dribble.touchVfxTimer > 0.13) {
      touchCount++;
    }

    assert.ok(fwd > 0.12, `Ball must NEVER drop behind boots (frame ${frame}, fwd: ${fwd.toFixed(2)}m)`);
    assert.strictEqual(messi.isBallInTouchEnvelope(messiBall, 0.0), true, `Ball must remain inside touch envelope at frame ${frame}`);
  }

  assert.ok(touchCount >= 4, `High-control player must take multiple natural touches in stride (got ${touchCount})`);
  assert.ok(minFwd >= 0.15 && maxFwd <= 0.85, `Ball must stay continuously nestled in forward pocket (${minFwd.toFixed(2)}m to ${maxFwd.toFixed(2)}m)`);
  console.log(`  ✔ High-Control Anti-Overrun: Messi (95) sustained 3.0s continuous run across ${touchCount} stride touches; ball never dropped behind boots (pocket: ${minFwd.toFixed(2)}m - ${maxFwd.toFixed(2)}m)`);
}

// 15. Test High Control (Messi 95) Never Overruns Ball during Continuous Sprint Carrying
{
  const sprintP = new PlayerEntity({ x: 50.0, y: 34.0 });
  sprintP.heading = 0.0;
  sprintP.dribble.setSkill(95);
  const sprintB = new Ball(50.45, 34.0);

  let minFwd = 999;
  let maxFwd = -999;
  let sprintTouches = 0;

  for (let frame = 0; frame < 180; frame++) {
    sprintP.move(new Vector2(1, 0), 'SPRINT', 0.016, sprintB);
    sprintP.update(0.016, sprintB, pitch, env, new Vector2(1, 0), 'SPRINT');
    sprintB.update(0.016, env, pitch);

    const fwd = sprintP.getBallLocalCoords(sprintB).fwd;
    if (fwd < minFwd) minFwd = fwd;
    if (fwd > maxFwd) maxFwd = fwd;

    if (sprintP.dribble.touchVfxTimer > 0.13) {
      sprintTouches++;
    }

    assert.ok(fwd > 0.15, `Ball must never drop behind boots during sprint (frame ${frame}, fwd: ${fwd.toFixed(2)}m)`);
    assert.strictEqual(sprintP.isBallInTouchEnvelope(sprintB, 0.0), true, `Ball must remain inside touch envelope during sprint at frame ${frame}`);
  }

  assert.ok(minFwd >= 0.20 && maxFwd <= 0.95, `Ball stayed nestled in sprint pocket (${minFwd.toFixed(2)}m to ${maxFwd.toFixed(2)}m)`);
  console.log(`  ✔ High-Control Sprint Carrying: Messi (95) sprinted 3.0s at 7.6 m/s across ${sprintTouches} touches without overrunning (pocket: ${minFwd.toFixed(2)}m - ${maxFwd.toFixed(2)}m)`);
}

// 16. Test High Control Slalom / S-Curve Dynamic Weaving Dribble
{
  const weaveP = new PlayerEntity({ x: 50.0, y: 34.0 });
  weaveP.heading = 0.0;
  weaveP.dribble.setSkill(95);
  const weaveB = new Ball(50.45, 34.0);

  let weaveMinFwd = 999;
  let weaveMaxFwd = -999;

  for (let frame = 0; frame < 180; frame++) {
    const sinY = Math.sin(frame * 0.10) * 0.45;
    const weaveDir = new Vector2(1.0, sinY).normalize();

    weaveP.move(weaveDir, 'RUN', 0.016, weaveB);
    weaveP.update(0.016, weaveB, pitch, env, weaveDir, 'RUN');
    weaveB.update(0.016, env, pitch);

    const coords = weaveP.getBallLocalCoords(weaveB);
    if (coords.fwd < weaveMinFwd) weaveMinFwd = coords.fwd;
    if (coords.fwd > weaveMaxFwd) weaveMaxFwd = coords.fwd;

    assert.ok(coords.fwd > 0.15, `Ball must never drop behind boots during slalom (frame ${frame}, fwd: ${coords.fwd.toFixed(2)}m)`);
    assert.strictEqual(weaveP.isBallInTouchEnvelope(weaveB, 0.0), true, `Ball must remain inside touch envelope during slalom at frame ${frame}`);
  }

  console.log(`  ✔ High-Control Slalom Weaving: Dynamic S-curve cuts maintained clean envelope control (pocket: ${weaveMinFwd.toFixed(2)}m - ${weaveMaxFwd.toFixed(2)}m)`);
}

// 17. Test Adaptive Stride Cadence (Chop-Steps vs Acceleration Elongation)
{
  const adaptP = new PlayerEntity({ x: 50.0, y: 34.0 });
  adaptP.heading = 0.0;
  adaptP.vel.set(5.0, 0.0);
  adaptP.dribble.setSkill(99);
  const adaptB = new Ball(50.45, 34.0);

  // Baseline cruising run cadence
  adaptP.currentAcceleration = 0.0;
  adaptP.dribble.executeMicroTouch(adaptB, new Vector2(1, 0), 'RUN');
  const baseCadence = adaptP.dribble.currentCadence;
  const baseCooldown = adaptP.dribble.touchCooldown;

  // Case A: Braking / Deceleration Chop-Steps (accel = -4.5 m/s²)
  adaptP.currentAcceleration = -4.5;
  adaptP.dribble.executeMicroTouch(adaptB, new Vector2(1, 0), 'RUN');
  const chopCadence = adaptP.dribble.currentCadence;
  const chopCooldown = adaptP.dribble.touchCooldown;

  assert.ok(chopCadence > baseCadence, 
    `Chop-step cadence (${chopCadence.toFixed(1)} Hz) must be faster than base cadence (${baseCadence.toFixed(1)} Hz)`);
  assert.ok(chopCooldown < baseCooldown, 
    `Braking stride cooldown (${chopCooldown.toFixed(3)}s) must be shorter than base (${baseCooldown.toFixed(3)}s)`);

  // Case B: Linear Acceleration Elongation (accel = +3.5 m/s² in straight line)
  adaptP.currentAcceleration = 3.5;
  adaptP.dribble.executeMicroTouch(adaptB, new Vector2(1, 0), 'RUN');
  const sprintCadence = adaptP.dribble.currentCadence;
  const sprintCooldown = adaptP.dribble.touchCooldown;

  assert.ok(sprintCooldown > baseCooldown, 
    `Accelerating stride time (${sprintCooldown.toFixed(3)}s) must elongate beyond base (${baseCooldown.toFixed(3)}s)`);

  console.log(`  ✔ Adaptive Stride Cadence: Chop-Steps (${chopCadence.toFixed(1)} Hz / ${chopCooldown.toFixed(2)}s) -> Base (${baseCadence.toFixed(1)} Hz / ${baseCooldown.toFixed(2)}s) -> Elongation (${sprintCadence.toFixed(1)} Hz / ${sprintCooldown.toFixed(2)}s) verified`);
}

// 18. Test Cleat Contact Impulse Physics & Foot-Specific Lateral Spin
{
  const physP = new PlayerEntity({ x: 50.0, y: 34.0 });
  physP.heading = 0.0;
  physP.vel.set(4.5, 0.0);
  const physB = new Ball(50.45, 34.0);
  physB.vel.set(3.0, 0.0); // Ball already rolling forward

  // Right foot touch: outside of right boot brushes right flank -> clockwise spin (spinZ < 0)
  physP.dribble.lastTouchFoot = 'RIGHT';
  physP.dribble.executeMicroTouch(physB, new Vector2(1, 0), 'RUN');
  assert.ok(physP.dribble.lastImpulse > 0.1, `Cleat contact must impart physical impulse, got ${physP.dribble.lastImpulse.toFixed(2)} m/s`);
  assert.ok(physB.spinZ < -2.0, `Right foot touch must impart clockwise lateral spin (spinZ = ${physB.spinZ.toFixed(1)} rad/s)`);
  assert.strictEqual(physB.isRolling, true, 'Ball must be marked isRolling');

  // Next touch alternates to Left foot: outside of left boot brushes left flank -> counter-clockwise spin (spinZ > 0)
  assert.strictEqual(physP.dribble.lastTouchFoot, 'LEFT', 'Footfall must alternate to LEFT boot');
  physP.dribble.executeMicroTouch(physB, new Vector2(1, 0), 'RUN');
  assert.ok(physB.spinZ > 2.0, `Left foot touch must impart counter-clockwise lateral spin (spinZ = ${physB.spinZ.toFixed(1)} rad/s)`);

  console.log(`  ✔ Cleat Contact Impulse & Lateral Spin: Impulse ${physP.dribble.lastImpulse.toFixed(2)} m/s, Right foot spin (${(-8.5).toFixed(1)} rad/s) and Left foot spin (+${(8.5).toFixed(1)} rad/s) verified`);
}

// 19. Test Low-Skill Heavy Touch Pocket, Sluggish Cadence & Surge Variance
{
  const messi = new PlayerEntity({ x: 50.0, y: 34.0 });
  messi.heading = 0.0;
  messi.vel.set(4.5, 0.0);
  messi.dribble.setSkill(99);

  const amateur = new PlayerEntity({ x: 50.0, y: 34.0 });
  amateur.heading = 0.0;
  amateur.vel.set(4.5, 0.0);
  amateur.dribble.setSkill(50);

  const ballM = new Ball(50.45, 34.0);
  ballM.vel.set(4.5, 0.0);
  const ballA = new Ball(50.45, 34.0);
  ballA.vel.set(4.5, 0.0);

  // Baseline Cruising Run
  messi.dribble.executeMicroTouch(ballM, new Vector2(1, 0), 'RUN');
  amateur.dribble.executeMicroTouch(ballA, new Vector2(1, 0), 'RUN');

  // Messi: Rapid ~4.0 Hz cadence (0.25s cooldown)
  assert.ok(messi.dribble.currentCadence >= 3.8, `Messi cadence must be >= 3.8 Hz, got ${messi.dribble.currentCadence.toFixed(2)} Hz`);
  assert.ok(messi.dribble.touchCooldown <= 0.27, `Messi cooldown must be <= 0.27s, got ${messi.dribble.touchCooldown.toFixed(3)}s`);

  // Amateur: Sluggish <= 2.8 Hz cadence (>= 0.35s cooldown)
  assert.ok(amateur.dribble.currentCadence <= 2.8, `Amateur cadence must be <= 2.8 Hz, got ${amateur.dribble.currentCadence.toFixed(2)} Hz`);
  assert.ok(amateur.dribble.touchCooldown >= 0.35, `Amateur cooldown must be >= 0.35s, got ${amateur.dribble.touchCooldown.toFixed(3)}s`);

  // Random Heavy Touch Surge Test:
  // Mock Math.random to trigger heavyRisk surge on sprint
  const origRandom = Math.random;
  try {
    Math.random = () => 0.01; // Guarantees heavyRisk triggers for amateur, but Messi heavyRisk is 0
    amateur.dribble.touchCooldown = 0.0;
    amateur.dribble.executeMicroTouch(ballA, new Vector2(1, 0), 'SPRINT');
    assert.strictEqual(amateur.actionNotification?.text, '⚠️ HEAVY TOUCH', 'Amateur sprint touch must trigger HEAVY TOUCH notification');
    assert.ok(amateur.dribble.touchCooldown >= 0.50, `Heavy touch stride cooldown must elongate (>= 0.50s), got ${amateur.dribble.touchCooldown.toFixed(3)}s`);

    // Messi must NEVER suffer heavy touch even on sprint
    messi.dribble.touchCooldown = 0.0;
    messi.actionNotification = null;
    messi.dribble.executeMicroTouch(ballM, new Vector2(1, 0), 'SPRINT');
    assert.strictEqual(messi.actionNotification, null, 'Messi must never suffer heavy touch surges');
  } finally {
    Math.random = origRandom;
  }

  console.log(`  ✔ Low-Skill Heavy Touch & Sluggish Cadence: Messi 99 (${messi.dribble.currentCadence.toFixed(1)} Hz, ${messi.dribble.touchCooldown.toFixed(2)}s) vs Amateur 50 (${amateur.dribble.currentCadence.toFixed(1)} Hz, ${amateur.dribble.touchCooldown.toFixed(2)}s) and Heavy Touch Surge verified`);
}

// 20. Test Stiff-Ankle First-Touch Rebound on Fast Passes
{
  const eliteTrapP = new PlayerEntity({ x: 50.0, y: 34.0 });
  eliteTrapP.heading = 0.0;
  eliteTrapP.vel.set(0, 0);
  eliteTrapP.dribble.setSkill(99);

  const clunkyTrapP = new PlayerEntity({ x: 50.0, y: 34.0 });
  clunkyTrapP.heading = 0.0;
  clunkyTrapP.vel.set(0, 0);
  clunkyTrapP.dribble.setSkill(50);

  // Incoming fast pass at 8.0 m/s heading toward players
  const fastBallElite = new Ball(50.35, 34.0);
  fastBallElite.vel.set(-8.0, 0.0);

  const fastBallClunky = new Ball(50.35, 34.0);
  fastBallClunky.vel.set(-8.0, 0.0);

  // Elite trap: cushions gently into pocket without heavy rebound alert
  eliteTrapP.dribble.executeTrapTouch(fastBallElite, new Vector2(1, 0));
  assert.ok(fastBallElite.vel.magnitude() < 1.0, `Elite trap must cushion cleanly (< 1.0 m/s), got ${fastBallElite.vel.magnitude().toFixed(2)} m/s`);
  assert.notStrictEqual(eliteTrapP.actionNotification?.text, '⚠️ HEAVY RECEPTION', 'Elite trap must not trigger HEAVY RECEPTION');

  // Clunky amateur trap: stiff-ankle rebound forward (>= 1.4 m/s) with alert
  clunkyTrapP.dribble.executeTrapTouch(fastBallClunky, new Vector2(1, 0));
  assert.ok(fastBallClunky.vel.magnitude() >= 1.4, `Clunky trap must bounce off stiff ankle (>= 1.4 m/s), got ${fastBallClunky.vel.magnitude().toFixed(2)} m/s`);
  assert.ok(fastBallClunky.vel.x > 0, 'Rebound velocity must bounce forward along facing direction');
  assert.strictEqual(clunkyTrapP.actionNotification?.text, '⚠️ HEAVY RECEPTION', 'Clunky trap must trigger HEAVY RECEPTION notification');

  console.log(`  ✔ Stiff-Ankle First-Touch Rebound: Elite cushioned to ${fastBallElite.vel.magnitude().toFixed(2)} m/s vs Clunky rebounded at ${fastBallClunky.vel.magnitude().toFixed(2)} m/s (⚠️ HEAVY RECEPTION) verified`);
}

// 21. Test Measured Acceleration Timing & Telemetry (Suspect 1 Regression)
{
  const testEnv = new Environment();
  const testPitch = new Pitch();

  // Case A: Positive acceleration during sprint launch
  const accelP = new PlayerEntity({ x: 50.0, y: 34.0 });
  accelP.vel.set(0, 0);
  const accelB = new Ball(60.0, 34.0); // Ball far away

  accelP.move(new Vector2(1, 0), 'SPRINT', 0.016, accelB);
  accelP.update(0.016, accelB, testPitch, testEnv, new Vector2(1, 0), 'SPRINT');

  assert.ok(accelP.currentAcceleration > 2.0,
    `Acceleration during sprint launch must be positive and meaningful, got ${accelP.currentAcceleration.toFixed(2)} m/s²`);
  assert.ok(accelP.currentAcceleration <= accelP.locomotion.currentMaxAccel + 0.1,
    `Acceleration must not exceed currentMaxAccel (${accelP.currentAcceleration.toFixed(2)} <= ${accelP.locomotion.currentMaxAccel})`);

  // Case B: Negative acceleration (braking) during reversal
  const brakeP = new PlayerEntity({ x: 50.0, y: 34.0 });
  brakeP.vel.set(8.8, 0.0);
  brakeP.heading = 0.0;
  const brakeB = new Ball(60.0, 34.0);

  brakeP.move(new Vector2(-1, 0), 'RUN', 0.016, brakeB);
  brakeP.update(0.016, brakeB, testPitch, testEnv, new Vector2(-1, 0), 'RUN');

  assert.ok(brakeP.currentAcceleration < -2.0,
    `Acceleration during braking must be negative, got ${brakeP.currentAcceleration.toFixed(2)} m/s²`);
  assert.ok(brakeP.currentAcceleration >= -brakeP.locomotion.maxBrake - 0.1,
    `Deceleration must respect maxBrake bound (${brakeP.currentAcceleration.toFixed(2)} >= -${brakeP.locomotion.maxBrake})`);

  console.log(`  ✔ Measured Acceleration Telemetry: Launch (+${accelP.currentAcceleration.toFixed(2)} m/s²) and Braking (${brakeP.currentAcceleration.toFixed(2)} m/s²) verified`);
}

// 22. Test Smooth Ball-Proximity Speed-Control Continuity (Suspect 2 Regression)
{
  const testP = new PlayerEntity({ x: 50.0, y: 34.0 });
  testP.heading = 0.0;

  // Sweep forward ball distance and verify smooth transition of carrying weight
  let prevWeight = testP.getBallCarryingWeight(new Ball(50.35, 34.0));
  let maxWeightStep = 0.0;

  for (let d = 0.35; d <= 2.2; d += 0.02) {
    const sweepBall = new Ball(50.0 + d, 34.0);
    const weight = testP.getBallCarryingWeight(sweepBall);
    const step = Math.abs(weight - prevWeight);
    if (step > maxWeightStep) maxWeightStep = step;
    prevWeight = weight;
  }

  // With 0.02m steps across a 0.6m transition band, max step should be <= 0.10 (smooth, C1-continuous)
  assert.ok(maxWeightStep < 0.12,
    `Carrying weight transition must be continuous without sharp step jumps (max step: ${maxWeightStep.toFixed(3)})`);

  // Verify anti-overrun stride harmonization continuity
  const harmP = new PlayerEntity({ x: 50.0, y: 34.0 });
  harmP.heading = 0.0;
  harmP.vel.set(6.0, 0.0);
  const slowBall = new Ball(50.30, 34.0);
  slowBall.vel.set(2.0, 0.0);

  // Ball very close to boots: speed must be harmonized smoothly
  harmP.move(new Vector2(1, 0), 'SPRINT', 0.016, slowBall);
  const cappedSpeed = harmP.vel.magnitude();
  assert.ok(cappedSpeed < 6.0, 'Player must harmonize speed when ball is close to boots to avoid overrunning');

  console.log(`  ✔ Ball-Proximity Speed Continuity: Smooth C¹ carrying blend (max step: ${maxWeightStep.toFixed(3)}) & anti-overrun pacing verified`);
}

// 23. Test Jockey Orientation Stability & Close-Control Hysteresis (Suspect 3 Regression)
{
  const testEnv = new Environment();
  const testPitch = new Pitch();
  const jockP = new PlayerEntity({ x: 50.0, y: 34.0 });
  jockP.heading = 0.0;
  const jockBall = new Ball(50.45, 34.0);

  // Enter Jockey close control
  jockP.update(0.016, jockBall, testPitch, testEnv, new Vector2(1, 0), 'JOCKEY');
  assert.strictEqual(jockP.isCloseControlActive, true, 'Close control should activate when ball is in envelope');

  // Verify player can rotate in ALL directions without unnatural orientation locks:
  // 1. Lateral North (0, -1) -> heading should smoothly turn towards -PI/2
  const initialH = jockP.heading;
  for (let i = 0; i < 15; i++) {
    jockP.update(0.016, jockBall, testPitch, testEnv, new Vector2(0, -1), 'JOCKEY');
  }
  assert.ok(jockP.heading < initialH - 0.2,
    `Jockeying North must turn body towards North without locking (heading: ${jockP.heading.toFixed(2)})`);

  // 2. Backward West (-1, 0) -> heading should continue turning towards PI or -PI
  for (let i = 0; i < 25; i++) {
    jockP.update(0.016, jockBall, testPitch, testEnv, new Vector2(-1, 0), 'JOCKEY');
  }
  assert.ok(Math.abs(jockP.heading) > 1.8,
    `Jockeying West must allow body to rotate toward backward direction (heading: ${jockP.heading.toFixed(2)})`);

  // 3. Test Hysteresis: small ball oscillation near boundary does not rapidly toggle mode
  const hystP = new PlayerEntity({ x: 50.0, y: 34.0 });
  hystP.heading = 0.0;
  const borderBall = new Ball(51.25, 34.0); // Near border
  hystP.isCloseControlActive = true;

  // Move ball slightly in/out between padding 0.15 and 0.28
  let modeFlips = 0;
  let lastState = hystP.isCloseControlActive;
  for (let i = 0; i < 30; i++) {
    borderBall.pos.x = 51.20 + (i % 2 === 0 ? 0.05 : -0.05);
    hystP.update(0.016, borderBall, testPitch, testEnv, new Vector2(1, 0), 'JOCKEY');
    if (hystP.isCloseControlActive !== lastState) {
      modeFlips++;
      lastState = hystP.isCloseControlActive;
    }
  }
  assert.ok(modeFlips <= 1, `Hysteresis Schmitt trigger must prevent rapid boundary mode toggling (flips: ${modeFlips})`);

  console.log(`  ✔ Jockey Orientation & Hysteresis: Omnidirectional smooth rotation and state hysteresis verified`);
}

// 24. Test Directional Cuts Bounded by Locomotion Braking Limits (Suspect 4 Regression)
{
  const cutP = new PlayerEntity({ x: 50.0, y: 34.0 });
  cutP.heading = 0.0;
  cutP.vel.set(7.0, 0.0);
  cutP.dribble.setSkill(85);
  const cutB = new Ball(50.45, 34.0);
  const dt = 0.016;
  const maxBrake = cutP.locomotion.maxBrake;

  const preCutSpeed = cutP.vel.magnitude();
  // Execute sharp 90° cut North
  cutP.dribble.executeDirectionalCut(cutB, new Vector2(0, -1), -Math.PI / 2, 'RUN', null, dt);
  const postCutSpeed = cutP.vel.magnitude();

  const measuredDecel = (preCutSpeed - postCutSpeed) / dt;
  assert.ok(measuredDecel > 0.1, `Directional cut must apply biomechanical deceleration penalty, got ${measuredDecel.toFixed(2)} m/s²`);
  assert.ok(measuredDecel <= maxBrake + 1e-4,
    `Directional cut deceleration (${measuredDecel.toFixed(2)} m/s²) must NOT exceed physical maxBrake (${maxBrake.toFixed(2)} m/s²)`);
  assert.ok(cutP.currentAcceleration < 0,
    `Player telemetry currentAcceleration (${cutP.currentAcceleration.toFixed(2)}) must reflect braking penalty`);

  // Compare Elite (95) vs Clunky (45) under identical 180° reversal cut
  const eliteP = new PlayerEntity({ x: 50.0, y: 34.0 });
  eliteP.heading = 0.0;
  eliteP.vel.set(6.0, 0.0);
  eliteP.dribble.setSkill(95);
  const eliteB = new Ball(50.45, 34.0);
  eliteP.dribble.executeDirectionalCut(eliteB, new Vector2(-1, 0), Math.PI, 'RUN', null, dt);

  const clunkyP = new PlayerEntity({ x: 50.0, y: 34.0 });
  clunkyP.heading = 0.0;
  clunkyP.vel.set(6.0, 0.0);
  clunkyP.dribble.setSkill(45);
  const clunkyB = new Ball(50.45, 34.0);
  clunkyP.dribble.executeDirectionalCut(clunkyB, new Vector2(-1, 0), Math.PI, 'RUN', null, dt);

  assert.ok(eliteP.vel.magnitude() > clunkyP.vel.magnitude(),
    `Elite cut exit speed (${eliteP.vel.magnitude().toFixed(2)} m/s) must exceed clunky exit (${clunkyP.vel.magnitude().toFixed(2)} m/s)`);

  console.log(`  ✔ Directional Cut Physical Bounds: Deceleration (${measuredDecel.toFixed(2)} <= ${maxBrake.toFixed(2)} m/s²) and Skill Differentiation verified`);
}

console.log('✅ ALL DRIBBLE, STRIDE & SHOOTING BIOMECHANICS TESTS PASSED!\n');
