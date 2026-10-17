import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { LocomotionSystem } from '../sim/locomotion/LocomotionSystem';
import { Intent } from '../sim/types';

describe('Locomotion Steering and Cutting Biomechanics', () => {
  it('accelerates and brakes torso yaw without snapping or overshooting the target', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const controller = new LocomotionSystem(Vector2.zero(), 0);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const turnIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: new Vector2(0, 1),
      gait: 'walk',
      holdFacing: false,
      manualTurn: 0,
    };

    let state = sim.getCurrentState();
    const first = controller.step(state, turnIntent, dt);
    expect(first.angularVelocity).toBeGreaterThan(0);
    expect(first.angularVelocity).toBeLessThanOrEqual(SIM_CONFIG.KINEMATICS.ALPHA_YAW_MAX * dt + 1e-8);
    expect(first.facing).toBeLessThan(first.angularVelocity * dt);

    state = first;
    for (let i = 0; i < 240; i++) state = controller.step(state, turnIntent, dt);
    expect(Math.abs(Math.PI / 2 - state.facing)).toBeLessThan(0.02);
    expect(state.angularVelocity).toBeCloseTo(0, 6);
  });

  it('reduces yaw acceleration when support is airborne or the loaded foot slips', () => {
    const baseState = new SimulationCore(Vector2.zero(), 0).getCurrentState();
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const turnIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: new Vector2(0, 1),
      gait: 'walk',
      holdFacing: false,
      manualTurn: 0,
    };
    const makeState = (mode: 'grounded' | 'airborne' | 'slipping') => {
      const normalLoad = baseState.attributes.weightKg * 9.81;
      const leftFoot = {
        ...baseState.contactState!.leftFoot,
        inContact: mode !== 'airborne',
        isSlipping: mode === 'slipping',
        normalLoadN: mode === 'airborne' ? 0 : normalLoad,
      };
      const rightFoot = {
        ...baseState.contactState!.rightFoot,
        inContact: false,
        isSlipping: false,
        normalLoadN: 0,
      };
      return {
        ...baseState,
        stride: {
          ...baseState.stride,
          phase: mode === 'airborne' ? 'flight' as const : 'stance' as const,
          isDoubleSupport: false,
          currentFoot: 'left' as const,
        },
        contactState: {
          ...baseState.contactState!,
          isSupported: mode !== 'airborne',
          leftFoot,
          rightFoot,
        },
        slipStatus: mode === 'slipping'
          ? { ...baseState.slipStatus, type: 'micro_slip' as const, slipFoot: 'left' as const }
          : baseState.slipStatus,
      };
    };
    const response = (mode: 'grounded' | 'airborne' | 'slipping') => {
      const state = makeState(mode);
      return new LocomotionSystem(state.position, state.facing).step(state, turnIntent, dt).angularVelocity;
    };

    const groundedResponse = response('grounded');
    const airborneResponse = response('airborne');
    const slippingResponse = response('slipping');

    expect(groundedResponse).toBeGreaterThan(airborneResponse);
    expect(groundedResponse).toBeGreaterThan(slippingResponse);
  });

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
    expect(stateAfter1s.velocity.x).toBeLessThan(-3.0);
    // Verify lateral displacement is substantial (> 2.0 meters in 1 second)
    expect(lateralDeltaX).toBeLessThan(-1.5);
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
    expect(stateAfterCut.velocity.x).toBeLessThan(-2.0);
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

  it('strictly preserves negative deceleration sign during 90-degree plant cut entry with zero forward boost', () => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2); // Facing North
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Sprint North for 2.0s to reach top speed
    const sprintNorth: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };
    for (let t = 0; t < 2.0; t += dt) sim.step(sprintNorth, dt);

    const v0 = sim.getCurrentState().velocity;
    const entrySpeed = v0.length();
    expect(entrySpeed).toBeGreaterThan(7.0);

    // Cut pure West (-1, 0)
    const cutWest: Intent = {
      moveDir: new Vector2(-1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Trace the first 30 ticks of the cut
    for (let tick = 0; tick < 30; tick++) {
      const vBefore = sim.getCurrentState().velocity;
      const fwdUnit = vBefore.normalize();

      sim.step(cutWest, dt);

      const vAfter = sim.getCurrentState();
      const appliedAcc = vAfter.velocity.sub(vBefore).scale(1 / dt);
      const netLongAcc = appliedAcc.dot(fwdUnit);

      // Invariant: Longitudinal acceleration along velocity must never be positive (no forward acceleration spurts)
      expect(netLongAcc).toBeLessThanOrEqual(0.001);
    }
  });

  it('strictly preserves decelerative force during 180-degree direction reversal without forward surges', () => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2); // Facing North
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Sprint North for 2.0s
    const sprintNorth: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };
    for (let t = 0; t < 2.0; t += dt) sim.step(sprintNorth, dt);

    // Now command complete 180° reversal (South)
    const sprintSouth: Intent = {
      moveDir: new Vector2(0, 1),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let previousSpeed = sim.getCurrentState().velocity.length();
    for (let tick = 0; tick < 40; tick++) {
      const vBefore = sim.getCurrentState().velocity;
      if (vBefore.y >= 0) break; // Turned through zero

      sim.step(sprintSouth, dt);

      const vAfter = sim.getCurrentState().velocity;
      const appliedAcc = vAfter.sub(vBefore).scale(1 / dt);
      const netLongAcc = appliedAcc.dot(vBefore.normalize());

      // Deceleration along velocity must be opposing (non-positive)
      expect(netLongAcc).toBeLessThanOrEqual(0.001);
      // Speed along North must decrease monotonically until zero-crossing
      if (vAfter.y < 0) {
        expect(vAfter.length()).toBeLessThanOrEqual(previousSpeed + 1e-4);
        previousSpeed = vAfter.length();
      }
    }
  });
});
