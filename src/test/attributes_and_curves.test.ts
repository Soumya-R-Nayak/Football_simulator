import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent, PLAYER_PRESETS } from '../sim/types';

describe('Physical Attributes and Continuous Sprint Curve Models', () => {
  it('computes continuous Sprint Curve Index (κ) smoothly from attributes without discontinuities', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);

    // Balanced Pro
    sim.setAttributes(PLAYER_PRESETS.balanced);
    const kappaBalanced = sim.getCurrentState().curveIndex;
    expect(Math.abs(kappaBalanced)).toBeLessThanOrEqual(0.05);

    // Explosive Agilist (Messi / Bernardo)
    sim.setAttributes(PLAYER_PRESETS.explosive_agilist);
    const kappaExplosive = sim.getCurrentState().curveIndex;
    expect(kappaExplosive).toBeGreaterThan(0.15);
    expect(kappaExplosive).toBeLessThanOrEqual(0.30);

    // Lengthy Powerhouse (Haaland / Van Dijk)
    sim.setAttributes(PLAYER_PRESETS.lengthy_powerhouse);
    const kappaLengthy = sim.getCurrentState().curveIndex;
    expect(kappaLengthy).toBeLessThan(-0.15);
    expect(kappaLengthy).toBeGreaterThanOrEqual(-0.30);

    console.log(`κ Balanced: ${kappaBalanced.toFixed(3)}`);
    console.log(`κ Explosive: ${kappaExplosive.toFixed(3)}`);
    console.log(`κ Lengthy: ${kappaLengthy.toFixed(3)}`);
  });

  it('demonstrates Explosive vs Lengthy dynamics: Explosive bursts earlier, Lengthy sustains into high speeds', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // 1. Explosive Agilist run
    const simExplosive = new SimulationCore(Vector2.zero(), 0);
    simExplosive.setAttributes(PLAYER_PRESETS.explosive_agilist);

    let timeExplosive10m: number | null = null;
    let speedAt05sExplosive = 0;

    for (let t = 0; t <= 5.5; t += dt) {
      simExplosive.step(sprintIntent, dt);
      const state = simExplosive.getCurrentState();
      if (Math.abs(t - 0.5) < dt / 2) speedAt05sExplosive = state.velocity.length();
      if (timeExplosive10m === null && state.position.x >= 10.0) timeExplosive10m = t;
    }

    // 2. Lengthy Powerhouse run
    const simLengthy = new SimulationCore(Vector2.zero(), 0);
    simLengthy.setAttributes(PLAYER_PRESETS.lengthy_powerhouse);

    let timeLengthy10m: number | null = null;
    let speedAt05sLengthy = 0;
    let topSpeedLengthy = 0;

    for (let t = 0; t <= 5.5; t += dt) {
      simLengthy.step(sprintIntent, dt);
      const state = simLengthy.getCurrentState();
      const spd = state.velocity.length();
      if (spd > topSpeedLengthy) topSpeedLengthy = spd;
      if (Math.abs(t - 0.5) < dt / 2) speedAt05sLengthy = state.velocity.length();
      if (timeLengthy10m === null && state.position.x >= 10.0) timeLengthy10m = t;
    }

    console.log(`--- Explosive vs Lengthy Benchmark ---`);
    console.log(`Explosive 0.5s Speed: ${speedAt05sExplosive.toFixed(2)} m/s, 10m Split: ${timeExplosive10m?.toFixed(3)} s`);
    console.log(`Lengthy 0.5s Speed:   ${speedAt05sLengthy.toFixed(2)} m/s, 10m Split: ${timeLengthy10m?.toFixed(3)} s`);
    console.log(`Lengthy Top Speed:    ${topSpeedLengthy.toFixed(2)} m/s (${(topSpeedLengthy * 3.6).toFixed(1)} km/h)`);

    // Explosive player must have higher initial blastoff burst and reach 10m faster
    expect(speedAt05sExplosive).toBeGreaterThan(speedAt05sLengthy);
    expect(timeExplosive10m!).toBeLessThan(timeLengthy10m!);

    // Lengthy powerhouse must reach higher terminal speed (Haaland top end)
    expect(topSpeedLengthy).toBeGreaterThan(simExplosive.getCurrentState().velocity.length());
  });

  it('scales stride length with player height (inverted pendulum leg geometry)', () => {
    const simShort = new SimulationCore(Vector2.zero(), 0);
    simShort.setAttributes({ ...PLAYER_PRESETS.balanced, heightCm: 170 });

    const simTall = new SimulationCore(Vector2.zero(), 0);
    simTall.setAttributes({ ...PLAYER_PRESETS.balanced, heightCm: 194 });

    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const jogIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    // Compare at steady jog speed so height-driven cadence differences are
    // measured independently of the players' different acceleration curves.
    for (let t = 0; t < 4.0; t += dt) {
      simShort.step(jogIntent, dt);
      simTall.step(jogIntent, dt);
    }

    const shortState = simShort.getCurrentState();
    const tallState = simTall.getCurrentState();
    const shortStride = shortState.stride.strideLength;
    const tallStride = tallState.stride.strideLength;

    console.log(`Short (170cm) Stride: ${shortStride.toFixed(3)} m`);
    console.log(`Tall (194cm) Stride:  ${tallStride.toFixed(3)} m`);

    // Taller player must have visibly and measurably longer stride lengths
    expect(tallStride).toBeGreaterThan(shortStride);
    expect(tallStride / shortStride).toBeCloseTo(Math.sqrt(194 / 170), 1);
    expect(shortStride * shortState.stride.cadence).toBeCloseTo(shortState.velocity.length(), 1);
    expect(tallStride * tallState.stride.cadence).toBeCloseTo(tallState.velocity.length(), 1);
  });

  it('cycles presets deterministically through all 5 archetypes', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);

    expect(sim.getCurrentState().attributes.name).toBe(PLAYER_PRESETS.balanced.name);

    const p1 = sim.cyclePreset();
    expect(p1.name).toBe(PLAYER_PRESETS.explosive_agilist.name);

    const p2 = sim.cyclePreset();
    expect(p2.name).toBe(PLAYER_PRESETS.lengthy_powerhouse.name);

    const p3 = sim.cyclePreset();
    expect(p3.name).toBe(PLAYER_PRESETS.speed_demon.name);

    const p4 = sim.cyclePreset();
    expect(p4.name).toBe(PLAYER_PRESETS.heavy_anchor.name);

    const p5 = sim.cyclePreset();
    expect(p5.name).toBe(PLAYER_PRESETS.balanced.name);
  });
});
