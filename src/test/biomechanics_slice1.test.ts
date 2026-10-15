import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Biomechanical Enhancements (Items 1-4)', () => {
  it('Item 1: exhibits true double-support during walking with no flight phase', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const walkIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'walk',
      holdFacing: false,
      manualTurn: 0,
    };

    let sawDoubleSupport = false;
    let sawFlightPhase = false;

    // Simulate 2 seconds of walking
    for (let t = 0; t < 2.0; t += dt) {
      sim.step(walkIntent, dt);
      const state = sim.getCurrentState();

      if (state.stride.isDoubleSupport) {
        sawDoubleSupport = true;
      }
      if (state.stride.phase === 'flight') {
        sawFlightPhase = true;
      }
    }

    // Walking must exhibit double support and never enter flight phase
    expect(sawDoubleSupport).toBe(true);
    expect(sawFlightPhase).toBe(false);
  });

  it('Item 2: calculates vertical bounce for inverted pendulum walk vs spring-mass sprint', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let maxFlightBounce = -Infinity;
    let minStanceBounce = Infinity;

    // Simulate sprint up to 2 seconds
    for (let t = 0; t < 2.0; t += dt) {
      sim.step(sprintIntent, dt);
      const state = sim.getCurrentState();
      if (state.velocity.length() > 4.0) {
        if (state.stride.phase === 'flight') {
          if (state.verticalBounce > maxFlightBounce) maxFlightBounce = state.verticalBounce;
        } else if (state.stride.phase === 'stance') {
          if (state.verticalBounce < minStanceBounce) minStanceBounce = state.verticalBounce;
        }
      }
    }

    // During sprinting: flight phase has positive lift, stance phase has compression dip
    expect(maxFlightBounce).toBeGreaterThan(0.02);
    expect(minStanceBounce).toBeLessThan(-0.015);
  });

  it('Item 3: exhibits axial gaze precedence where headYaw leads torso into turns', () => {
    const sim = new SimulationCore(Vector2.zero(), -Math.PI / 2); // Facing North
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Step with North movement
    const northIntent: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };
    for (let t = 0; t < 0.5; t += dt) {
      sim.step(northIntent, dt);
    }

    // Now steer towards West (-1, 0)
    const westIntent: Intent = {
      moveDir: new Vector2(-1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    // Step a few ticks into the turn
    let maxTurnGazeLead = 0;
    for (let t = 0; t < 0.25; t += dt) {
      sim.step(westIntent, dt);
      const state = sim.getCurrentState();
      if (Math.abs(state.headYaw) > maxTurnGazeLead) {
        maxTurnGazeLead = Math.abs(state.headYaw);
      }
    }

    // Gaze must lead towards the turn by a significant angle (> 5 degrees = 0.08 rad)
    expect(maxTurnGazeLead).toBeGreaterThan(0.08);
  });

  it('Item 4: exhibits Morin sprint drive-phase forward pitch boost during low-speed blastoff', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let drivePhaseLean = 0;
    let highSpeedLean = 0;

    for (let t = 0; t < 3.0; t += dt) {
      sim.step(sprintIntent, dt);
      const state = sim.getCurrentState();
      const speed = state.velocity.length();

      // Early drive phase (speed around 2.0 m/s)
      if (speed >= 1.5 && speed <= 2.5 && drivePhaseLean === 0) {
        drivePhaseLean = state.headOffset.x;
      }
      // High speed sprint (speed > 8.0 m/s)
      if (speed >= 8.0 && highSpeedLean === 0) {
        highSpeedLean = state.headOffset.x;
      }
    }

    console.log(`Drive phase forward lean: ${(drivePhaseLean * 100).toFixed(1)} cm`);
    console.log(`High-speed upright lean: ${(highSpeedLean * 100).toFixed(1)} cm`);

    // Drive phase forward lean must be higher than high-speed upright sprint posture
    expect(drivePhaseLean).toBeGreaterThan(highSpeedLean + 0.05);
  });

  it('Item 5: distinguishes outside-foot plant vs inside check step and reflects weak-foot cutting asymmetry', () => {
    // 1. Right-footed player running North at speed
    const simRightFooted = new SimulationCore(Vector2.zero(), -Math.PI / 2);
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const northIntent: Intent = {
      moveDir: new Vector2(0, -1),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    // Accelerate to steady running speed (~5.0 m/s)
    for (let t = 0; t < 1.0; t += dt) {
      simRightFooted.step(northIntent, dt);
    }

    // Cut Right (East): outside plant foot is LEFT (weak foot: 1★)
    const cutEastIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    simRightFooted.step(cutEastIntent, dt);
    const cutRightState = simRightFooted.getCurrentState();

    expect(cutRightState.cutStatus.isCutting).toBe(true);
    expect(cutRightState.cutStatus.isDominantPlant).toBe(false);
    expect(cutRightState.cutStatus.plantEfficiency).toBeCloseTo(0.84, 2);

    // 2. Right-footed player cutting Left (West): outside plant foot is RIGHT (dominant foot: 5★)
    const simRightFooted2 = new SimulationCore(Vector2.zero(), -Math.PI / 2);
    for (let t = 0; t < 1.0; t += dt) {
      simRightFooted2.step(northIntent, dt);
    }

    const cutWestIntent: Intent = {
      moveDir: new Vector2(-1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    simRightFooted2.step(cutWestIntent, dt);
    const cutLeftState = simRightFooted2.getCurrentState();

    expect(cutLeftState.cutStatus.isCutting).toBe(true);
    expect(cutLeftState.cutStatus.isDominantPlant).toBe(true);
    expect(cutLeftState.cutStatus.plantEfficiency).toBeCloseTo(1.0, 2);

    // 3. Ambipedal player cutting in either direction has 100% plant efficiency
    const simAmbi = new SimulationCore(Vector2.zero(), -Math.PI / 2);
    simAmbi.setFootedness({ dominantFoot: 'both', weakFootAbility: 1.0 });

    for (let t = 0; t < 1.0; t += dt) {
      simAmbi.step(northIntent, dt);
    }
    simAmbi.step(cutEastIntent, dt);
    const ambiCutState = simAmbi.getCurrentState();

    expect(ambiCutState.cutStatus.isCutting).toBe(true);
    expect(ambiCutState.cutStatus.isDominantPlant).toBe(true);
    expect(ambiCutState.cutStatus.plantEfficiency).toBe(1.0);
  });

  it('cycles footedness toggle cleanly (Right -> Left -> Ambipedal -> Right)', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);

    expect(sim.getCurrentState().footedness.dominantFoot).toBe('right');
    expect(sim.getCurrentState().footedness.weakFootAbility).toBe(0.2);

    // First toggle -> Left
    const f1 = sim.toggleFootedness();
    expect(f1.dominantFoot).toBe('left');
    expect(f1.weakFootAbility).toBe(0.2);

    // Second toggle -> Ambipedal ('both')
    const f2 = sim.toggleFootedness();
    expect(f2.dominantFoot).toBe('both');
    expect(f2.weakFootAbility).toBe(1.0);

    // Third toggle -> Right
    const f3 = sim.toggleFootedness();
    expect(f3.dominantFoot).toBe('right');
    expect(f3.weakFootAbility).toBe(0.2);
  });
});
