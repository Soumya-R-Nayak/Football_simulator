import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SIM_CONFIG } from '../sim/config';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Pitch Agronomy, Surface Damage, and Biomechanical Slipping', () => {
  it('modulates ball rolling distance based on grass cutting height', () => {
    // Test 1: Compare ground pass roll distance across 20mm (short), 24mm (standard), and 36mm (tall)
    const runRollPass = (grassHeightMm: number): { distance: number; timeToStop: number } => {
      const surface = new PitchSurface(grassHeightMm);
      const ball = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
      const kickSpeed = 12.0; // 12 m/s ground pass
      ball.kick(kickSpeed, 0, 0, 0, 0);

      const dt = SIM_CONFIG.LOOP.FIXED_DT;
      let time = 0;
      let state = ball.getState();

      while (time < 15.0) {
        state = ball.step(dt, time, surface);
        time += dt;
        if (state.flightState === 'at_rest') break;
      }

      return {
        distance: state.position.x,
        timeToStop: time,
      };
    };

    const shortGrass = runRollPass(20);
    const standardGrass = runRollPass(24);
    const tallGrass = runRollPass(36);

    console.log(`20mm Grass Roll Distance: ${shortGrass.distance.toFixed(2)} m (Time: ${shortGrass.timeToStop.toFixed(2)}s)`);
    console.log(`24mm Grass Roll Distance: ${standardGrass.distance.toFixed(2)} m (Time: ${standardGrass.timeToStop.toFixed(2)}s)`);
    console.log(`36mm Grass Roll Distance: ${tallGrass.distance.toFixed(2)} m (Time: ${tallGrass.timeToStop.toFixed(2)}s)`);

    // Agronomy validation: short grass rolls fastest, tall grass decelerates much quicker
    expect(shortGrass.distance).toBeGreaterThan(standardGrass.distance);
    expect(standardGrass.distance).toBeGreaterThan(tallGrass.distance);
    // Tall grass (36mm) has +42% rolling friction, so distance should be roughly ~30% shorter
    expect(tallGrass.distance).toBeLessThan(shortGrass.distance * 0.80);
  });

  it('demonstrates that FG plastic studs slip on wet slick turf while SG metal studs maintain traction', () => {
    // Setup a sharp high-speed cut scenario on wet slick turf
    const testCutTraction = (studType: 'fg_plastic' | 'sg_metal'): {
      slipped: boolean;
      slipType: string;
      minAvailableTraction: number;
      peakTractionDemand: number;
    } => {
      const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2);
      sim.setTurfCondition('wet_slick');
      sim.setStudType(studType);

      const dt = SIM_CONFIG.LOOP.FIXED_DT;

      // Phase 1: Sprint straight south for 1.2s to reach high speed (~8 m/s)
      const straightIntent: Intent = {
        moveDir: new Vector2(0, -1),
        faceDir: null,
        gait: 'sprint',
        holdFacing: false,
        manualTurn: 0,
      };

      for (let i = 0; i < Math.round(1.2 / dt); i++) {
        sim.step(straightIntent, dt);
      }

      // Phase 2: Execute an abrupt 90-degree lateral cut to the right (moveDir = (1, 0))
      const sharpCutIntent: Intent = {
        moveDir: new Vector2(1, 0),
        faceDir: null,
        gait: 'sprint',
        holdFacing: false,
        manualTurn: 0,
      };

      let slipped = false;
      let slipType = 'none';
      let minAvailableTraction = 999;
      let peakTractionDemand = 0;

      for (let i = 0; i < Math.round(0.8 / dt); i++) {
        sim.step(sharpCutIntent, dt);
        const playerState = sim.getCurrentState();
        const demand = playerState.slipStatus.tractionDemand;
        const avail = playerState.slipStatus.availableTraction;

        if (demand > peakTractionDemand) peakTractionDemand = demand;
        if (avail < minAvailableTraction) minAvailableTraction = avail;

        if (playerState.slipStatus.type !== 'none') {
          slipped = true;
          slipType = playerState.slipStatus.type;
        }
      }

      return {
        slipped,
        slipType,
        minAvailableTraction,
        peakTractionDemand,
      };
    };

    const fgResult = testCutTraction('fg_plastic');
    const sgResult = testCutTraction('sg_metal');

    console.log(`--- Wet Turf Stud Comparison ---`);
    console.log(`FG Plastic: Slipped = ${fgResult.slipped} (${fgResult.slipType}), Avail TC = ${fgResult.minAvailableTraction.toFixed(2)}, Demand = ${fgResult.peakTractionDemand.toFixed(2)}`);
    console.log(`SG Metal:   Slipped = ${sgResult.slipped} (${sgResult.slipType}), Avail TC = ${sgResult.minAvailableTraction.toFixed(2)}, Demand = ${sgResult.peakTractionDemand.toFixed(2)}`);

    // On wet slick turf, molded FG plastic studs hydroplane (TC_avail ~ 0.61) and slip on sharp cuts
    expect(fgResult.slipped).toBe(true);
    expect(['micro_slip', 'wipeout']).toContain(fgResult.slipType);

    // On the exact same wet turf, SG metal studs bite through thatch (TC_avail ~ 1.15) and hold traction
    expect(sgResult.slipped).toBe(false);
    expect(sgResult.minAvailableTraction).toBeGreaterThan(fgResult.minAvailableTraction * 1.5);
  });

  it('records persistent divots and spatial wear density across the pitch surface', () => {
    const surface = new PitchSurface(24.0);
    expect(surface.getDivots().length).toBe(0);
    expect(surface.getAverageWear()).toBe(0);

    // Create divots at specific coordinates
    const d1 = surface.createDivot(new Vector2(10, 5), Math.PI / 4, 0.75, 1.0);
    expect(surface.getDivots().length).toBe(1);
    expect(d1.turfTornPct).toBe(0.75);

    // Verify discrete divot was registered
    const divotsNear = surface.getDivotsNear(new Vector2(10, 5), 0.5);
    expect(divotsNear.length).toBe(1);
    expect(divotsNear[0].id).toBe(d1.id);

    // Add running wear along a path
    for (let x = 0; x <= 20; x += 1.0) {
      surface.addWear(x, 0, 0.35, 0.15);
    }

    expect(surface.getAverageWear()).toBeGreaterThan(0);
    expect(surface.getWearAt(10, 0)).toBeGreaterThan(0.10);

    // Clear damage
    surface.clearDamage();
    expect(surface.getDivots().length).toBe(0);
    expect(surface.getAverageWear()).toBe(0);
    expect(surface.getWearAt(10, 5)).toBe(0);
  });

  it('causes rolling balls crossing a turf divot to exhibit vertical micro-bobs and deflections', () => {
    const surface = new PitchSurface(24.0);
    const divotPos = new Vector2(15.0, 0.0);
    // Plant a divot right in the ball's rolling trajectory at (15, 0)
    surface.createDivot(divotPos, 0, 0.80, 0.0);

    const ball = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    // Roll ball straight east along x-axis toward divot
    ball.kick(12.0, 0, 0, 0, 0);

    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    let time = 0;
    let maxAltitudeAcrossDivot = 0;
    let bounced = false;

    while (time < 3.0) {
      const state = ball.step(dt, time, surface);
      time += dt;

      // When ball enters divot area (x around 14.8 to 15.3), check if micro-bob occurred
      if (state.position.x > 14.5 && state.position.x < 16.5) {
        if (state.position.z > maxAltitudeAcrossDivot) {
          maxAltitudeAcrossDivot = state.position.z;
        }
        if (state.flightState === 'bounce' || state.position.z > ball.radius + 0.01) {
          bounced = true;
        }
      }
    }

    console.log(`Ball Max Altitude over Divot: ${maxAltitudeAcrossDivot.toFixed(3)} m (Ball Radius: ${ball.radius} m)`);
    // Ball should hop slightly off the turf due to the divot furrow
    expect(bounced).toBe(true);
    expect(maxAltitudeAcrossDivot).toBeGreaterThan(ball.radius + 0.01);
  });

  it('scales slip recovery time inversely with player Balance attribute within the same slip tier', () => {
    const testSlipWithBalance = (balanceValue: number): number => {
      const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2);
      const attrs = { ...sim.getAttributes(), balance: balanceValue };
      sim.setAttributes(attrs);
      sim.setTurfCondition('wet_slick');
      sim.setStudType('fg_plastic');

      const dt = SIM_CONFIG.LOOP.FIXED_DT;

      // Sprint straight for 1.2s to reach high entry speed
      const sprintSouth: Intent = {
        moveDir: new Vector2(0, -1),
        faceDir: null,
        gait: 'sprint',
        holdFacing: false,
        manualTurn: 0,
      };
      for (let i = 0; i < Math.round(1.2 / dt); i++) {
        sim.step(sprintSouth, dt);
      }

      // Execute sharp cut to trigger slip
      const sharpCut: Intent = {
        moveDir: new Vector2(1, 0),
        faceDir: null,
        gait: 'sprint',
        holdFacing: false,
        manualTurn: 0,
      };

      let initialDuration = 0;
      for (let i = 0; i < Math.round(0.5 / dt); i++) {
        sim.step(sharpCut, dt);
        const slip = sim.getCurrentState().slipStatus;
        if (slip.type !== 'none' && slip.initialDuration > initialDuration) {
          initialDuration = slip.initialDuration;
        }
      }

      return initialDuration;
    };

    const lowBalanceDuration = testSlipWithBalance(50);
    const highBalanceDuration = testSlipWithBalance(95);

    console.log(`Low Balance (50) Duration: ${lowBalanceDuration.toFixed(3)}s`);
    console.log(`High Balance (95) Duration: ${highBalanceDuration.toFixed(3)}s`);

    expect(lowBalanceDuration).toBeGreaterThan(0);
    expect(highBalanceDuration).toBeGreaterThan(0);
    expect(lowBalanceDuration).toBeGreaterThan(highBalanceDuration);
  });
});
