import assert from 'node:assert';
import { Vector2 } from '../src/math/Vector2.js';
import { Locomotion } from '../src/physics/Locomotion.js';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Ball } from '../src/physics/Ball.js';

console.log('🔄 Running Sharp-Turn Off-Ball Locomotion & Physics Tests...\n');

const dt = 0.016; // 60 FPS standard timestep
const pitch = new Pitch();
const env = new Environment({ turfType: 'DRY' });
const dummyBall = new Ball(50, 34);

// -------------------------------------------------------------
// Test 1: 90° Turn Initiated at High Sprint Speed (Momentum & Lateral Accel Invariant)
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });
  const initialSpeed = 8.8; // Sprinting East (heading = 0)
  let vel = new Vector2(initialSpeed, 0);
  const desiredDir = new Vector2(0, 1); // 90° cut to South (heading = PI/2)
  const desiredSpeed = 8.8;

  // Step 1: Check single-frame physical invariants
  const nextVel = loco.updateVelocity(vel, desiredDir, desiredSpeed, dt);
  const turnRate = Math.abs(nextVel.heading() - vel.heading()) / dt;
  const latAccel = initialSpeed * turnRate;

  // Centripetal acceleration invariant: a_perp = v * |omega| <= maxLatAccel
  assert.ok(
    latAccel <= loco.maxLatAccel + 1e-4,
    `Lateral acceleration (${latAccel.toFixed(2)} m/s²) must not exceed maxLatAccel (${loco.maxLatAccel} m/s²)`
  );

  // Momentum matters: player cannot instantaneously snap to 90°
  assert.ok(
    nextVel.heading() < Math.PI / 4,
    `Heading after 1 frame (${(nextVel.heading() * 180 / Math.PI).toFixed(1)}°) must not snap instantly to 90°`
  );
  assert.ok(
    nextVel.x > 8.0,
    `Forward momentum along East must persist in the first frame (got ${nextVel.x.toFixed(2)} m/s)`
  );

  // Multi-frame evolution: Player brakes while turning and redirects smoothly
  let currentVel = vel.clone();
  for (let frame = 0; frame < 95; frame++) {
    const prevSpeed = currentVel.magnitude();
    currentVel = loco.updateVelocity(currentVel, desiredDir, desiredSpeed, dt);
    const speed = currentVel.magnitude();
    // Braking cannot exceed maxBrake
    if (speed < prevSpeed) {
      const decel = (prevSpeed - speed) / dt;
      assert.ok(
        decel <= loco.maxBrake + 1e-4,
        `Deceleration during 90° turn (${decel.toFixed(2)} m/s²) must not exceed maxBrake (${loco.maxBrake} m/s²)`
      );
    }
  }

  // After 95 frames (~1.5s), heading has cleanly completed the 90° turn to South
  const finalAngleDiff = Math.abs(currentVel.heading() - Math.PI / 2);
  assert.ok(
    finalAngleDiff < 0.1,
    `After ~1.5s, heading should be within 0.1 rad of 90° South (got ${(currentVel.heading() * 180 / Math.PI).toFixed(1)}°)`
  );
  console.log('  ✔ 90° High-Speed Turn: Centripetal limit respected, momentum preserved, smooth redirection verified');
}

