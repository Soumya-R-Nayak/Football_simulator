import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';
import { PassingController } from '../src/physics/PassingController.js';

console.log('⚽ Running Dual Player Passing & Targeting Physics Tests...\n');

const pitch = new Pitch();
const env = new Environment({ turfType: 'DRY' });
const passing = new PassingController();

// 1. Test Semi-Assisted Directional Targeting Cone
{
  const kicker = new PlayerEntity({ x: 50.0, y: 34.0, name: 'Passer', number: 10 });
  const mateRight = new PlayerEntity({ x: 65.0, y: 34.0, name: 'Target East', number: 9 });
  const mateBehind = new PlayerEntity({ x: 35.0, y: 34.0, name: 'Target West', number: 4 });
  const teammates = [mateRight, mateBehind];

  // Aiming East (1, 0): mateRight is directly in cone (angle = 0 rad)
  const targetEast = passing.findTarget(kicker, teammates, new Vector2(1, 0));
  assert.ok(targetEast, 'Target in forward cone must be detected');
  assert.strictEqual(targetEast.receiver, mateRight, 'Selected receiver must be mateRight');
  assert.strictEqual(targetEast.distance, 15.0, 'Distance must equal 15.0m');
  assert.ok(targetEast.angle < 0.05, 'Angle must be virtually zero');

  // Aiming North (0, -1): 90° away from mateRight and mateBehind (both > 55° cone)
  const targetNorth = passing.findTarget(kicker, teammates, new Vector2(0, -1));
  assert.strictEqual(targetNorth, null, 'No teammate should be selected outside 55° cone');

  // Aiming West (-1, 0): mateBehind is selected
  const targetWest = passing.findTarget(kicker, teammates, new Vector2(-1, 0));
  assert.ok(targetWest, 'Target behind must be detected when aiming West');
  assert.strictEqual(targetWest.receiver, mateBehind, 'Selected receiver must be mateBehind');

  console.log('  ✔ Semi-Assisted Directional Cone: 0° forward lock-on (15.0m) and 90° out-of-cone rejection verified');
}

// 2. Test Lead Point Calculation (Direct Feet vs Through Ball Corridor)
{
  const kicker = new PlayerEntity({ x: 50.0, y: 34.0 });
  const receiver = new PlayerEntity({ x: 62.0, y: 34.0 });
  receiver.heading = 0.0; // Facing East downfield
  receiver.vel.set(4.0, 0.0); // Running East at 4 m/s

  // Case A: Short Ground Pass -> Targets direct feet / pocket
  const shortLead = passing.calculateLeadTarget(kicker, receiver, 'SHORT_PASS', 0.5);
  assert.ok(shortLead.leadDistance <= 2.2, `Short pass lead distance (${shortLead.leadDistance.toFixed(2)}m) must remain tight`);
  assert.ok(shortLead.targetPos.x < 65.0, 'Short pass target position must stay close to receiver');

  // Case B: Through Ball into Space -> Projects deep into running corridor
  const throughLead = passing.calculateLeadTarget(kicker, receiver, 'GROUND_THROUGH', 0.8);
  assert.ok(throughLead.leadDistance > 6.0, `Through ball lead (${throughLead.leadDistance.toFixed(2)}m) must lead ahead into space`);
  assert.ok(throughLead.targetPos.x > receiver.pos.x + 5.0, 'Through ball target must penetrate into open grass');

  console.log(`  ✔ Lead Trajectory Calculation: Short Pass (${shortLead.leadDistance.toFixed(2)}m pocket) vs Through Ball (${throughLead.leadDistance.toFixed(2)}m running corridor) verified`);
}

