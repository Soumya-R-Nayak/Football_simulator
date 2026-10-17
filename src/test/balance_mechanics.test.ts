import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent, PLAYER_PRESETS, PlayerAttributes } from '../sim/types';

describe('Biomechanical Dynamic Balance System & Edge-Case Robustness', () => {
  // Helper to create simulation with custom balance attribute
  const createSimWithBalance = (balance: number, customAttrs?: Partial<PlayerAttributes>): SimulationCore => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2); // Facing North
    const baseAttrs = PLAYER_PRESETS.balanced;
    sim.setAttributes({
      ...baseAttrs,
      balance,
      ...customAttrs,
    });
    return sim;
  };

  it('Mechanic 1: High balance yields faster post-cut settling and explosive exit acceleration', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const runCutTest = (balance: number): { exitEastSpeed: number; exitHeadingAngle: number } => {
      const sim = createSimWithBalance(balance);

      // Phase 1: Sprint North for 1.2s to reach cruise speed
      const sprintNorth: Intent = { moveDir: new Vector2(0, -1), gait: 'sprint' };
      for (let t = 0; t < 1.2; t += dt) {
        sim.step(sprintNorth, dt);
      }

      // Phase 2: Execute abrupt 90° plant cut to East (moveDir = (1, 0))
      const cutEast: Intent = { moveDir: new Vector2(1, 0), gait: 'sprint' };
      for (let t = 0; t < 0.6; t += dt) {
        sim.step(cutEast, dt);
      }

      const finalState = sim.getCurrentState();
      return {
        exitEastSpeed: finalState.velocity.x,
        exitHeadingAngle: finalState.velocity.angle(),
      };
    };

    const highBal = runCutTest(95); // Messi-tier balance
    const lowBal = runCutTest(50);  // Low balance amateur

    console.log(`--- Post-Cut Exit Acceleration Benchmark ---`);
    console.log(`High Balance (95) -> Exit East Speed: ${highBal.exitEastSpeed.toFixed(2)} m/s, Heading: ${(highBal.exitHeadingAngle * 180 / Math.PI).toFixed(1)}°`);
    console.log(`Low Balance (50)  -> Exit East Speed: ${lowBal.exitEastSpeed.toFixed(2)} m/s, Heading: ${(lowBal.exitHeadingAngle * 180 / Math.PI).toFixed(1)}°`);

    // High balance player bites deeper into the turf and bursts East faster
    expect(highBal.exitEastSpeed).toBeGreaterThan(lowBal.exitEastSpeed);
  });

  it('Mechanic 2: High balance preserves tangential velocity through curved and diagonal trajectories', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const runArcTest = (balance: number): number => {
      const sim = createSimWithBalance(balance);
      // Diagonal strafe sprint while holding North facing (active lateral factor)
      const diagDir = new Vector2(1, -1).normalize(); // 45° diagonal sprint
      const intent: Intent = { moveDir: diagDir, gait: 'sprint', holdFacing: true };

      // Sprint along diagonal for 2.0s
      for (let t = 0; t < 2.0; t += dt) {
        sim.step(intent, dt);
      }

      return sim.getCurrentState().velocity.length();
    };

    const speedHigh = runArcTest(95);
    const speedLow = runArcTest(50);

    console.log(`--- Curving Sprint Speed Preservation ---`);
    console.log(`High Balance (95) Diagonal Speed: ${speedHigh.toFixed(2)} m/s`);
    console.log(`Low Balance (50)  Diagonal Speed: ${speedLow.toFixed(2)} m/s`);

    // High balance athlete holds more speed along angled/diagonal trajectories
    expect(speedHigh).toBeGreaterThan(speedLow);
  });

  it('Mechanic 3: Chop-step braking brings high-balance runner to a crisp, controlled halt without wipeout', () => {
    const sim = createSimWithBalance(95);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Sprint North for 1.8s to reach the high-speed range before braking.
    const sprintNorth: Intent = { moveDir: new Vector2(0, -1), gait: 'sprint' };
    for (let t = 0; t < 1.8; t += dt) {
      sim.step(sprintNorth, dt);
    }

    const speedAtBrake = sim.getCurrentState().velocity.length();
    expect(speedAtBrake).toBeGreaterThan(6.75);

    // Release movement to trigger chop-step braking plant
    const stopIntent: Intent = { moveDir: Vector2.zero(), gait: 'jog' };
    let hadChopStepPlant = false;
    let wipedOut = false;
    let timeToStop = 0;

    for (let t = 0; t < 2.6; t += dt) {
      sim.step(stopIntent, dt);
      const state = sim.getCurrentState();
      if (state.stride.isBraking) hadChopStepPlant = true;
      if (state.slipStatus.type === 'wipeout') wipedOut = true;

      if (state.velocity.length() === 0 && timeToStop === 0) {
        timeToStop = t;
      }
    }

    console.log(`--- High-Speed Chop-Step Braking Results ---`);
    console.log(`Initial Speed: ${speedAtBrake.toFixed(2)} m/s`);
    console.log(`Time to complete rest: ${timeToStop.toFixed(2)} s`);
    console.log(`Had chop-step plant: ${hadChopStepPlant}, Wiped out: ${wipedOut}`);

    // Verified: Chop step engaged, executed cleanly, zero wipeout, brought player to rest in < 2.5s
    expect(hadChopStepPlant).toBe(true);
    expect(wipedOut).toBe(false);
    expect(timeToStop).toBeGreaterThan(0.4);
    expect(timeToStop).toBeLessThan(2.5);
    expect(sim.getCurrentState().velocity.length()).toBe(0);
  });

  it('Mechanic 4: High balance dampens lateral perturbation when crossing turf divots', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const runDivotCrossing = (balance: number): number => {
      const sim = createSimWithBalance(balance);
      const surface = sim.getPitchSurface();

      // Place a divot directly in the path at (0, -4.0)
      surface.createDivot(new Vector2(0, -4.0), 0, 0.85, 0);

      // Sprint North directly over the divot
      const sprintNorth: Intent = { moveDir: new Vector2(0, -1), gait: 'sprint' };
      let maxLateralDev = 0;

      for (let t = 0; t < 1.5; t += dt) {
        sim.step(sprintNorth, dt);
        const state = sim.getCurrentState();
        const lateralDev = Math.abs(state.position.x);
        if (lateralDev > maxLateralDev) {
          maxLateralDev = lateralDev;
        }
      }

      return maxLateralDev;
    };

    const devHigh = runDivotCrossing(95);
    const devLow = runDivotCrossing(50);

    console.log(`--- Surface Divot Perturbation Damping ---`);
    console.log(`High Balance (95) Lateral Deflection: ${(devHigh * 100).toFixed(2)} cm`);
    console.log(`Low Balance (50)  Lateral Deflection: ${(devLow * 100).toFixed(2)} cm`);

    // High balance athlete absorbs the divot with minimal lateral deviation
    expect(devHigh).toBeLessThan(devLow);
    expect(devHigh).toBeLessThan(0.06); // < 6 cm
  });

  it('Mechanic 5: High balance dynamically drops COM into cuts and maintains a compact pelvic sway corridor', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Crouch depth during sharp plant cut
    const getCrouchBounce = (balance: number): number => {
      const sim = createSimWithBalance(balance);
      // Sprint North for 1.0s
      for (let t = 0; t < 1.0; t += dt) {
        sim.step({ moveDir: new Vector2(0, -1), gait: 'sprint' }, dt);
      }
      // Plant cut East
      let minVerticalBounce = 0;
      for (let t = 0; t < 0.4; t += dt) {
        sim.step({ moveDir: new Vector2(1, 0), gait: 'sprint' }, dt);
        const state = sim.getCurrentState();
        if (state.verticalBounce < minVerticalBounce) {
          minVerticalBounce = state.verticalBounce;
        }
      }
      return minVerticalBounce;
    };

    const crouchHigh = getCrouchBounce(95);
    const crouchLow = getCrouchBounce(50);

    console.log(`--- Cut Plant Crouch Depth ---`);
    console.log(`High Balance (95) Min Bounce/Crouch: ${(crouchHigh * 100).toFixed(2)} cm`);
    console.log(`Low Balance (50)  Min Bounce/Crouch: ${(crouchLow * 100).toFixed(2)} cm`);

    // High balance athlete drops hips lower into the cut (more negative vertical bounce)
    expect(crouchHigh).toBeLessThan(crouchLow - 0.01);

    // 2. Pelvic sway corridor tightness during straight cruising
    const simHigh = createSimWithBalance(95);
    const simLow = createSimWithBalance(50);
    let maxSwayHigh = 0;
    let maxSwayLow = 0;

    for (let t = 0; t < 2.0; t += dt) {
      simHigh.step({ moveDir: new Vector2(0, -1), gait: 'sprint' }, dt);
      simLow.step({ moveDir: new Vector2(0, -1), gait: 'sprint' }, dt);

      const swayHigh = Math.abs(simHigh.getCurrentState().stride.lateralSway);
      const swayLow = Math.abs(simLow.getCurrentState().stride.lateralSway);

      if (swayHigh > maxSwayHigh) maxSwayHigh = swayHigh;
      if (swayLow > maxSwayLow) maxSwayLow = swayLow;
    }

    console.log(`--- Pelvic Sway Corridor ---`);
    console.log(`High Balance (95) Max Pelvic Sway: ${(maxSwayHigh * 100).toFixed(2)} cm`);
    console.log(`Low Balance (50)  Max Pelvic Sway: ${(maxSwayLow * 100).toFixed(2)} cm`);

    // High balance maintains a tighter, more compact sway corridor
    expect(maxSwayHigh).toBeLessThan(maxSwayLow);
  });

  // =========================================================================
  // RIGOROUS EDGE-CASE TESTS
  // =========================================================================

  it('Edge Case 1: Extreme Balance values (0 and 100) execute smoothly without NaN, div-by-zero, or physical blowups', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const sim0 = createSimWithBalance(0);
    const sim100 = createSimWithBalance(100);

    const testIntents: Intent[] = [
      { moveDir: new Vector2(1, 0), gait: 'sprint' },
      { moveDir: new Vector2(-1, 0), gait: 'sprint' },
      { moveDir: new Vector2(0, 1), gait: 'jog' },
      { moveDir: Vector2.zero(), gait: 'walk' },
    ];

    for (const intent of testIntents) {
      for (let t = 0; t < 0.5; t += dt) {
        sim0.step(intent, dt);
        sim100.step(intent, dt);

        const s0 = sim0.getCurrentState();
        const s100 = sim100.getCurrentState();

        // Must never produce NaN or infinite values
        expect(Number.isFinite(s0.position.x)).toBe(true);
        expect(Number.isFinite(s0.position.y)).toBe(true);
        expect(Number.isFinite(s0.velocity.x)).toBe(true);
        expect(Number.isFinite(s0.velocity.y)).toBe(true);
        expect(Number.isFinite(s0.verticalBounce)).toBe(true);

        expect(Number.isFinite(s100.position.x)).toBe(true);
        expect(Number.isFinite(s100.position.y)).toBe(true);
        expect(Number.isFinite(s100.velocity.x)).toBe(true);
        expect(Number.isFinite(s100.velocity.y)).toBe(true);
        expect(Number.isFinite(s100.verticalBounce)).toBe(true);
      }
    }
  });

  it('Edge Case 2: Zero and micro-velocity inputs do not drift or destabilize resting stance', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const sim = createSimWithBalance(80);

    // Initial resting state: 0 velocity
    expect(sim.getCurrentState().velocity.length()).toBe(0);

    // Micro-noise intent (sub-threshold stick drift: length = 0.0005)
    const microIntent: Intent = {
      moveDir: new Vector2(0.0003, -0.0004),
      gait: 'walk',
    };

    for (let t = 0; t < 1.0; t += dt) {
      sim.step(microIntent, dt);
      const state = sim.getCurrentState();
      // Should remain completely motionless (deadzone filtering)
      expect(state.velocity.length()).toBe(0);
      expect(state.position.x).toBe(0);
      expect(state.position.y).toBe(0);
      expect(state.stride.cadence).toBe(0);
    }
  });

  it('Edge Case 3: High-frequency 180° direction flickering every tick remains stable and bounded', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const sim = createSimWithBalance(85);

    // Rapidly toggle East (+X) <-> West (-X) every tick for 120 ticks (1.0s at 120 Hz)
    for (let tick = 0; tick < 120; tick++) {
      const dirX = tick % 2 === 0 ? 1 : -1;
      const flickerIntent: Intent = {
        moveDir: new Vector2(dirX, 0),
        gait: 'sprint',
      };
      sim.step(flickerIntent, dt);

      const state = sim.getCurrentState();
      // Kinematic stability assertions: speed should remain constrained, no numerical resonance
      expect(state.velocity.length()).toBeLessThan(4.0);
      expect(Number.isFinite(state.velocity.x)).toBe(true);
      expect(Number.isFinite(state.position.x)).toBe(true);
    }
  });

  it('Edge Case 4: Simultaneous compound hazards (divot + rut + puddle) preserve positive traction and stability', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const sim = createSimWithBalance(80);
    const surface = sim.getPitchSurface();

    // Place divot at (0, -2)
    surface.createDivot(new Vector2(0, -2), 0, 0.90, 0);
    // Place rut across (0, -2)
    surface.createRut(new Vector2(-1, -2), new Vector2(1, -2), 0.85, 0);
    // Add standing puddle at (0, -2)
    surface.setBaseMoisture(0.85);

    // Sprint right through the intersection
    const sprintNorth: Intent = { moveDir: new Vector2(0, -1), gait: 'sprint' };
    for (let t = 0; t < 1.5; t += dt) {
      sim.step(sprintNorth, dt);
      const state = sim.getCurrentState();

      // Available traction must remain positive and non-zero
      expect(state.slipStatus.availableTraction).toBeGreaterThan(0.10);
      expect(Number.isFinite(state.slipStatus.availableTraction)).toBe(true);
      expect(Number.isFinite(state.velocity.x)).toBe(true);
      expect(Number.isFinite(state.velocity.y)).toBe(true);
    }
  });

  it('Edge Case 5: Zero stamina exhaustion during max-G braking cut remains bounded and recovers', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const sim = createSimWithBalance(75, { stamina: 0 }); // Completely exhausted player
    sim.setStamina(0);

    // Run sprint North
    for (let t = 0; t < 1.0; t += dt) {
      sim.step({ moveDir: new Vector2(0, -1), gait: 'sprint' }, dt);
      sim.setStamina(0);
    }

    // Abrupt emergency 90° cut
    for (let t = 0; t < 0.5; t += dt) {
      sim.step({ moveDir: new Vector2(1, 0), gait: 'sprint' }, dt);
      const state = sim.getCurrentState();
      expect(state.stamina).toBe(0);
      expect(Number.isFinite(state.velocity.length())).toBe(true);
      expect(state.velocity.length()).toBeLessThan(9.5);
    }

    // Rest to test stamina recovery from absolute zero
    for (let t = 0; t < 1.0; t += dt) {
      sim.step({ moveDir: Vector2.zero(), gait: 'walk' }, dt);
    }
    expect(sim.getCurrentState().stamina).toBeGreaterThan(0.01);
  });

  it('Edge Case 6: Anthropometric extremes (150cm / 50kg vs 210cm / 115kg) execute balance mechanics smoothly', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Tiny nimble player
    const simTiny = createSimWithBalance(95, { heightCm: 150, weightKg: 50 });
    // Giant heavyweight player
    const simGiant = createSimWithBalance(70, { heightCm: 210, weightKg: 115 });

    const cutIntent: Intent = { moveDir: new Vector2(1, 0), gait: 'sprint' };

    for (let t = 0; t < 1.5; t += dt) {
      simTiny.step(cutIntent, dt);
      simGiant.step(cutIntent, dt);

      const sTiny = simTiny.getCurrentState();
      const sGiant = simGiant.getCurrentState();

      expect(Number.isFinite(sTiny.stride.strideLength)).toBe(true);
      expect(sTiny.stride.strideLength).toBeGreaterThanOrEqual(0);
      if (sTiny.velocity.length() > 0.15) {
        expect(sTiny.stride.strideLength).toBeGreaterThan(0);
      }
      if (t > 0.5) {
        expect(sGiant.stride.strideLength).toBeGreaterThan(0);
      }
      expect(Number.isFinite(sTiny.velocity.length())).toBe(true);
      expect(Number.isFinite(sGiant.velocity.length())).toBe(true);
    }
  });
});