// -------------------------------------------------------------
// Test 2: 180° High-Speed Reversal Trajectory (Curved U-Turn Redirection & Apex Speed)
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });
  const v0 = 8.8; // East (heading = 0)
  let vel = new Vector2(v0, 0);
  const desiredDir = new Vector2(-1, 0); // 180° reversal to West
  const desiredSpeed = 8.8;

  let minSpeed = Infinity;
  let frameMinSpeed = -1;
  let frameZeroVx = -1;
  let speedAtZeroVx = 0;
  let headingAtZeroVx = 0;
  let vyAtZeroVx = 0;

  for (let f = 1; f <= 110; f++) {
    const prevSpeed = vel.magnitude();
    const prevHeading = vel.heading();
    vel = loco.updateVelocity(vel, desiredDir, desiredSpeed, dt);
    const newSpeed = vel.magnitude();

    // Track minimum speed across the trajectory
    if (newSpeed < minSpeed) {
      minSpeed = newSpeed;
      frameMinSpeed = f;
    }

    // Detect when eastward velocity vx crosses zero
    if (vel.x <= 0 && frameZeroVx === -1) {
      frameZeroVx = f;
      speedAtZeroVx = newSpeed;
      headingAtZeroVx = vel.heading() * 180 / Math.PI;
      vyAtZeroVx = vel.y;
    }

    // Centripetal acceleration invariant in every frame: a_perp = v * |omega| <= maxLatAccel
    let deltaAngle = vel.heading() - prevHeading;
    while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
    while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    const latAccel = prevSpeed * (Math.abs(deltaAngle) / dt);
    assert.ok(
      latAccel <= loco.maxLatAccel + 1e-4,
      `Lateral acceleration (${latAccel.toFixed(2)} m/s²) must not exceed maxLatAccel at frame ${f}`
    );

    // Longitudinal acceleration / deceleration invariants
    if (newSpeed < prevSpeed) {
      const decel = (prevSpeed - newSpeed) / dt;
      assert.ok(
        decel <= loco.maxBrake + 1e-4,
        `Deceleration during 180° reversal (${decel.toFixed(2)} m/s²) must not exceed maxBrake (${loco.maxBrake} m/s²)`
      );
    } else if (newSpeed > prevSpeed) {
      const accel = (newSpeed - prevSpeed) / dt;
      assert.ok(
        accel <= loco.currentMaxAccel + 1e-4,
        `Acceleration during 180° turnaround (${accel.toFixed(2)} m/s²) must not exceed currentMaxAccel (${loco.currentMaxAccel} m/s²)`
      );
    }
  }

  // 1. Verify that vx crossed zero at the 90° apex of the curved trajectory
  assert.ok(frameZeroVx >= 55 && frameZeroVx <= 65, `vx crossed zero at frame ${frameZeroVx} (~${(frameZeroVx * dt).toFixed(2)}s)`);
  assert.ok(
    Math.abs(headingAtZeroVx - 90.0) < 5.0,
    `Heading when vx=0 must be ~90° South (perpendicular to East-West), got ${headingAtZeroVx.toFixed(1)}°`
  );

  // 2. Distinguish total speed from vx crossing: total speed does NOT stop at vx=0
  assert.ok(
    speedAtZeroVx > 1.8 && speedAtZeroVx < 2.2,
    `Total speed when vx=0 must reflect apex speed (~1.96 m/s), got ${speedAtZeroVx.toFixed(3)} m/s`
  );
  assert.ok(
    vyAtZeroVx > 1.8,
    `Lateral velocity vy when vx=0 must be positive (~1.96 m/s), got ${vyAtZeroVx.toFixed(3)} m/s`
  );

  // 3. Verify minimum speed magnitude across the trajectory (heavy apex brake, but not a complete stop)
  assert.ok(
    minSpeed > 1.7 && minSpeed < 2.1,
    `Minimum total speed throughout curved reversal must drop to apex ~1.89 m/s, got ${minSpeed.toFixed(3)} m/s at frame ${frameMinSpeed}`
  );
  assert.ok(
    minSpeed > 0.5,
    'Curved continuous redirection retains momentum through the turn; total speed does not reach standstill'
  );

  // 4. Verify completion of the 180° turnaround into West
  let finalHeadingDiff = Math.abs(vel.heading() - Math.PI);
  while (finalHeadingDiff > Math.PI) finalHeadingDiff = Math.abs(finalHeadingDiff - Math.PI * 2);
  assert.ok(
    finalHeadingDiff < 0.05,
    `Heading after 110 frames must align with West (180°), diff = ${finalHeadingDiff.toFixed(4)} rad`
  );
  assert.ok(vel.x < -5.0, `Player must be driving West at speed > 5 m/s (got vel.x = ${vel.x.toFixed(2)} m/s)`);
  assert.ok(Math.abs(vel.y) < 0.1, `Lateral velocity vy must straighten out to near zero (got ${vel.y.toFixed(3)} m/s)`);

  console.log(`  ✔ 180° High-Speed Reversal: Continuous curved U-turn verified (apex speed: ${speedAtZeroVx.toFixed(2)} m/s at vx=0, final: ${vel.x.toFixed(2)} m/s West)`);
}