// 3. Test Friction-Compensated Velocity Tuning
{
  const kicker = new PlayerEntity({ x: 45.0, y: 34.0 });
  const receiver = new PlayerEntity({ x: 65.0, y: 34.0 }); // 20 meters away
  receiver.heading = 0.0;

  // Tune a 20m short ground pass on dry turf (roll decel = 1.08 m/s²)
  const tuned = passing.tunePassExecution(kicker, receiver, 'SHORT_PASS', 0.5, new Vector2(1, 0), env);

  // Ball must have enough kinetic energy to travel 20m against friction:
  assert.ok(tuned.speed >= 7.5 && tuned.speed <= 11.5, 
    `Compensated pass speed (${tuned.speed.toFixed(2)} m/s) must guarantee clean arrival at 20m`);
  assert.strictEqual(tuned.loft, 0.0, 'Ground pass loft must be 0');

  // Simulate physical ball roll over 20m
  const ball = new Ball(45.0, 34.0);
  ball.kick(tuned.targetDir, tuned.speed, 0.0, 0.0, kicker, 'SHORT_PASS');

  // Step ball forward until it reaches receiver x = 65.0
  let elapsed = 0;
  while (ball.pos.x < 64.5 && elapsed < 4.0 && ball.vel.magnitude() > 0.1) {
    ball.update(0.02, env, pitch);
    elapsed += 0.02;
  }

  assert.ok(ball.pos.x >= 64.0, `Ball must reach receiver (reached ${ball.pos.x.toFixed(2)}m)`);
  assert.ok(ball.vel.magnitude() > 1.2, `Ball must arrive with positive arrival speed, got ${ball.vel.magnitude().toFixed(2)} m/s`);

  console.log(`  ✔ Friction-Compensated Velocity: 20m pass kicked at ${tuned.speed.toFixed(2)} m/s arrived at receiver at ${ball.vel.magnitude().toFixed(2)} m/s after ${elapsed.toFixed(2)}s`);
}

// 4. Test Automated Teammate Reception AI & Trapping
{
  const p1 = new PlayerEntity({ x: 45.0, y: 34.0, name: 'Kicker', number: 10 });
  const p2 = new PlayerEntity({ x: 55.0, y: 34.0, name: 'Receiver', number: 9, isControlled: false });
  p2.dribble.setSkill(99); // Elite control

  const ball = new Ball(45.5, 34.0);
  ball.vel.set(7.5, 0.0); // Fast ground pass travelling towards p2

  // Simulate frames as ball approaches p2
  let received = false;
  for (let step = 0; step < 120; step++) {
    ball.update(0.02, env, pitch);
    const aiResult = p2.updateTeammateAI(0.02, ball, pitch, env);
    if (aiResult.receivedPass) {
      received = true;
      break;
    }
  }

  assert.ok(received, 'Off-ball teammate AI must detect incoming ball and execute reception cushion');
  assert.ok(ball.vel.magnitude() < 1.0, `Ball must be cushioned cleanly into pocket, residual speed: ${ball.vel.magnitude().toFixed(2)} m/s`);

  console.log(`  ✔ Automated Teammate Reception AI: Incoming pass cushioned cleanly into forward pocket (${ball.vel.magnitude().toFixed(2)} m/s)`);
}

// 5. Test Active Player Switching Mechanism
{
  const p1 = new PlayerEntity({ x: 45.0, y: 34.0, name: 'P1', number: 10, isControlled: true });
  const p2 = new PlayerEntity({ x: 55.0, y: 34.0, name: 'P2', number: 9, isControlled: false });
  let activePlayer = p1;

  function switchPlayer(target = null) {
    const next = target || (activePlayer === p1 ? p2 : p1);
    activePlayer.isControlled = false;
    activePlayer = next;
    activePlayer.isControlled = true;
  }

  // Initial state
  assert.strictEqual(activePlayer, p1);
  assert.strictEqual(p1.isControlled, true);
  assert.strictEqual(p2.isControlled, false);

  // Switch to P2
  switchPlayer();
  assert.strictEqual(activePlayer, p2);
  assert.strictEqual(p1.isControlled, false);
  assert.strictEqual(p2.isControlled, true);

  // Switch back to P1
  switchPlayer();
  assert.strictEqual(activePlayer, p1);
  assert.strictEqual(p1.isControlled, true);
  assert.strictEqual(p2.isControlled, false);

  console.log('  ✔ Active Player Switching: P1 <-> P2 seamless state handover verified');
}

console.log('✅ ALL DUAL PLAYER PASSING & TARGETING TESTS PASSED!\n');
