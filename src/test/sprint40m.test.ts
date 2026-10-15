import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Headless 40m Sprint Biomechanics Benchmark', () => {
  it('calibrates 10m split and 40m sprint times to elite football standards', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    let time = 0;
    let split10m: number | null = null;
    let finish40m: number | null = null;
    let maxSpeed = 0;
    let stepCount = 0;
    let prevFoot = sim.getCurrentState().stride.currentFoot;

    // Simulate up to 6.0 seconds
    while (time <= 6.0) {
      sim.step(sprintIntent, dt);
      time += dt;

      const state = sim.getCurrentState();
      const speed = state.velocity.length();
      if (speed > maxSpeed) maxSpeed = speed;

      // Track foot changes
      if (state.stride.currentFoot !== prevFoot) {
        stepCount++;
        prevFoot = state.stride.currentFoot;
      }

      // Check 10m split
      if (split10m === null && state.position.x >= 10.0) {
        split10m = time;
      }

      // Check 40m finish
      if (finish40m === null && state.position.x >= 40.0) {
        finish40m = time;
        break;
      }
    }

    console.log('--- 40m Sprint Benchmark Results ---');
    console.log(`10m Split: ${split10m?.toFixed(3)} s`);
    console.log(`40m Finish: ${finish40m?.toFixed(3)} s`);
    console.log(`Peak Speed: ${maxSpeed.toFixed(2)} m/s (${(maxSpeed * 3.6).toFixed(1)} km/h)`);
    console.log(`Steps Taken: ${stepCount}`);

    expect(split10m).not.toBeNull();
    expect(finish40m).not.toBeNull();

    // 10m split standard: 1.70s to 1.95s
    expect(split10m!).toBeGreaterThanOrEqual(1.65);
    expect(split10m!).toBeLessThanOrEqual(2.05);

    // 40m finish standard: 4.70s to 5.30s
    expect(finish40m!).toBeGreaterThanOrEqual(4.65);
    expect(finish40m!).toBeLessThanOrEqual(5.35);

    // Peak speed near top sprint speed
    expect(maxSpeed).toBeGreaterThanOrEqual(8.0);
    expect(maxSpeed).toBeLessThanOrEqual(SIM_CONFIG.GAIT_SPEEDS.sprint + 0.5);

    // Confirms multiple discrete footsteps were executed
    expect(stepCount).toBeGreaterThan(10);
  });
});