// -------------------------------------------------------------
// Test 3: Low-Speed Turns (Stability, Singularity Avoidance)
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });

  // Low speed: 1.5 m/s 90° turn
  let vel90 = new Vector2(1.5, 0);
  const next90 = loco.updateVelocity(vel90, new Vector2(0, 1), 1.5, dt);
  assert.ok(!Number.isNaN(next90.x) && !Number.isNaN(next90.y), 'Velocity must remain finite');
  const turnRateLow = Math.abs(next90.heading() - vel90.heading()) / dt;
  const latAccelLow = 1.5 * turnRateLow;
  assert.ok(
    latAccelLow <= loco.maxLatAccel + 1e-4,
    `Low-speed lateral acceleration (${latAccelLow.toFixed(2)} m/s²) must respect maxLatAccel`
  );

  // Near-zero speed threshold: 0.02 m/s
  let velNearZero = new Vector2(0.02, 0);
  const nextNearZero = loco.updateVelocity(velNearZero, new Vector2(0, 1), 5.0, dt);
  assert.ok(!Number.isNaN(nextNearZero.x) && !Number.isNaN(nextNearZero.y), 'Near-zero velocity must be finite');
  assert.ok(nextNearZero.magnitude() > 0.02, 'Near-zero speed player must accelerate smoothly into desired direction');
  assert.ok(
    Math.abs(nextNearZero.heading() - Math.PI / 2) < 1e-4,
    'Near-zero speed player should align directly with target heading without angular oscillation'
  );
  console.log('  ✔ Low-Speed Turns: Stable turning and zero-singularity avoidance verified');
}

// -------------------------------------------------------------
// Test 4: Smooth Transition Across Turn Angles & Threshold Continuity Regression
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });

  // 4a. Old Threshold Regression Test: 44°, 45°, 46°, 47° across acos(0.70) ≈ 45.57°
  // In the old threshold-based implementation:
  // - Angles <= 45.57° targeted full desired speed (8.8 m/s).
  // - Angles > 45.57° dropped target speed discontinuously to <= 6.11 m/s (~70%).
  // At cruising speed (6.4 m/s), this caused an artificial 12 m/s² acceleration jump
  // and a single-frame speed drop of 0.192 m/s between 45° and 46° (while 44°->45° was 0).
  const anglesRegression = [44, 45, 46, 47];
  const cruisingVel = new Vector2(6.4, 0);

  // Single-frame speed response
  const singleStepSpeeds = anglesRegression.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const dir = new Vector2(Math.cos(rad), Math.sin(rad));
    return loco.updateVelocity(cruisingVel.clone(), dir, 8.8, dt).magnitude();
  });

  const d44_45 = Math.abs(singleStepSpeeds[0] - singleStepSpeeds[1]);
  const d45_46 = Math.abs(singleStepSpeeds[1] - singleStepSpeeds[2]);
  const d46_47 = Math.abs(singleStepSpeeds[2] - singleStepSpeeds[3]);

  // Assert no discontinuous speed step across the 45°-46° boundary
  // In old code: d45_46 was 0.192 m/s while d44_45 was 0.000 m/s (failed both assertions).
  assert.ok(
    d45_46 < 0.12,
    `Single-frame speed drop across 45°->46° (${d45_46.toFixed(4)} m/s) must be continuous (< 0.12 m/s)`
  );
  assert.ok(
    Math.abs(d45_46 - d44_45) < 0.05,
    `Rate of speed change between neighboring degrees must be smooth; got |d45_46 - d44_45| = ${Math.abs(d45_46 - d44_45).toFixed(4)} m/s (must be < 0.05 m/s)`
  );

  // Fine-step continuity across the exact threshold: 45.5° vs 45.6° (0.1° delta)
  const dir45_5 = new Vector2(Math.cos(45.5 * Math.PI / 180), Math.sin(45.5 * Math.PI / 180));
  const dir45_6 = new Vector2(Math.cos(45.6 * Math.PI / 180), Math.sin(45.6 * Math.PI / 180));
  const s45_5 = loco.updateVelocity(cruisingVel.clone(), dir45_5, 8.8, dt).magnitude();
  const s45_6 = loco.updateVelocity(cruisingVel.clone(), dir45_6, 8.8, dt).magnitude();
  const fineDelta = Math.abs(s45_5 - s45_6);
  // In old code: fineDelta was 0.1920 m/s across 0.1°!
  assert.ok(
    fineDelta < 0.03,
    `Fine-step speed delta across 45.57° threshold (${fineDelta.toFixed(4)} m/s) must be < 0.03 m/s`
  );

  // Multi-step trajectory evolution (10 frames) across 44°, 45°, 46°, 47°
  const multiSpeeds = anglesRegression.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const dir = new Vector2(Math.cos(rad), Math.sin(rad));
    let v = cruisingVel.clone();
    for (let i = 0; i < 10; i++) {
      v = loco.updateVelocity(v, dir, 8.8, dt);
    }
    return v.magnitude();
  });
  const multi_d44_45 = Math.abs(multiSpeeds[0] - multiSpeeds[1]);
  const multi_d45_46 = Math.abs(multiSpeeds[1] - multiSpeeds[2]);
  assert.ok(
    Math.abs(multi_d45_46 - multi_d44_45) < 0.05,
    `Multi-step speed evolution must be continuous across 45°-46°; got delta diff = ${Math.abs(multi_d45_46 - multi_d44_45).toFixed(4)} m/s`
  );

  // 4b. Smooth transition across broader angles (50°, 54°, 56°, 60°)
  const speedBroader = 6.0;
  const velBroader = new Vector2(speedBroader, 0);
  const anglesBroader = [50, 54, 56, 60];
  const resultsBroader = anglesBroader.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const dir = new Vector2(Math.cos(rad), Math.sin(rad));
    const nextVel = loco.updateVelocity(velBroader.clone(), dir, speedBroader, dt);
    const deltaHeading = Math.abs(nextVel.heading() - velBroader.heading());
    const deltaSpeed = speedBroader - nextVel.magnitude();
    return { deg, deltaHeading, deltaSpeed };
  });

  assert.ok(
    Math.abs(resultsBroader[1].deltaHeading - resultsBroader[2].deltaHeading) < 1e-5,
    'Turn rate across 54° and 56° must be governed by continuous centripetal limit'
  );
  const diff54_56 = Math.abs(resultsBroader[1].deltaSpeed - resultsBroader[2].deltaSpeed);
  assert.ok(
    diff54_56 < 0.02,
    `Speed change must be continuous across 54°-56° (delta is ${diff54_56.toFixed(4)} m/s)`
  );
  console.log('  ✔ Smooth Angle Transition: 44°-47° threshold regression & 50°-60° continuity confirmed');
}

