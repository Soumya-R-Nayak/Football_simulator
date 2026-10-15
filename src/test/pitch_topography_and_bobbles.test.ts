import { describe, expect, it } from 'vitest';
import { Vector3 } from '../math/Vector3';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { BALL_PRESETS } from '../sim/types';

describe('Item 2: Ground Planarity & Micro-Topography Grid (Bumps / Dips)', () => {
  it('generates deterministic heightfield with roughness proportional to pitch tier', () => {
    const pitchT1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const pitchT4 = new PitchSurface(24.0, 'tier4_grassroots_clay');

    let maxDevT1 = 0;
    let maxDevT4 = 0;

    // Sample across midfield (-20m to +20m)
    for (let x = -20; x <= 20; x += 1.0) {
      for (let y = -15; y <= 15; y += 1.0) {
        maxDevT1 = Math.max(maxDevT1, Math.abs(pitchT1.getTopographyHeight(x, y)));
        maxDevT4 = Math.max(maxDevT4, Math.abs(pitchT4.getTopographyHeight(x, y)));
      }
    }

    console.log(`--- Pitch Planarity & Topography Benchmark ---`);
    console.log(`Tier 1 Max Height Deviation: ${(maxDevT1 * 1000).toFixed(2)} mm (FIFA Quality Pro standard)`);
    console.log(`Tier 4 Max Height Deviation: ${(maxDevT4 * 1000).toFixed(2)} mm (Grassroots rough bumpy standard)`);

    // Tier 1 laser-leveled hybrid has deviations <= 2.5 mm
    expect(maxDevT1).toBeLessThan(0.003);

    // Tier 4 grassroots clay has prominent bumps and dips exceeding 20 mm
    expect(maxDevT4).toBeGreaterThan(0.020);
    expect(maxDevT4).toBeGreaterThan(maxDevT1 * 8.0);
  });

  it('keeps rolling ball smooth and flat on Tier 1 while producing authentic micro-hops and bobbles on Tier 4', () => {
    const dt = 1 / 120; // 120 Hz
    const simSteps = 180; // 1.5 seconds of roll

    // 1. Tier 1 Elite Pitch
    const pitchT1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const ballT1 = new BallPhysics(new Vector3(-20, 5, 0.11), BALL_PRESETS.modern_match, 'standard');
    ballT1.kick(14.0, 0.0, 0.0, 0.0, 0.0); // 14 m/s ground strike heading East (+X)

    let hopsCountT1 = 0;
    let maxAltitudeT1 = 0.11;

    for (let i = 0; i < simSteps; i++) {
      const state = ballT1.step(dt, i * dt, pitchT1);
      if (state.flightState === 'bounce') {
        hopsCountT1++;
      }
      maxAltitudeT1 = Math.max(maxAltitudeT1, state.position.z);
    }

    // 2. Tier 4 Grassroots Bumpy Pitch
    const pitchT4 = new PitchSurface(24.0, 'tier4_grassroots_clay');
    const ballT4 = new BallPhysics(new Vector3(-20, 5, 0.11), BALL_PRESETS.modern_match, 'standard');
    ballT4.kick(14.0, 0.0, 0.0, 0.0, 0.0); // identical 14 m/s ground strike

    let hopsCountT4 = 0;
    let maxAltitudeT4 = 0.11;

    for (let i = 0; i < simSteps; i++) {
      const state = ballT4.step(dt, i * dt, pitchT4);
      if (state.flightState === 'bounce') {
        hopsCountT4++;
      }
      maxAltitudeT4 = Math.max(maxAltitudeT4, state.position.z);
    }

    console.log(`--- 14 m/s Ground Pass Bobble Comparison ---`);
    console.log(`Tier 1: Hops/Bounces = ${hopsCountT1}, Max Altitude = ${(maxAltitudeT1 * 100).toFixed(2)} cm`);
    console.log(`Tier 4: Hops/Bounces = ${hopsCountT4}, Max Altitude = ${(maxAltitudeT4 * 100).toFixed(2)} cm`);

    // Tier 1 pitch ball glides with zero micro-hops (stays on turf level)
    expect(hopsCountT1).toBe(0);
    expect(maxAltitudeT1).toBeLessThanOrEqual(0.115);

    // Tier 4 pitch ball pops over bumps into micro-hops (bobbles)
    expect(hopsCountT4).toBeGreaterThan(0);
    expect(maxAltitudeT4).toBeGreaterThan(0.125); // At least 1.5 cm above resting radius
  });
});
