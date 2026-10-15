import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SimulationCore } from '../sim/SimulationCore';
import { PitchSurface } from '../sim/physics/PitchSurface';

describe('Item 1: Pitch Quality Tiers & Realistic Drainage Hydrology', () => {
  it('initializes pitch tiers with authentic agronomic and hydrological specifications', () => {
    const pitchT1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    expect(pitchT1.getPitchTier().tier).toBe(1);
    expect(pitchT1.getPitchTier().gravityDrainageMmH).toBe(50.0);
    expect(pitchT1.getPitchTier().vacuumDrainageMmH).toBe(30.0);
    expect(pitchT1.getPitchTier().rootShearStrengthNm).toBe(58.0);

    const pitchT4 = new PitchSurface(24.0, 'tier4_grassroots_clay');
    expect(pitchT4.getPitchTier().tier).toBe(4);
    expect(pitchT4.getPitchTier().gravityDrainageMmH).toBe(0.8);
    expect(pitchT4.getPitchTier().vacuumDrainageMmH).toBe(0.0);
    expect(pitchT4.getPitchTier().rootShearStrengthNm).toBe(22.0);
  });

  it('demonstrates that Tier 1 vacuum drainage prevents waterlogging during heavy rain while Tier 4 clay floods', () => {
    // Simulate 15 minutes (900 seconds) of heavy cloudburst rain (35 mm/h)
    const pitchT1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    pitchT1.setPrecipitation(35.0); // 35 mm/h

    const pitchT4 = new PitchSurface(24.0, 'tier4_grassroots_clay');
    pitchT4.setPrecipitation(35.0); // 35 mm/h

    const dt = 0.5; // Timestep for hydrology simulation
    const steps = 900 / dt; // 15 simulated minutes

    for (let i = 0; i < steps; i++) {
      pitchT1.step(dt);
      pitchT4.step(dt);
    }

    const stateT1 = pitchT1.getState();
    const stateT4 = pitchT4.getState();

    console.log(`--- 15-Minute Heavy Rain (35 mm/h) Benchmark ---`);
    console.log(`Tier 1 (SubAir Hybrid) Final Moisture: ${(stateT1.baseMoisture * 100).toFixed(1)}%, Drainage: ${stateT1.drainageRateMmH.toFixed(1)} mm/h`);
    console.log(`Tier 4 (Grassroots Clay) Final Moisture: ${(stateT4.baseMoisture * 100).toFixed(1)}%, Drainage: ${stateT4.drainageRateMmH.toFixed(1)} mm/h`);

    // Tier 1 SubAir active drainage (total capacity 80 mm/h) easily evacuates 35 mm/h rain, keeping moisture low
    expect(stateT1.baseMoisture).toBeLessThan(0.40);
    expect(stateT1.puddlesCount).toBe(0);

    // Tier 4 clay (capacity 0.8 mm/h) is completely overwhelmed, accumulating into waterlogged puddle territory (>= 0.68)
    expect(stateT4.baseMoisture).toBeGreaterThan(0.68);
    expect(stateT4.baseMoisture).toBeGreaterThan(stateT1.baseMoisture + 0.35);
  });

  it('demonstrates rapid puddle evacuation by Tier 1 SubAir vacuum vs. long standing water on Tier 4 clay', () => {
    const pitchT1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    pitchT1.setBaseMoisture(0.85);
    pitchT1.addPuddle(new Vector2(0, 0), 5.0, 0.90);
    pitchT1.setPrecipitation(0.0); // Rain stops

    const pitchT4 = new PitchSurface(24.0, 'tier4_grassroots_clay');
    pitchT4.setBaseMoisture(0.85);
    pitchT4.addPuddle(new Vector2(0, 0), 5.0, 0.90);
    pitchT4.setPrecipitation(0.0); // Rain stops

    // Simulate 5 minutes (300 seconds) of post-rain drainage
    const dt = 0.5;
    const steps = 300 / dt;

    for (let i = 0; i < steps; i++) {
      pitchT1.step(dt);
      pitchT4.step(dt);
    }

    const stateT1 = pitchT1.getState();
    const stateT4 = pitchT4.getState();

    console.log(`--- 5-Minute Post-Rain Drainage Benchmark ---`);
    console.log(`Tier 1 Base Moisture: ${(stateT1.baseMoisture * 100).toFixed(1)}%, Puddles Remaining: ${stateT1.puddlesCount}`);
    console.log(`Tier 4 Base Moisture: ${(stateT4.baseMoisture * 100).toFixed(1)}%, Puddles Remaining: ${stateT4.puddlesCount}`);

    // Tier 1 has drained the standing water puddle below threshold
    expect(stateT1.puddlesCount).toBe(0);
    expect(stateT1.baseMoisture).toBeLessThan(0.65);

    // Tier 4 clay still has persistent standing water
    expect(stateT4.puddlesCount).toBe(1);
    expect(stateT4.baseMoisture).toBeGreaterThan(0.82);
  });

  it('integrates seamlessly with SimulationCore and allows dynamic tier cycling', () => {
    const sim = new SimulationCore();
    expect(sim.getPitchTier().tier).toBe(1);

    const t2 = sim.cyclePitchTier();
    expect(t2.tier).toBe(2);
    expect(t2.id).toBe('tier2_pro_sand');

    const t3 = sim.cyclePitchTier();
    expect(t3.tier).toBe(3);

    const t4 = sim.cyclePitchTier();
    expect(t4.tier).toBe(4);
    expect(t4.id).toBe('tier4_grassroots_clay');

    const t1Again = sim.cyclePitchTier();
    expect(t1Again.tier).toBe(1);

    // Dynamic Precipitation and Wind cycling
    expect(sim.getPrecipitation()).toBe(0);
    expect(sim.cyclePrecipitation()).toBe(15);
    expect(sim.getPrecipitation()).toBe(15);
    expect(sim.cyclePrecipitation()).toBe(35);
    expect(sim.cyclePrecipitation()).toBe(0);

    const w1 = sim.cycleWind();
    expect(w1.speed).toBe(6);
    expect(sim.getWind().speed).toBe(6);
  });
});