// -------------------------------------------------------------
// Test 5: Exhaustive Physical Invariant Checks Across Trajectories
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });
  const testAngles = [30, 45, 60, 90, 120, 150, 180];
  const testSpeeds = [2.0, 4.0, 6.0, 8.8];

  for (const speed of testSpeeds) {
    for (const deg of testAngles) {
      const rad = (deg * Math.PI) / 180;
      const desiredDir = new Vector2(Math.cos(rad), Math.sin(rad));
      let currentVel = new Vector2(speed, 0);

      for (let step = 0; step < 30; step++) {
        const prevSpeed = currentVel.magnitude();
        const prevHeading = currentVel.heading();
        const nextVel = loco.updateVelocity(currentVel, desiredDir, speed, dt);
        const nextSpeed = nextVel.magnitude();

        if (prevSpeed > 0.05) {
          let deltaAngle = nextVel.heading() - prevHeading;
          while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
          while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;

          const latAccel = prevSpeed * (Math.abs(deltaAngle) / dt);
          assert.ok(
            latAccel <= loco.maxLatAccel + 1e-3,
            `Trajectory invariant: a_lat (${latAccel.toFixed(3)}) <= maxLatAccel (${loco.maxLatAccel}) at speed=${speed}, angle=${deg}°`
          );
        }

        if (nextSpeed < prevSpeed) {
          const decel = (prevSpeed - nextSpeed) / dt;
          assert.ok(
            decel <= loco.maxBrake + 1e-3,
            `Trajectory invariant: decel (${decel.toFixed(3)}) <= maxBrake (${loco.maxBrake}) at speed=${speed}, angle=${deg}°`
          );
        }

        currentVel = nextVel;
      }
    }
  }
  console.log('  ✔ Numerical Invariants: 100% of tested trajectories strictly respect maxLatAccel and maxBrake');
}

// -------------------------------------------------------------
// Test 6: Stationary Player Orienting Body Heading
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50, y: 34 });
  player.vel = new Vector2(0, 0);
  player.heading = 0.0; // Facing East

  // Player receives input to face North (heading = -PI/2 or 3*PI/2) without moving
  const desiredDir = new Vector2(0, -1); // North (-PI/2)
  const initialHeading = player.heading;

  // Run 1 frame
  player.update(dt, dummyBall, pitch, env, desiredDir, 'STAND');

  assert.strictEqual(player.vel.magnitude(), 0, 'Stationary player must remain at rest when desired speed is 0');
  assert.ok(
    player.heading !== initialHeading,
    'Stationary player must be able to pivot body heading toward desired input direction'
  );

  // Run for 0.25 seconds
  for (let i = 0; i < 15; i++) {
    player.update(dt, dummyBall, pitch, env, desiredDir, 'STAND');
  }

  // Heading should now be facing North (-PI/2)
  let diff = Math.abs(player.heading - (-Math.PI / 2));
  while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
  assert.ok(
    diff < 0.1,
    `Stationary player must orient towards North within 0.25s (heading diff: ${diff.toFixed(3)} rad)`
  );
  console.log('  ✔ Stationary Orientation: Zero-speed player pivots smoothly to face desired direction');
}

