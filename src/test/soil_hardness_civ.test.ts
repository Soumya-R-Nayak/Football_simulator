import { describe, it, expect } from 'vitest';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { BALL_PRESETS } from '../sim/types';
import { Vector3 } from '../math/Vector3';

describe('Item 4: Soil Compaction & Hardness (Clegg Impact Value - CIV)', () => {
  it('modulates Clegg Impact Value across pitch tiers and moisture extremes (STRI standards)', () => {
    // 1. Tier 1 Elite Hybrid (Sand Carpet)
    const tier1 = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const t1EquilibriumCiv = tier1.getCleggHardness();
    expect(t1EquilibriumCiv).toBeCloseTo(78.0, 1);

    // Dry Tier 1 sand
    tier1.setBaseMoisture(0.05);
    const t1DryCiv = tier1.getCleggHardness();
    // Wet Tier 1 sand
    tier1.setBaseMoisture(0.85);
    const t1WetCiv = tier1.getCleggHardness();

    console.log(
      `Tier 1 Hybrid Sand CIV -> Dry (5%): ${t1DryCiv.toFixed(1)} | Eq (22%): ${t1EquilibriumCiv.toFixed(1)} | Wet (85%): ${t1WetCiv.toFixed(1)}`
    );
    // Sand rootzone maintains tight stability (within 70 - 90 optimal range)
    expect(t1DryCiv).toBeLessThan(95.0);
    expect(t1WetCiv).toBeGreaterThan(70.0);

    // 2. Tier 4 Grassroots Native Clay
    const tier4 = new PitchSurface(24.0, 'tier4_grassroots_clay');
    const t4EquilibriumCiv = tier4.getCleggHardness();
    expect(t4EquilibriumCiv).toBeCloseTo(58.0, 1);

    // Bone dry clay: bakes into rock-hard hardpan
    tier4.setBaseMoisture(0.05);
    const t4DryCiv = tier4.getCleggHardness();

    // Saturated clay: plasticizes into soft mud
    tier4.setBaseMoisture(0.85);
    const t4WetCiv = tier4.getCleggHardness();

    console.log(
      `Tier 4 Native Clay CIV -> Dry (5%): ${t4DryCiv.toFixed(1)} | Eq (35%): ${t4EquilibriumCiv.toFixed(1)} | Wet (85%): ${t4WetCiv.toFixed(1)}`
    );

    // Clay exhibits massive moisture sensitivity:
    // Dry baked clay must exceed 105 CIV (hardpan)
    expect(t4DryCiv).toBeGreaterThan(105.0);
    // Saturated clay must plunge below 40 CIV (soft mud)
    expect(t4WetCiv).toBeLessThan(40.0);
  });

  it('amplifies vertical ball rebound on baked hardpan and damps rebound on soft muddy ground', () => {
    const dt = 1 / 120;
    const dropHeight = 2.0; // meters

    // 1. Drop on Dry Baked Tier 4 Clay (CIV > 110)
    const dryPitch = new PitchSurface(24.0, 'tier4_grassroots_clay');
    dryPitch.setBaseMoisture(0.05);
    const hardBall = new BallPhysics(new Vector3(0, 0, dropHeight), BALL_PRESETS.modern_match);

    let hardApex = 0;
    let hardBounced = false;
    for (let t = 0; t <= 1.2; t += dt) {
      const state = hardBall.step(dt, t, dryPitch);
      if (state.velocity.z > 0.05) hardBounced = true;
      if (hardBounced && state.position.z > hardApex) hardApex = state.position.z;
    }

    // 2. Drop on Saturated Tier 4 Mud (CIV < 40)
    const wetPitch = new PitchSurface(24.0, 'tier4_grassroots_clay');
    wetPitch.setBaseMoisture(0.85);
    const softBall = new BallPhysics(new Vector3(0, 0, dropHeight), BALL_PRESETS.modern_match);

    let softApex = 0;
    let softBounced = false;
    for (let t = 0; t <= 1.2; t += dt) {
      const state = softBall.step(dt, t, wetPitch);
      if (state.velocity.z > 0.05) softBounced = true;
      if (softBounced && state.position.z > softApex) softApex = state.position.z;
    }

    console.log(
      `2.0m Drop Rebound Apex -> Baked Hardpan: ${hardApex.toFixed(3)} m | Soft Mud: ${softApex.toFixed(3)} m`
    );

    // Hard ground rebound must be significantly higher than soft mud rebound
    expect(hardApex).toBeGreaterThan(softApex);
    expect(hardApex - softApex).toBeGreaterThan(0.20); // At least 20 cm higher bounce
  });

  it('modulates rolling friction: hard ground enables longer glide while soft ground causes sinkage drag', () => {
    const dt = 1 / 120;
    const kickSpeed = 10.0; // 10 m/s ground pass

    // 1. Roll on Hard Ground (Tier 4, dry)
    const hardPitch = new PitchSurface(24.0, 'tier4_grassroots_clay');
    hardPitch.setBaseMoisture(0.05);
    const ballHard = new BallPhysics(new Vector3(0, 0, 0.11), BALL_PRESETS.modern_match);
    ballHard.kick(kickSpeed, 0, 0, 0, 0);

    let tHard = 0;
    while (ballHard.getState().flightState !== 'at_rest' && tHard < 10.0) {
      ballHard.step(dt, tHard, hardPitch);
      tHard += dt;
    }
    const distHard = ballHard.getState().position.x;

    // 2. Roll on Standard Regulation Firm Pitch (Tier 1, eq moisture)
    const stdPitch = new PitchSurface(24.0, 'tier1_elite_hybrid');
    const ballStd = new BallPhysics(new Vector3(0, 0, 0.11), BALL_PRESETS.modern_match);
    ballStd.kick(kickSpeed, 0, 0, 0, 0);

    let tStd = 0;
    while (ballStd.getState().flightState !== 'at_rest' && tStd < 10.0) {
      ballStd.step(dt, tStd, stdPitch);
      tStd += dt;
    }
    const distStd = ballStd.getState().position.x;

    console.log(
      `10 m/s Ground Pass Distance -> Baked Hardpan: ${distHard.toFixed(2)} m | Standard Hybrid: ${distStd.toFixed(2)} m`
    );

    // Ball on baked hard ground should roll further than on standard cushioned hybrid turf
    expect(distHard).toBeGreaterThan(distStd);
  });

  it('accounts for soil hardness in cleat stud traction: FG studs suffer on baked crust and in deep mud', () => {
    const hardPitch = new PitchSurface(24.0, 'tier4_grassroots_clay');
    hardPitch.setBaseMoisture(0.05); // Baked hardpan (CIV > 110)

    const fgHardTraction = hardPitch.getStudHardnessTractionFactor(0, 0, 'fg_plastic');
    const sgHardTraction = hardPitch.getStudHardnessTractionFactor(0, 0, 'sg_metal');

    console.log(
      `Hardpan Stud Penetration Factor -> FG Plastic: ${fgHardTraction.toFixed(2)} | SG Metal: ${sgHardTraction.toFixed(2)}`
    );
    // FG plastic studs cannot bite into baked hard clay, suffering greater penalty than metal
    expect(fgHardTraction).toBeLessThan(1.0);
    expect(fgHardTraction).toBeLessThan(sgHardTraction);

    const mudPitch = new PitchSurface(24.0, 'tier4_grassroots_clay');
    mudPitch.setBaseMoisture(0.85); // Mud (CIV < 40)

    const fgMudTraction = mudPitch.getStudHardnessTractionFactor(0, 0, 'fg_plastic');
    const sgMudTraction = mudPitch.getStudHardnessTractionFactor(0, 0, 'sg_metal');

    console.log(
      `Soft Mud Stud Factor -> FG Plastic: ${fgMudTraction.toFixed(2)} | SG Metal: ${sgMudTraction.toFixed(2)}`
    );
    // In soft mud, plastic studs slip heavily while SG metal bites deep
    expect(fgMudTraction).toBeLessThan(sgMudTraction);
  });
});
