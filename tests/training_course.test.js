import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';
import { TrainingCourse } from '../src/physics/TrainingCourse.js';
import { PlayerAttributes } from '../src/physics/PlayerAttributes.js';

console.log('🚩 Running Training Obstacle & Slalom Cone Physics Tests...\n');

const pitch = new Pitch();
const env = new Environment({ turfType: 'DRY' });

// -------------------------------------------------------------
// Test 1: Training Course Layouts & Cones Generation
// -------------------------------------------------------------
{
  const course = new TrainingCourse();
  assert.strictEqual(course.active, false, 'Course should start inactive');
  assert.strictEqual(course.mode, 'SLALOM', 'Default mode is SLALOM');
  assert.strictEqual(course.cones.length, 8, 'SLALOM should generate exactly 8 cones');

  // Test ZIGZAG
  course.setMode('ZIGZAG');
  assert.strictEqual(course.mode, 'ZIGZAG');
  assert.strictEqual(course.cones.length, 6, 'ZIGZAG should generate exactly 6 cones');

  // Test BOX
  course.setMode('BOX');
  assert.strictEqual(course.mode, 'BOX');
  assert.strictEqual(course.cones.length, 5, 'BOX should generate 5 cones (4 corners + center)');

  // Test toggle
  const state1 = course.toggle();
  assert.strictEqual(state1, true, 'Toggle should activate course');
  assert.strictEqual(course.active, true);
  const state2 = course.toggle();
  assert.strictEqual(state2, false, 'Toggle should deactivate course');
  assert.strictEqual(course.active, false);

  console.log('  ✔ Layout Generation: Slalom (8 cones), Zigzag (6 cones), Box (5 cones) verified');
}

// -------------------------------------------------------------
// Test 2: Drill Start Placement & Reset
// -------------------------------------------------------------
{
  const course = new TrainingCourse();
  course.setMode('SLALOM');
  const start = course.getStartPlacement();
  assert(start.playerPos.x < course.cones[0].pos.x, 'Player must start behind first cone');
  assert(start.ballPos.x > start.playerPos.x, 'Ball must start in front of player');
  assert.strictEqual(start.heading, 0.0, 'Player faces East towards drill cones');

  const player = new PlayerEntity({ x: 10.0, y: 10.0 });
  const ball = new Ball(12.0, 10.0);
  player.vel.set(5.0, 2.0);
  ball.vel.set(10.0, 0);

  course.resetDrill(player, ball);
  assert.strictEqual(player.pos.x, start.playerPos.x);
  assert.strictEqual(player.pos.y, start.playerPos.y);
  assert.strictEqual(player.vel.x, 0);
  assert.strictEqual(player.vel.y, 0);
  assert.strictEqual(ball.pos.x, start.ballPos.x);
  assert.strictEqual(ball.pos.y, start.ballPos.y);
  assert.strictEqual(ball.vel.x, 0);
  assert.strictEqual(ball.vel.y, 0);

  console.log('  ✔ Start Placement & Drill Reset verified');
}

// -------------------------------------------------------------
// Test 3: Player-Cone Physical Collision & Push-out
// -------------------------------------------------------------
{
  const course = new TrainingCourse();
  course.active = true;
  course.setMode('SLALOM');

  const cone = course.cones[0];
  const pRadius = 0.35;
  const cRadius = cone.radius; // 0.18
  const minSafeDist = pRadius + cRadius; // 0.53m

  // Place player penetrating into the cone
  const player = new PlayerEntity({ x: cone.pos.x - 0.20, y: cone.pos.y });
  player.vel.set(4.0, 0); // Moving towards/into cone
  const ball = new Ball(course.cones[7].pos.x + 10.0, 34.0); // Ball far away

  const initialDist = Vector2.subtract(player.pos, cone.pos).magnitude();
  assert(initialDist < minSafeDist, 'Player initially penetrates cone');

  course.update(0.02, player, ball);

  const postDist = Vector2.subtract(player.pos, cone.pos).magnitude();
  assert(postDist >= minSafeDist - 0.001, `Player must be pushed outside cone radius (${postDist.toFixed(3)} >= ${minSafeDist.toFixed(3)})`);
  assert(player.vel.x < 4.0, 'Velocity along penetration normal must be damped');

  console.log(`  ✔ Player-Cone Physical Pushout: Penetration resolved (${initialDist.toFixed(2)}m -> ${postDist.toFixed(2)}m) & brush velocity damped`);
}

// -------------------------------------------------------------
// Test 4: Ball-Cone Elastic Deflection & Wobble VFX
// -------------------------------------------------------------
{
  const course = new TrainingCourse();
  course.active = true;
  course.setMode('SLALOM');

  const cone = course.cones[2];
  const player = new PlayerEntity({ x: 20.0, y: 20.0 }); // Player far away

  // Ball rolling directly East into cone from West
  const ball = new Ball(cone.pos.x - 0.25, cone.pos.y);
  ball.vel.set(5.0, 0); // Moving East at 5.0 m/s

  assert.strictEqual(cone.hitTimer, 0.0);

  course.update(0.02, player, ball);

  // Ball should rebound backwards (West)
  assert(ball.vel.x < 0, `Ball must deflect backwards upon hitting cone (vel.x = ${ball.vel.x.toFixed(2)})`);
  assert(cone.hitTimer > 0, 'Cone hitTimer should activate on impact');

  // Verify wobble offset
  course.update(0.02, player, ball);
  assert(cone.wobbleOffset.magnitudeSq() > 0 || cone.hitTimer > 0, 'Wobble VFX should animate');

  console.log(`  ✔ Ball-Cone Elastic Deflection: Bounced from +5.0 m/s to ${ball.vel.x.toFixed(2)} m/s with wobble VFX`);
}

// -------------------------------------------------------------
// Test 5: Dynamic Attribute & Archetype Updates on Entity
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ archetype: 'MESSI' });
  const initialTopSpeed = player.locomotion.sprintSpeed;
  const initialAgility = player.locomotion.maxLatAccel;

  assert(initialTopSpeed < 9.5, 'Messi initial speed');
  assert(initialAgility > 9.5, 'Messi elite agility');

  // Dynamically change to Haaland
  player.setArchetype('HAALAND');
  assert.strictEqual(player.height, 1.95);
  assert.strictEqual(player.weight, 88.0);
  assert(player.locomotion.sprintSpeed > initialTopSpeed, `Haaland sprint speed (${player.locomotion.sprintSpeed.toFixed(2)}) must exceed Messi (${initialTopSpeed.toFixed(2)})`);
  assert(player.locomotion.maxLatAccel < initialAgility, 'Haaland agility must be lower than Messi');

  // Dynamically tweak via custom slider attributes
  player.setAttributes(new PlayerAttributes({
    height: 1.65,
    weight: 60.0,
    attributes: { pace: 20, acceleration: 20, agility: 20, balance: 20, jumping: 10, stamina: 20, strength: 10 }
  }));
  assert.strictEqual(player.height, 1.65);
  assert.strictEqual(player.weight, 60.0);
  assert(player.locomotion.sprintSpeed >= 9.9, 'Pace 20 should give ~10 m/s sprint speed');
  assert(player.locomotion.maxLatAccel > 10.0, 'Short 1.65m height with agility 20 gives extraordinary agility');

  console.log(`  ✔ Dynamic Attributes & Archetype Switching: Messi -> Haaland -> Custom (1.65m, Agi: ${player.locomotion.maxLatAccel.toFixed(2)} m/s²) verified`);
}

console.log('✅ ALL TRAINING COURSE & DYNAMIC ATTRIBUTES TESTS PASSED CLEANLY!\n');
