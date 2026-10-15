import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Locomotion Steering and Cutting Biomechanics', () => {
  it('curves smoothly into diagonal steering (Shift+W -> Shift+W+A) without stalling', () => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Sprint North (W) for 2.0 seconds to reach high sprint speed
    const sprintNorthIntent: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let t = 0; t < 2.0; t += dt) {
      sim.step(sprintNorthIntent, dt);
    }

    const stateAtTransition = sim.getCurrentState();
    expect(stateAtTransition.velocity.y).toBeLessThan(-7.0); // Fast North sprint
    expect(Math.abs(stateAtTransition.velocity.x)).toBeLessThan(0.2); // Negligible lateral drift

    // 2. Transition to North-West diagonal (W + A)
    const diagonalDir = new Vector2(-1, -1).normalize();
    const sprintDiagIntent: Intent = {
      moveDir: diagonalDir,
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    const initialX = stateAtTransition.position.x;
    for (let t = 0; t < 1.0; t += dt) {
      sim.step(sprintDiagIntent, dt);
    }

    const stateAfter1s = sim.getCurrentState();
    const lateralDeltaX = stateAfter1s.position.x - initialX;

    console.log('--- Shift+W -> Shift+W+A Steering Results ---');
    console.log(`Initial vel: (${stateAtTransition.velocity.x.toFixed(2)}, ${stateAtTransition.velocity.y.toFixed(2)}) m/s`);
    console.log(`Vel after 1.0s: (${stateAfter1s.velocity.x.toFixed(2)}, ${stateAfter1s.velocity.y.toFixed(2)}) m/s`);
    console.log(`Lateral displacement Δx: ${lateralDeltaX.toFixed(2)} m`);

    // Verify lateral velocity is strong and definitely not deadlocked at -0.43 m/s
    expect(stateAfter1s.velocity.x).toBeLessThan(-3.5);
    // Verify lateral displacement is substantial (> 2.0 meters in 1 second)
    expect(lateralDeltaX).toBeLessThan(-2.0);
    // Verify velocity angle turned towards diagonal (around -135 deg / -2.35 rad)
    const velAngle = stateAfter1s.velocity.angle();
    expect(velAngle).toBeLessThan(-Math.PI / 2 - 0.4); // At least 23 degrees rotated towards West
  });

  it('performs coupled plant-and-cut braking on sharp 90-degree cuts (Shift+W -> Shift+A)', () => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Sprint North (W) for 2.0 seconds
    const sprintNorthIntent: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let t = 0; t < 2.0; t += dt) {
      sim.step(sprintNorthIntent, dt);
    }

    const stateAtCutStart = sim.getCurrentState();
    const entrySpeed = stateAtCutStart.velocity.length();
    expect(entrySpeed).toBeGreaterThan(7.0);

    // 2. Cut pure West (-1, 0) (Shift + A)
    const cutWestIntent: Intent = {
      moveDir: new Vector2(-1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let minSpeedDuringCut = entrySpeed;
    for (let t = 0; t < 1.0; t += dt) {
      sim.step(cutWestIntent, dt);
      const spd = sim.getCurrentState().velocity.length();
      if (spd < minSpeedDuringCut) minSpeedDuringCut = spd;
    }

    const stateAfterCut = sim.getCurrentState();

    console.log('--- Shift+W -> Shift+A 90° Cut Results ---');
    console.log(`Entry speed: ${entrySpeed.toFixed(2)} m/s`);
    console.log(`Min speed during plant cut: ${minSpeedDuringCut.toFixed(2)} m/s`);
    console.log(`Final vel after 1.0s: (${stateAfterCut.velocity.x.toFixed(2)}, ${stateAfterCut.velocity.y.toFixed(2)}) m/s`);

    // Verify coupled braking occurred (speed dropped significantly to plant and corner)
    expect(minSpeedDuringCut).toBeLessThan(entrySpeed - 1.5);
    // Verify lateral velocity is pointing West
    expect(stateAfterCut.velocity.x).toBeLessThan(-3.5);
  });

  it('comes to a complete, crisp standstill (v = 0, cadence = 0, neutral stance) when releasing movement keys', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Jog East (D) for 1.5 seconds
    const jogEast: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let t = 0; t < 1.5; t += dt) {
      sim.step(jogEast, dt);
    }

    const stateWhileJogging = sim.getCurrentState();
    console.log(`Jogging speed: ${stateWhileJogging.velocity.length().toFixed(2)} m/s`);

    // Release all keys (neutral input) for 2.0 seconds
    const neutralIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let t = 0; t < 2.0; t += dt) {
      sim.step(neutralIntent, dt);
    }

    const stateStopped = sim.getCurrentState();
    expect(stateStopped.velocity.length()).toBe(0);
    expect(stateStopped.stride.cadence).toBe(0);
    expect(stateStopped.stride.isDoubleSupport).toBe(true);

    const stoppedPos = stateStopped.position.clone();
    const wearBeforeIdle = sim.getPitchSurface().getWearAt(stoppedPos.x, stoppedPos.y);

    // Idle at standstill for another 5.0 seconds (600 ticks)
    for (let t = 0; t < 5.0; t += dt) {
      sim.step(neutralIntent, dt);
    }

    const stateAfterIdle = sim.getCurrentState();
    expect(stateAfterIdle.velocity.length()).toBe(0);
    expect(stateAfterIdle.position.x).toBe(stoppedPos.x);
    expect(stateAfterIdle.position.y).toBe(stoppedPos.y);
    expect(stateAfterIdle.stride.cadence).toBe(0);

    const wearAfterIdle = sim.getPitchSurface().getWearAt(stoppedPos.x, stoppedPos.y);
    expect(wearAfterIdle).toBe(wearBeforeIdle); // Zero pitch degradation while stationary
  });
});
