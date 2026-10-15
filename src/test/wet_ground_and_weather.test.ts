import { describe, expect, it } from 'vitest';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent, TurfCondition } from '../sim/types';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { BallPhysics } from '../sim/physics/BallPhysics';

describe('Wet Ground, Puddle Hydrodynamics & Weather Edge-Case Rigor', () => {
  it('Edge Case 1: Rapid weather and turf condition switching maintains complete puddle and rain synchronization', () => {
    const sim = new SimulationCore(new Vector2(0, 0), 0);
    const conditions: TurfCondition[] = ['standard', 'wet_slick', 'dry_heavy'];

    // Fuzz 150 consecutive rapid turf condition toggles
    for (let i = 0; i < 150; i++) {
      const targetCond = conditions[i % conditions.length];
      sim.setTurfCondition(targetCond);
      const pitch = sim.getPitchSurface();
      const puddles = pitch.getPuddles();
      const rain = pitch.getPrecipitation();
      const baseMoisture = pitch.getBaseMoisture();

      expect(baseMoisture).toBeGreaterThanOrEqual(0.0);
      expect(baseMoisture).toBeLessThanOrEqual(1.0);

      if (targetCond === 'wet_slick') {
        expect(puddles.length).toBeGreaterThan(0);
        expect(rain).toBe(15.0);
        expect(baseMoisture).toBe(0.65);
      } else if (targetCond === 'dry_heavy') {
        expect(puddles.length).toBe(0);
        expect(rain).toBe(0.0);
        expect(baseMoisture).toBe(0.10);
      } else {
        expect(puddles.length).toBe(0);
        expect(rain).toBe(0.0);
        expect(baseMoisture).toBe(0.25);
      }
    }
  });

  it('Edge Case 2: Puddle boundary thresholds automatically clear standing water when moisture drops below 0.60', () => {
    const pitch = new PitchSurface(24.0);

    // Spawn puddles at saturated moisture
    pitch.setBaseMoisture(0.90);
    pitch.spawnNaturalPuddles();
    expect(pitch.getPuddles().length).toBeGreaterThan(0);

    // Set moisture to 0.65 (slick turf threshold): puddles remain
    pitch.setBaseMoisture(0.65);
    expect(pitch.getPuddles().length).toBeGreaterThan(0);

    // Set moisture to 0.599 (just below 0.60 threshold): puddles MUST auto-clear
    pitch.setBaseMoisture(0.599);
    expect(pitch.getPuddles().length).toBe(0);

    // Test cycleMoisture: 0.10 -> 0.30 -> 0.65 -> 0.90 (spawns) -> 0.10 (clears)
    pitch.setBaseMoisture(0.10);
    expect(pitch.getPuddles().length).toBe(0);

    pitch.cycleMoisture(); // to 0.30
    expect(pitch.getBaseMoisture()).toBe(0.30);
    expect(pitch.getPuddles().length).toBe(0);

    pitch.cycleMoisture(); // to 0.65
    expect(pitch.getBaseMoisture()).toBe(0.65);
    expect(pitch.getPuddles().length).toBe(0);

    pitch.cycleMoisture(); // to 0.90
    expect(pitch.getBaseMoisture()).toBe(0.90);
    expect(pitch.getPuddles().length).toBeGreaterThan(0);

    pitch.cycleMoisture(); // back to 0.10
    expect(pitch.getBaseMoisture()).toBe(0.10);
    expect(pitch.getPuddles().length).toBe(0);
  });

  it('Edge Case 3: Prolonged straight-line sprint on wet turf with FG molded plastic studs prevents divot spam and stumbles', () => {
    const sim = new SimulationCore(new Vector2(0, 0), 0);
    sim.setTurfCondition('wet_slick');
    sim.setStudType('fg_plastic');

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let slipCount = 0;
    // Sprint for 5 full seconds (600 simulation frames at 120 Hz)
    for (let i = 0; i < 600; i++) {
      sim.step(sprintIntent, SIM_CONFIG.LOOP.FIXED_DT);
      const s = sim.getCurrentState().slipStatus;
      if (s.type !== 'none') {
        slipCount++;
      }
    }

    const state = sim.getCurrentState();
    const divots = sim.getPitchSurface().getDivots();

    // Proprioceptive Coulomb clamping prevents continuous stumble feedback loops
    expect(slipCount).toBe(0);
    expect(state.velocity.x).toBeGreaterThan(6.0); // Achieves solid sprint speed
    expect(divots.length).toBe(0); // Molded FG studs on wet grass do NOT tear rootzone divots

    // Switch to SG metal studs mid-stride: traction immediately bites deeper
    sim.setStudType('sg_metal');
    const prevSpeed = state.velocity.length();
    for (let i = 0; i < 120; i++) {
      sim.step(sprintIntent, SIM_CONFIG.LOOP.FIXED_DT);
    }
    const newSpeed = sim.getCurrentState().velocity.length();
    expect(newSpeed).toBeGreaterThan(prevSpeed);
  });

  it('Edge Case 4: High-velocity slide directly through standing water puddle creates hydroplaning wake and halts safely', () => {
    const sim = new SimulationCore(new Vector2(-12, 0), 0);
    sim.setTurfCondition('wet_slick');
    sim.setStudType('sg_metal');

    // Add deep puddle in the direct path
    sim.getPitchSurface().addPuddle(new Vector2(0, 0), 12.0, 0.95);

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Accelerate to top sprint speed toward puddle
    for (let i = 0; i < 180; i++) {
      sim.step(sprintIntent, SIM_CONFIG.LOOP.FIXED_DT);
    }

    expect(sim.getCurrentState().velocity.length()).toBeGreaterThan(6.5);

    // Trigger slide directly into the puddle
    const slideIntent: Intent = {
      ...sprintIntent,
      requestSlide: true,
    };
    sim.step(slideIntent, SIM_CONFIG.LOOP.FIXED_DT);
    expect(sim.getCurrentState().slipStatus.type).toBe('controlled_slide');

    // Slide through puddle until halted
    const passiveIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let i = 0; i < 300; i++) {
      sim.step(passiveIntent, SIM_CONFIG.LOOP.FIXED_DT);
    }

    const ruts = sim.getRuts();
    expect(ruts.length).toBeGreaterThan(0);
    const lastRut = ruts[ruts.length - 1];

    // Rut created in puddle should reflect waterlogged hydrodynamic status
    expect(lastRut.moisture).toBeGreaterThanOrEqual(0.70);
    expect(lastRut.isWaterlogged).toBe(true);
    expect(lastRut.depth).toBeLessThanOrEqual(0.025); // Hydroplaning cushions soil penetration

    // Final velocity is at rest, no NaNs
    expect(sim.getCurrentState().velocity.length()).toBeLessThan(0.05);
    expect(Number.isNaN(sim.getCurrentState().position.x)).toBe(false);
    expect(Number.isNaN(sim.getCurrentState().position.y)).toBe(false);
  });

  it('Edge Case 5: Ball crossing waterlogged hydroplane wake experiences smooth rolling without erratic aerial hops', () => {
    const pitch = new PitchSurface(24.0);
    pitch.setBaseMoisture(0.85);

    // Create a waterlogged rut at x = 10, y in [-2, 2]
    pitch.createRut(new Vector2(10.0, -2.0), new Vector2(10.0, 2.0), 0.85, 0.0);

    const ball = new BallPhysics();
    ball.reset(new Vector3(5.0, 0.0, ball.radius));
    ball.kick(12.0, 0.0, 0.0, 0, 0);

    const dt = 1 / 120;
    let maxAltitude = 0;

    for (let i = 0; i < 200; i++) {
      ball.step(dt, i * dt, pitch);
      const alt = ball.getState().position.z;
      if (alt > maxAltitude) maxAltitude = alt;
    }

    // In a waterlogged track, fluid cushion dampens rut collision kick (< 14 cm vs ball radius 11 cm)
    expect(maxAltitude).toBeLessThan(0.14);
  });

  it('Edge Case 6: Torrential storm stress test on degraded grassroots clay maintains numerical determinism', () => {
    const sim = new SimulationCore(new Vector2(0, 0), 0);
    sim.setPitchTier('tier4_grassroots_clay');
    sim.setPrecipitation(35); // Torrential downpour
    sim.setBaseMoisture(1.0); // Maximum waterlogging
    sim.setWind({ speed: 13, heading: Math.PI / 4, gustIntensity: 0.35 }); // Gale wind

    const stressIntent: Intent = {
      moveDir: new Vector2(1, 1).normalize(),
      faceDir: new Vector2(-1, 0),
      gait: 'sprint',
      holdFacing: true,
      manualTurn: 0.5,
    };

    // Run 1000 physics steps in extreme compound weather
    for (let i = 0; i < 1000; i++) {
      sim.step(stressIntent, SIM_CONFIG.LOOP.FIXED_DT);
      const state = sim.getCurrentState();
      const ball = sim.getBallState();

      expect(Number.isNaN(state.position.x)).toBe(false);
      expect(Number.isNaN(state.position.y)).toBe(false);
      expect(Number.isNaN(state.velocity.x)).toBe(false);
      expect(Number.isNaN(state.velocity.y)).toBe(false);
      expect(Number.isNaN(ball.position.x)).toBe(false);
      expect(Number.isNaN(ball.position.y)).toBe(false);
      expect(Number.isNaN(ball.position.z)).toBe(false);
    }
  });
});
