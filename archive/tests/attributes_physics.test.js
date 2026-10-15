import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';
import { PlayerAttributes } from '../src/physics/PlayerAttributes.js';

console.log('🏃 Running FM24 Physical Attributes & Biomechanical Profile Tests...\n');

const pitch = new Pitch();
const env = new Environment({ turfType: 'DRY' });

// -------------------------------------------------------------
// Test 1: FM24 1-20 Scale Attribute Conversions to SI Metrics
// -------------------------------------------------------------
{
  // Test lower bound (Rating 1)
  const lowAttrs = new PlayerAttributes({
    height: 1.80,
    weight: 75.0,
    attributes: { pace: 1, acceleration: 1, agility: 1, balance: 1, jumping: 1, stamina: 1, strength: 1 }
  });
  assert(lowAttrs.effectiveSprintSpeed >= 5.5 && lowAttrs.effectiveSprintSpeed <= 5.7, 
    `Pace 1 sprint speed (${lowAttrs.effectiveSprintSpeed.toFixed(2)} m/s) should be ~5.6 m/s`);
  assert(lowAttrs.maxAcceleration >= 2.5 && lowAttrs.maxAcceleration <= 2.7, 
    `Accel 1 (${lowAttrs.maxAcceleration.toFixed(2)} m/s²) should be ~2.6 m/s²`);
  assert(lowAttrs.verticalLeap >= 0.22 && lowAttrs.verticalLeap <= 0.25, 
    `Jumping 1 leap (${lowAttrs.verticalLeap.toFixed(2)}m) should be ~0.23m`);
  assert(lowAttrs.staminaDrainRate > 13.0, 'Low stamina must drain rapidly (~13.2%/s)');

  // Test upper bound (Rating 20)
  const maxAttrs = new PlayerAttributes({
    height: 1.80,
    weight: 75.0,
    attributes: { pace: 20, acceleration: 20, agility: 20, balance: 20, jumping: 20, stamina: 20, strength: 20 }
  });
  assert(maxAttrs.effectiveSprintSpeed >= 9.9 && maxAttrs.effectiveSprintSpeed <= 10.1, 
    `Pace 20 sprint speed (${maxAttrs.effectiveSprintSpeed.toFixed(2)} m/s) should be 10.0 m/s (36 km/h)`);
  assert(maxAttrs.maxAcceleration >= 6.5 && maxAttrs.maxAcceleration <= 6.7, 
    `Accel 20 (${maxAttrs.maxAcceleration.toFixed(2)} m/s²) should be ~6.6 m/s²`);
  assert(maxAttrs.verticalLeap >= 0.88 && maxAttrs.verticalLeap <= 0.92, 
    `Jumping 20 leap (${maxAttrs.verticalLeap.toFixed(2)}m) should reach 0.90m`);
  assert(maxAttrs.staminaDrainRate <= 7.1, 'Elite stamina must conserve sprint energy (~7.0%/s)');

  console.log('  ✔ FM24 1-20 Scale Conversions: Pace (5.63 -> 10.0 m/s), Accel (2.61 -> 6.60 m/s²), Jumping (0.24 -> 0.90m) verified');
}

// -------------------------------------------------------------
// Test 2: Morphological Height Modulation (Agility & Aerial Reach)
// -------------------------------------------------------------
{
  const shortPlayer = new PlayerAttributes({ height: 1.70, weight: 70.0, attributes: { agility: 15, jumping: 10 } });
  const tallPlayer = new PlayerAttributes({ height: 1.95, weight: 88.0, attributes: { agility: 15, jumping: 10 } });

  // 1. Shorter player gains Agility multiplier due to lower center of mass
  assert(shortPlayer.maxLatAcceleration > tallPlayer.maxLatAcceleration, 
    'Shorter player must have higher lateral centripetal acceleration (higher agility)');
  assert(shortPlayer.pivotAngularVelocity > tallPlayer.pivotAngularVelocity,
    'Shorter player must pivot hips faster during plant-and-cut');

  // 2. Taller player dominates Aerial Reach
  assert(tallPlayer.aerialReach > shortPlayer.aerialReach + 0.20,
    `Tall player reach (${tallPlayer.aerialReach.toFixed(2)}m) must exceed short player (${shortPlayer.aerialReach.toFixed(2)}m) by > 20cm`);

  // 3. Taller player has larger foot reach envelope
  assert(tallPlayer.footReachForward > shortPlayer.footReachForward,
    'Taller player has longer legs and larger foot reach envelope');

  console.log(`  ✔ Height Modulation: 1.70m Agility bonus (${shortPlayer.maxLatAcceleration.toFixed(2)} vs ${tallPlayer.maxLatAcceleration.toFixed(2)} m/s²) & 1.95m Aerial Reach (${tallPlayer.aerialReach.toFixed(2)}m vs ${shortPlayer.aerialReach.toFixed(2)}m) verified`);
}

