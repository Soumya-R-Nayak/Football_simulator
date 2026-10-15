import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';
import { Locomotion } from '../src/physics/Locomotion.js';

console.log('⚽ Running Slice 1: Physics & Locomotion Calibration Tests...');

// 1. IFAB Pitch Geometry Test
const pitch = new Pitch();
assert.strictEqual(pitch.length, 105.00, 'Pitch length must be 105.00 meters');
assert.strictEqual(pitch.width, 68.00, 'Pitch width must be 68.00 meters');
assert.strictEqual(pitch.goalWidth, 7.32, 'Goal width must be 7.32 meters (8 yards)');
assert.strictEqual(pitch.penaltyDepth, 16.50, 'Penalty depth must be 16.50 meters');
console.log('  ✔ IFAB 105m x 68m Pitch Dimensions verified');

// 2. FIFA Quality Pro Ball Roll Distance Standard Test (FIFA TM 03)
// A ball launched at v0 = 3.43 m/s down standard ramp must roll between 4.0m and 8.0m
const envDry = new Environment({ turfType: 'DRY' });
const ballDry = new Ball(50, 34);

ballDry.kick(new Vector2(1, 0), 3.43, 0, 0, null, 'TEST_ROLL');

// Simulate physics until ball comes to complete stop
const dt = 0.016;
let maxTicks = 600;
while (ballDry.vel.magnitude() > 0 && maxTicks > 0) {
  ballDry.update(dt, envDry, pitch);
  maxTicks--;
}

const rollDistDry = ballDry.distanceSinceKick;
assert.ok(rollDistDry >= 4.0 && rollDistDry <= 8.0, 
  `FIFA standard: roll distance (${rollDistDry.toFixed(2)}m) must be between 4.0m and 8.0m`);
assert.ok(Math.abs(rollDistDry - 4.80) < 0.25, 
  `Combined rolling resistance + aerodynamic drag roll distance should be ~4.80m, got ${rollDistDry.toFixed(2)}m`);
console.log(`  ✔ FIFA Standard Ball Roll: 3.43 m/s rolled exactly ${rollDistDry.toFixed(2)}m on dry turf (within 4.0 - 8.0m spec)`);

// 3. Wet Turf Skimming Test
const envWet = new Environment({ turfType: 'WET' });
const ballWet = new Ball(50, 34);
ballWet.kick(new Vector2(1, 0), 3.43, 0, 0, null, 'TEST_ROLL');

maxTicks = 600;
while (ballWet.vel.magnitude() > 0 && maxTicks > 0) {
  ballWet.update(dt, envWet, pitch);
  maxTicks--;
}

const rollDistWet = ballWet.distanceSinceKick;
assert.ok(rollDistWet > rollDistDry * 1.35, 
  `Wet grass must increase roll distance significantly due to boundary lubrication (${rollDistWet.toFixed(2)}m vs ${rollDistDry.toFixed(2)}m)`);
console.log(`  ✔ Wet Turf Skimming: Same ball rolled ${rollDistWet.toFixed(2)}m (+${Math.round((rollDistWet/rollDistDry - 1)*100)}% further)`);

// 4. Biomechanical Player Locomotion & Inertia Tests
const locomotion = new Locomotion({ maxAccel: 4.8, maxBrake: 6.8, topSpeed: 8.8 });
let vel = new Vector2(0, 0);

// Accelerate forward for 1 second
for (let i = 0; i < 60; i++) {
  vel = locomotion.updateVelocity(vel, new Vector2(1, 0), locomotion.sprintSpeed, 1/60);
}

// In 1 second, speed should reach approx 4.8 m/s (bounded by maxAccel)
assert.ok(Math.abs(vel.magnitude() - 4.8) < 0.15, 
  `In 1s from standstill, speed should be ~4.8 m/s, got ${vel.magnitude().toFixed(2)} m/s`);
console.log(`  ✔ Player Acceleration: Reached ${vel.magnitude().toFixed(2)} m/s after 1.0s (bounded by 4.8 m/s²)`);

// Brake test: decelerate from sprint
vel = new Vector2(8.8, 0);
for (let i = 0; i < 60; i++) {
  vel = locomotion.updateVelocity(vel, new Vector2(0, 0), 0, 1/60);
}
assert.ok(vel.magnitude() < 2.2, 
  `In 1s of heavy braking, speed should drop from 8.8 m/s to ~2.0 m/s, got ${vel.magnitude().toFixed(2)} m/s`);
console.log(`  ✔ Player Braking: Decelerated from 8.8 m/s down to ${vel.magnitude().toFixed(2)} m/s in 1.0s (bounded by -6.8 m/s²)`);

// Turning radius test: at full sprint (8.8 m/s), R should be ~10.75m
const turningRadius = locomotion.calculateTurningRadius(8.8);
assert.ok(Math.abs(turningRadius - 10.75) < 0.3, 
  `Turning radius at 8.8 m/s should be ~10.75m, got ${turningRadius.toFixed(2)}m`);
console.log(`  ✔ Cleat Traction Turning Radius: ${turningRadius.toFixed(2)}m at full 8.8 m/s sprint`);

// 5. Magnus Lateral Spin Curve Test
const ballSpin = new Ball(50, 34);
// Kick forward at 26 m/s with -48 rad/s spin (curves left / negative Y)
ballSpin.kick(new Vector2(1, 0), 26.0, 1.2, -48.0, null, 'CURVE_SHOT');

for (let i = 0; i < 60; i++) {
  ballSpin.update(0.016, envDry, pitch);
}

const lateralDeflection = Math.abs(ballSpin.pos.y - 34.0);
assert.ok(lateralDeflection >= 1.4 && lateralDeflection <= 2.8, 
  `Spinning ball must curve laterally by 1.4m to 2.8m over flight, got ${lateralDeflection.toFixed(2)}m`);
console.log(`  ✔ Magnus Effect: Curled laterally by ${lateralDeflection.toFixed(2)}m over flight trajectory`);

console.log('✅ ALL SLICE 1 PHYSICS & CALIBRATION TESTS PASSED CLEANLY!\n');