// -------------------------------------------------------------
// Test 7: Frame-Rate Consistency Across Timesteps (30, 60, 120 FPS)
// -------------------------------------------------------------
{
  const timesteps = [1 / 30, 1 / 60, 1 / 120];
  const totalDuration = 0.8; // 0.8 seconds of a 90° turn
  const initialSpeed = 7.0;
  const desiredDir = new Vector2(0, 1);
  const finalSpeeds = [];
  const finalHeadings = [];

  for (const stepDt of timesteps) {
    const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });
    let vel = new Vector2(initialSpeed, 0);
    const steps = Math.round(totalDuration / stepDt);

    for (let i = 0; i < steps; i++) {
      vel = loco.updateVelocity(vel, desiredDir, initialSpeed, stepDt);
    }
    finalSpeeds.push(vel.magnitude());
    finalHeadings.push(vel.heading());
  }

  // Compare 30 FPS and 120 FPS against 60 FPS baseline (index 1)
  const baselineSpeed = finalSpeeds[1];
  const baselineHeading = finalHeadings[1];

  for (let i = 0; i < timesteps.length; i++) {
    const speedError = Math.abs(finalSpeeds[i] - baselineSpeed) / baselineSpeed;
    const headingError = Math.abs(finalHeadings[i] - baselineHeading);
    assert.ok(
      speedError < 0.05,
      `Speed error at dt=${timesteps[i].toFixed(4)}s (${(speedError * 100).toFixed(2)}%) must be < 5%`
    );
    assert.ok(
      headingError < 0.08,
      `Heading difference at dt=${timesteps[i].toFixed(4)}s (${headingError.toFixed(3)} rad) must be < 0.08 rad`
    );
  }
  console.log('  ✔ Frame-Rate Independence: 30, 60, and 120 FPS match within < 5% error margin');
}

// -------------------------------------------------------------
// Test 8: Regressions: Straight Acceleration, Shallow Turning, and Braking to Stop
// -------------------------------------------------------------
{
  const loco = new Locomotion({ topSpeed: 8.8, maxAccel: 4.8, maxBrake: 7.2, maxLatAccel: 7.2 });

  // 8a. Straight acceleration from rest
  let vel = new Vector2(0, 0);
  for (let i = 0; i < 60; i++) {
    const prev = vel.magnitude();
    vel = loco.updateVelocity(vel, new Vector2(1, 0), loco.sprintSpeed, dt);
    const accel = (vel.magnitude() - prev) / dt;
    assert.ok(accel <= loco.currentMaxAccel + 1e-4, 'Acceleration cannot exceed maxAccel');
  }
  assert.ok(vel.magnitude() > 4.0, `Player must accelerate forward (got ${vel.magnitude().toFixed(2)} m/s)`);

  // 8b. Shallow turning (15°)
  const shallowDir = new Vector2(Math.cos(15 * Math.PI / 180), Math.sin(15 * Math.PI / 180));
  for (let i = 0; i < 30; i++) {
    vel = loco.updateVelocity(vel, shallowDir, loco.sprintSpeed, dt);
  }
  let diffShallow = Math.abs(vel.heading() - shallowDir.heading());
  while (diffShallow > Math.PI) diffShallow = Math.abs(diffShallow - Math.PI * 2);
  assert.ok(diffShallow < 0.05, 'Shallow turn must accurately track target heading');

  // 8c. Braking to stop (desiredDir = null / zero)
  while (vel.magnitude() > 0) {
    const prev = vel.magnitude();
    vel = loco.updateVelocity(vel, null, 0, dt);
    if (vel.magnitude() > 0) {
      const decel = (prev - vel.magnitude()) / dt;
      assert.ok(decel <= loco.maxBrake + 1e-4, 'Braking to stop cannot exceed maxBrake');
    }
  }
  assert.strictEqual(vel.magnitude(), 0, 'Player must come to a complete stop');
  console.log('  ✔ Regressions Passed: Straight sprint, shallow steering, and standstill braking verified');
}

console.log('\n✅ ALL SHARP-TURN PHYSICS & INVARIANT TESTS PASSED CLEANLY!');
