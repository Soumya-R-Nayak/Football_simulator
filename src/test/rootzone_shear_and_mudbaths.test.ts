import { describe, it, expect } from 'vitest';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { SimulationCore } from '../sim/SimulationCore';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { Intent } from '../sim/types';

describe('Item 5: Rootzone Shear Endurance & Dynamic Mudbath Degradation', () => {
  it('differentiates sod tear dimensions based on synthetic fiber reinforcement vs native clay roots', () => {
    // 1. Tier 1 Hybrid Pitch (stitched synthetic fibers)
    const hybrid = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const hybridDivot = hybrid.createDivot(new Vector2(0, 0), 0, 0.8, 0);

    // 2. Tier 4 Grassroots Clay Pitch (shallow native roots)
    const clay = new PitchSurface(24.0, 'tier4_grassroots_clay');
    const clayDivot = clay.createDivot(new Vector2(0, 0), 0, 0.8, 0);

    console.log(
      `Sod Tear Comparison (80% Severity) -> Hybrid: r=${(hybridDivot.radius * 100).toFixed(1)}cm, depth=${(hybridDivot.depth * 100).toFixed(1)}cm | Clay: r=${(clayDivot.radius * 100).toFixed(1)}cm, depth=${(clayDivot.depth * 100).toFixed(1)}cm`
    );

    // Hybrid synthetic stitching restricts scar radius to minimal scuffs (<= 5.0 cm)
    expect(hybridDivot.radius).toBeLessThanOrEqual(0.05);
    // Grassroots clay tears noticeable sod gouges (>= 10.0 cm)
    expect(clayDivot.radius).toBeGreaterThanOrEqual(0.10);
    // Clay divot depth is significantly deeper than hybrid
    expect(clayDivot.depth).toBeGreaterThan(hybridDivot.depth * 2.5);
  });

  it('prevents sod tears on Tier 1 hybrid during aggressive 7 m/s² cuts while Tier 4 clay tears easily', () => {
    const dt = 1 / 120;

    // Simulation on Tier 1 Hybrid
    const simHybrid = new SimulationCore(new Vector2(0, 0), 0);
    simHybrid.setPitchTier('tier1_elite_hybrid');
    simHybrid.clearPitchDamage();

    // Simulation on Tier 4 Clay
    const simClay = new SimulationCore(new Vector2(0, 0), 0);
    simClay.setPitchTier('tier4_grassroots_clay');
    simClay.clearPitchDamage();

    // Accelerate both players to sprint speed (~7.5 m/s) along +X
    for (let t = 0; t <= 1.8; t += dt) {
      const intentSprint: Intent = { moveDir: new Vector2(1, 0), gait: 'sprint' };
      simHybrid.step(intentSprint, dt);
      simClay.step(intentSprint, dt);
    }

    // Execute sharp 90° plant cut toward +Y (produces ~7-8 m/s² lateral acceleration)
    for (let t = 0; t <= 0.8; t += dt) {
      const intentCut: Intent = { moveDir: new Vector2(0, 1), gait: 'sprint' };
      simHybrid.step(intentCut, dt);
      simClay.step(intentCut, dt);
    }

    const hybridDivots = simHybrid.getPitchSurfaceState().divotsCount;
    const clayDivots = simClay.getPitchSurfaceState().divotsCount;

    console.log(`90° Plant Cut Divot Tears -> Tier 1 Hybrid: ${hybridDivots} | Tier 4 Clay: ${clayDivots}`);

    // Tier 1 reinforced hybrid sod threshold is 13.5 m/s² -> 0 sod tears
    expect(hybridDivots).toBe(0);
    // Tier 4 clay threshold is 5.2 m/s² -> tore sod upon planting
    expect(clayDivots).toBeGreaterThanOrEqual(1);
  });

  it('simulates 90-minute wet match traffic: Tier 1 hybrid resists wear while Tier 4 clay degrades into a mudbath', () => {
    // 1. Tier 1 Hybrid in heavy rain
    const hybrid = new PitchSurface(24.0, 'tier1_elite_hybrid');
    hybrid.setBaseMoisture(0.70);
    hybrid.simulateMatchTraffic(90, 1.0); // Full 90-minute match

    const hybridAvgWear = hybrid.getAverageWear();
    const hybridGoalmouthWear = hybrid.getWearAt(-51.5, 0);
    const hybridPuddles = hybrid.getState().puddlesCount;

    // 2. Tier 4 Clay in heavy rain
    const clay = new PitchSurface(24.0, 'tier4_grassroots_clay');
    clay.setBaseMoisture(0.70);
    clay.simulateMatchTraffic(90, 1.0);

    const clayAvgWear = clay.getAverageWear();
    const clayGoalmouthWear = clay.getWearAt(-51.5, 0);
    const clayPuddles = clay.getState().puddlesCount;

    console.log('--- 90-Minute Wet Match Degradation Benchmark ---');
    console.log(
      `Tier 1 Hybrid -> Avg Wear: ${(hybridAvgWear * 100).toFixed(1)}%, Goalmouth Wear: ${(hybridGoalmouthWear * 100).toFixed(1)}%, Puddles: ${hybridPuddles}`
    );
    console.log(
      `Tier 4 Clay   -> Avg Wear: ${(clayAvgWear * 100).toFixed(1)}%, Goalmouth Wear: ${(clayGoalmouthWear * 100).toFixed(1)}%, Puddles: ${clayPuddles}`
    );

    // Hybrid pitch wear remains well contained (< 1% global avg wear, < 25% in goalmouth)
    expect(hybridAvgWear).toBeLessThan(0.01);
    expect(hybridGoalmouthWear).toBeLessThan(0.25);
    expect(hybridPuddles).toBe(0);

    // Clay pitch turns into a mudbath: 10x higher global wear, complete goalmouth destruction (100% wear)
    expect(clayAvgWear).toBeGreaterThan(0.025);
    expect(clayAvgWear).toBeGreaterThan(hybridAvgWear * 8);
    expect(clayGoalmouthWear).toBeGreaterThan(0.70);
    // Muddy standing water puddles form in the goalmouths on degraded clay
    expect(clayPuddles).toBeGreaterThanOrEqual(2);
  });

  it('modulates cleat rut furrow depth by pitch tier rootzone resistance', () => {
    const hybrid = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const rutHybrid = hybrid.createRut(new Vector2(0, 0), new Vector2(3, 0), 0.7, 0);

    const clay = new PitchSurface(24.0, 'tier4_grassroots_clay');
    const rutClay = clay.createRut(new Vector2(0, 0), new Vector2(3, 0), 0.7, 0);

    console.log(
      `Rut Furrow Depth -> Hybrid: ${(rutHybrid.depth * 100).toFixed(2)} cm | Clay: ${(rutClay.depth * 100).toFixed(2)} cm`
    );

    // Hybrid restricts furrow depth to shallow scuff (<= 1.5 cm)
    expect(rutHybrid.depth).toBeLessThanOrEqual(0.015);
    // Grassroots clay gouges deep into wet soil (>= 3.5 cm)
    expect(rutClay.depth).toBeGreaterThanOrEqual(0.035);
  });

  it('normalizes footstep wear by stride cadence and pitch tier, eliminating 1/v starting crater artifacts', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Tier 1 Hybrid Sprint from Dead Rest
    const simHybrid = new SimulationCore(new Vector2(0, 0), 0);
    const hybridSurface = simHybrid.getPitchSurface();
    hybridSurface.setPitchTier('tier1_elite_hybrid');

    const sprintEast: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Accelerate from 0 to top speed over 2.0 seconds
    for (let t = 0; t <= 2.0; t += dt) {
      simHybrid.step(sprintEast, dt);
    }

    // Inspect wear in the initial starting acceleration zone (x in [0, 2]m)
    let maxStartWearHybrid = 0;
    for (let x = 0; x <= 2.0; x += 0.25) {
      maxStartWearHybrid = Math.max(maxStartWearHybrid, hybridSurface.getWearAt(x, 0));
    }

    // Inspect wear in the cruising high-speed zone (x in [8, 12]m)
    let maxCruiseWearHybrid = 0;
    for (let x = 8.0; x <= 12.0; x += 0.25) {
      maxCruiseWearHybrid = Math.max(maxCruiseWearHybrid, hybridSurface.getWearAt(x, 0));
    }

    console.log('--- Tier 1 Hybrid Sprint Wear Analysis ---');
    console.log(`Peak Start Wear (0-2m):    ${(maxStartWearHybrid * 100).toFixed(3)}%`);
    console.log(`Peak Cruise Wear (8-12m): ${(maxCruiseWearHybrid * 100).toFixed(3)}%`);

    // Tier 1 Hybrid starting wear must not create a dark crater (< 1.5% wear from a single sprint)
    expect(maxStartWearHybrid).toBeLessThan(0.015);
    // Start wear vs cruise wear ratio must be bounded (< 3.5x, reflecting real propulsive shear, not a 15x dwell artifact)
    if (maxCruiseWearHybrid > 0) {
      const wearRatio = maxStartWearHybrid / maxCruiseWearHybrid;
      console.log(`Start/Cruise Wear Ratio:    ${wearRatio.toFixed(2)}x`);
      expect(wearRatio).toBeLessThan(3.5);
    }

    // 2. Tier 4 Grassroots Clay in Rain under Identical Sprint
    const simClay = new SimulationCore(new Vector2(0, 0), 0);
    const claySurface = simClay.getPitchSurface();
    claySurface.setPitchTier('tier4_grassroots_clay');
    claySurface.setBaseMoisture(0.70);

    for (let t = 0; t <= 2.0; t += dt) {
      simClay.step(sprintEast, dt);
    }

    let maxStartWearClay = 0;
    for (let x = 0; x <= 2.0; x += 0.25) {
      maxStartWearClay = Math.max(maxStartWearClay, claySurface.getWearAt(x, 0));
    }

    console.log('--- Tier 4 Wet Clay Sprint Wear Analysis ---');
    console.log(`Peak Start Wear (0-2m):    ${(maxStartWearClay * 100).toFixed(3)}%`);

    // Tier 4 clay must experience much higher wear than Tier 1 hybrid (> 8x)
    expect(maxStartWearClay).toBeGreaterThan(maxStartWearHybrid * 8.0);
  });
});