// -------------------------------------------------------------
// Test 3: Morphological Weight Modulation (Shielding Force & Power-to-Weight)
// -------------------------------------------------------------
{
  const lightPlayer = new PlayerAttributes({ height: 1.75, weight: 64.0, attributes: { strength: 14, acceleration: 16 } });
  const heavyPlayer = new PlayerAttributes({ height: 1.75, weight: 90.0, attributes: { strength: 14, acceleration: 16 } });

  // 1. Heavier player generates significantly greater shielding force
  assert(heavyPlayer.shieldingForce > lightPlayer.shieldingForce * 1.20,
    `Heavy player shielding force (${heavyPlayer.shieldingForce.toFixed(0)}N) must exceed light player (${lightPlayer.shieldingForce.toFixed(0)}N)`);

  // 2. Light player has higher power-to-weight acceleration
  assert(lightPlayer.maxAcceleration > heavyPlayer.maxAcceleration,
    `Light player must accelerate faster (${lightPlayer.maxAcceleration.toFixed(2)} vs ${heavyPlayer.maxAcceleration.toFixed(2)} m/s²) given equal strength`);

  console.log(`  ✔ Weight Modulation: 90kg Shielding (${heavyPlayer.shieldingForce.toFixed(0)}N vs ${lightPlayer.shieldingForce.toFixed(0)}N) & 64kg Burst Acceleration (${lightPlayer.maxAcceleration.toFixed(2)} vs ${heavyPlayer.maxAcceleration.toFixed(2)} m/s²) verified`);
}

// -------------------------------------------------------------
// Test 4: Archetype Profiles: Messi (#10) vs Haaland (#9)
// -------------------------------------------------------------
{
  const messi = new PlayerEntity({ archetype: 'MESSI', name: 'Lionel Messi', number: 10 });
  const haaland = new PlayerEntity({ archetype: 'HAALAND', name: 'Erling Haaland', number: 9 });

  // Messi: Agile, low center of gravity, supreme balance
  assert.strictEqual(messi.height, 1.70);
  assert.strictEqual(messi.weight, 72.0);
  assert(messi.locomotion.maxLatAccel > 9.5, `Messi lateral agility (${messi.locomotion.maxLatAccel.toFixed(2)} m/s²) must be elite (> 9.5)`);
  assert(messi.attributes.stanceBalanceFloor >= 0.75, 'Messi balance floor must prevent severe off-balance scuffing');

  // Haaland: Physical beast, towering aerial target, top sprint pace
  assert.strictEqual(haaland.height, 1.95);
  assert.strictEqual(haaland.weight, 88.0);
  assert(haaland.locomotion.sprintSpeed >= 9.5, `Haaland top speed (${haaland.locomotion.sprintSpeed.toFixed(2)} m/s) must be blistering`);
  assert(haaland.attributes.aerialReach >= 2.70, `Haaland aerial reach (${haaland.attributes.aerialReach.toFixed(2)}m) must tower above 2.70m`);
  assert(haaland.attributes.shieldingForce > 480, `Haaland shielding force (${haaland.attributes.shieldingForce.toFixed(0)}N) must be massive`);

  console.log(`  ✔ Archetypes: Messi (Agility: ${messi.locomotion.maxLatAccel.toFixed(2)} m/s², Balance: ${messi.attributes.stanceBalanceFloor.toFixed(2)}) vs Haaland (Speed: ${haaland.locomotion.sprintSpeed.toFixed(2)} m/s, Aerial: ${haaland.attributes.aerialReach.toFixed(2)}m) verified`);
}

// -------------------------------------------------------------
// Test 5: Aerial Interception Capability
// -------------------------------------------------------------
{
  const messi = new PlayerEntity({ x: 50.0, y: 34.0, archetype: 'MESSI' });
  const haaland = new PlayerEntity({ x: 50.0, y: 34.0, archetype: 'HAALAND' });

  // High airborne ball at z = 2.50m (head height for tall players)
  const highBall = new Ball(50.4, 34.0);
  highBall.z = 2.50;

  // Messi cannot reach 2.50m with head (max reach 2.18m)
  assert.strictEqual(messi.canInterceptAirborneBall(highBall), false, 
    'Messi (2.18m reach) should not be able to head a 2.50m high ball');

  // Haaland can easily reach 2.50m (reach 2.78m)
  assert.strictEqual(haaland.canInterceptAirborneBall(highBall), true, 
    'Haaland (2.78m reach) should easily intercept a 2.50m high ball');

  console.log('  ✔ Aerial Interception: 2.50m ball cleanly rejected by Messi (2.18m reach) and intercepted by Haaland (2.78m reach)');
}

console.log('\n✅ ALL FM24 PHYSICAL ATTRIBUTES & BIOMECHANICAL TESTS PASSED CLEANLY!\n');
