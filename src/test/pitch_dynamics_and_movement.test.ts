import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SimulationCore } from '../sim/SimulationCore';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { Intent } from '../sim/types';

describe('Pitch Dynamics & Movement Effects Subsystem', () => {
  it('modulates ball rolling distance and hydrodynamics in standing water puddles', () => {
    // 1. Dry/Standard ball roll vs Waterlogged puddle ball roll
    const ballDry = new BallPhysics();
    const pitchStandard = new PitchSurface(24.0);
    pitchStandard.setBaseMoisture(0.20); // dry-damp

    const ballWet = new BallPhysics();
    const pitchPuddle = new PitchSurface(24.0);
    pitchPuddle.setBaseMoisture(0.90);
    pitchPuddle.addPuddle(new Vector2(10, 0), 15.0, 0.95); // Deep puddle spanning roll path

    // Launch identical ground passes at 12 m/s
    ballDry.kick(12.0, 0.0, 0.0, 0, 0);
    ballWet.kick(12.0, 0.0, 0.0, 0, 0);

    const dt = 1 / 120;
    let time = 0;
    while (time < 12.0) {
      ballDry.step(dt, time, pitchStandard);
      ballWet.step(dt, time, pitchPuddle);
      time += dt;
    }

    const distDry = ballDry.getState().position.x;
    const distWet = ballWet.getState().position.x;

    console.log(`Standard Turf (20% moisture) Roll Distance: ${distDry.toFixed(2)} m`);
    console.log(`Waterlogged Puddle (90% moisture) Roll Distance: ${distWet.toFixed(2)} m`);

    // Ball entering standing water puddle must decelerate much faster due to fluid displacement drag
    expect(distWet).toBeLessThan(distDry * 0.60);
    expect(distWet).toBeGreaterThan(5.0);
  });

  it('dampens bounce restitution when bouncing into a standing water puddle', () => {
    const ballFirm = new BallPhysics();
    const pitchFirm = new PitchSurface(24.0);
    pitchFirm.setBaseMoisture(0.25);

    const ballPuddle = new BallPhysics();
    const pitchPuddle = new PitchSurface(24.0);
    pitchPuddle.setBaseMoisture(0.95);
    pitchPuddle.addPuddle(new Vector2(0, 0), 5.0, 0.95);

    // Drop from 2.0 meters altitude
    ballFirm.reset(new Vector3(0, 0, 2.0));
    ballPuddle.reset(new Vector3(0, 0, 2.0));

    const dt = 1 / 120;
    let maxApexFirm = 0;
    let maxApexPuddle = 0;
    let bouncesFirm = 0;
    let bouncesPuddle = 0;

    for (let i = 0; i < 240; i++) {
      const prevVzFirm = ballFirm.getState().velocity.z;
      const prevVzPuddle = ballPuddle.getState().velocity.z;

      const stateFirm = ballFirm.step(dt, i * dt, pitchFirm);
      const statePuddle = ballPuddle.step(dt, i * dt, pitchPuddle);

      if (prevVzFirm < 0 && stateFirm.velocity.z > 0) bouncesFirm++;
      if (prevVzPuddle < 0 && statePuddle.velocity.z > 0) bouncesPuddle++;

      if (bouncesFirm === 1 && stateFirm.position.z > maxApexFirm) {
        maxApexFirm = stateFirm.position.z;
      }
      if (bouncesPuddle === 1 && statePuddle.position.z > maxApexPuddle) {
        maxApexPuddle = statePuddle.position.z;
      }
    }

    console.log(`Firm Turf First Rebound Apex:   ${maxApexFirm.toFixed(3)} m`);
    console.log(`Puddle Splash First Rebound Apex: ${maxApexPuddle.toFixed(3)} m`);

    // Puddle water displacement absorbs significant impact kinetic energy
    expect(maxApexPuddle).toBeLessThan(maxApexFirm * 0.85);
  });

  it('executes controlled ground slides, creates persistent cleat ruts, and slides further on wet turf', () => {
    // Test controlled slide on Wet Slick vs Dry Heavy turf
    const simWet = new SimulationCore(new Vector2(0, 0), 0);
    simWet.setTurfCondition('wet_slick');
    simWet.setStudType('sg_metal');

    const simDry = new SimulationCore(new Vector2(0, 0), 0);
    simDry.setTurfCondition('dry_heavy');
    simDry.setStudType('fg_plastic');

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Accelerate both players to sprint speed before the slide setup.
    for (let i = 0; i < 240; i++) {
      simWet.step(sprintIntent);
      simDry.step(sprintIntent);
    }

    expect(simWet.getCurrentState().velocity.length()).toBeGreaterThan(6.0);
    expect(simDry.getCurrentState().velocity.length()).toBeGreaterThan(5.5);

    const slideIntent: Intent = {
      ...sprintIntent,
      requestSlide: true,
    };

    // Trigger controlled slide
    simWet.step(slideIntent);
    simDry.step(slideIntent);

    expect(simWet.getCurrentState().slipStatus.type).toBe('controlled_slide');
    expect(simWet.getCurrentState().slipStatus.isControlled).toBe(true);
    expect(simDry.getCurrentState().slipStatus.type).toBe('controlled_slide');

    // Slide pose: vertical bounce drops to turf level (-0.15m)
    expect(simWet.getCurrentState().verticalBounce).toBeCloseTo(-0.15, 2);

    const startXWet = simWet.getCurrentState().position.x;
    const startXDry = simDry.getCurrentState().position.x;

    // Simulate slide until recovery
    const passiveIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let i = 0; i < 240; i++) {
      simWet.step(passiveIntent);
      simDry.step(passiveIntent);
    }

    const slideDistWet = simWet.getCurrentState().position.x - startXWet;
    const slideDistDry = simDry.getCurrentState().position.x - startXDry;

    console.log(`Wet Slick Controlled Slide Distance: ${slideDistWet.toFixed(2)} m`);
    console.log(`Dry Heavy Controlled Slide Distance: ${slideDistDry.toFixed(2)} m`);

    // On wet slick turf (mu_k = 0.22), slide travels significantly farther than dry turf (mu_k = 0.45)
    expect(slideDistWet).toBeGreaterThan(slideDistDry * 1.4);
    expect(slideDistWet).toBeGreaterThan(2.5);

    // Both slides should have carved persistent cleat ruts in the pitch surface
    const rutsWet = simWet.getRuts();
    expect(rutsWet.length).toBeGreaterThan(0);
    const lastRut = rutsWet[rutsWet.length - 1];
    expect(lastRut.severity).toBeGreaterThan(0.5);
    expect(lastRut.width).toBeGreaterThanOrEqual(0.12);
  });

  it('causes rolling balls crossing a cleat rut to pop into micro-bobs and deflect', () => {
    const pitch = new PitchSurface(24.0);
    // Create a transverse rut across x = 10, from y = -2 to y = 2
    pitch.createRut(new Vector2(10.0, -2.0), new Vector2(10.0, 2.0), 0.85, 0.0);

    const ball = new BallPhysics();
    // Roll ball from x = 5 towards x = 15 through the rut at y = 0
    ball.reset(new Vector3(5.0, 0.0, ball.radius));
    ball.kick(10.0, 0.0, 0.0, 0, 0);

    const dt = 1 / 120;
    let poppedAltitude = 0;
    let lateralDev = 0;

    for (let i = 0; i < 180; i++) {
      const state = ball.step(dt, i * dt, pitch);
      if (state.position.z > poppedAltitude) {
        poppedAltitude = state.position.z;
      }
      if (state.position.x > 10.5) {
        lateralDev = Math.abs(state.position.y);
      }
    }

    console.log(`Ball Max Altitude over Cleat Rut: ${poppedAltitude.toFixed(3)} m (Ball Radius: ${ball.radius} m)`);
    console.log(`Lateral Deviation after crossing Rut: ${lateralDev.toFixed(3)} m`);

    expect(poppedAltitude).toBeGreaterThan(ball.radius + 0.01);
  });

  it('amplifies sprint stamina drain and reduces recovery on heavy waterlogged turf', () => {
    const simFirm = new SimulationCore(new Vector2(0, 0), 0);
    simFirm.setTurfCondition('standard');
    simFirm.setGrassHeight(24.0);
    simFirm.setBaseMoisture(0.20);

    const simHeavy = new SimulationCore(new Vector2(0, 0), 0);
    simHeavy.setTurfCondition('wet_slick');
    simHeavy.setGrassHeight(34.0); // tall uncut grass
    simHeavy.setBaseMoisture(0.85); // heavy saturated mud

    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Sprint for 4.0 seconds (480 ticks)
    for (let i = 0; i < 480; i++) {
      simFirm.step(sprintIntent);
      simHeavy.step(sprintIntent);
    }

    const staminaFirm = simFirm.getCurrentState().stamina;
    const staminaHeavy = simHeavy.getCurrentState().stamina;
    const multHeavy = simHeavy.getCurrentState().pitchFatigueMultiplier;

    console.log(`Firm Pitch Fatigue Multiplier:  ${simFirm.getCurrentState().pitchFatigueMultiplier.toFixed(2)}x (Stamina: ${(staminaFirm * 100).toFixed(1)}%)`);
    console.log(`Heavy Pitch Fatigue Multiplier: ${multHeavy.toFixed(2)}x (Stamina: ${(staminaHeavy * 100).toFixed(1)}%)`);

    // Heavy muddy/tall grass pitch must increase metabolic drain significantly
    expect(multHeavy).toBeGreaterThan(1.45);
    expect(staminaHeavy).toBeLessThan(staminaFirm);
    const staminaSpentFirm = 1.0 - staminaFirm;
    const staminaSpentHeavy = 1.0 - staminaHeavy;
    expect(staminaSpentHeavy).toBeGreaterThan(staminaSpentFirm * 1.35);
  });

  it('clears standing puddles when cycling turf condition away from wet_slick to standard or dry_heavy', () => {
    const sim = new SimulationCore(new Vector2(0, 0), 0);
    expect(sim.getPitchSurface().getPuddles().length).toBe(0);

    // Switch to wet_slick (T key): spawns puddles
    sim.setTurfCondition('wet_slick');
    expect(sim.getPitchSurface().getPuddles().length).toBeGreaterThan(0);
    expect(sim.getBaseMoisture()).toBe(0.65);

    // Switch to dry_heavy (T key): puddles must be cleared!
    sim.setTurfCondition('dry_heavy');
    expect(sim.getPitchSurface().getPuddles().length).toBe(0);
    expect(sim.getBaseMoisture()).toBe(0.10);

    // Switch back to wet_slick, then standard: puddles must be cleared again!
    sim.setTurfCondition('wet_slick');
    expect(sim.getPitchSurface().getPuddles().length).toBeGreaterThan(0);
    sim.setTurfCondition('standard');
    expect(sim.getPitchSurface().getPuddles().length).toBe(0);
    expect(sim.getBaseMoisture()).toBe(0.25);
  });

  it('simulates match traffic with J key: tracks simulated match minutes, generates divots and central wear, and resets on clear', () => {
    const sim = new SimulationCore(new Vector2(0, 0), 0);
    const surface = sim.getPitchSurface();

    expect(surface.getSimulatedMatchMinutes()).toBe(0);
    expect(surface.getState().simulatedMatchMinutes).toBe(0);
    expect(surface.getDivots().length).toBe(0);

    // Press J: +30 minutes of match play
    sim.simulateMatchTraffic(30);

    expect(surface.getSimulatedMatchMinutes()).toBe(30);
    expect(surface.getState().simulatedMatchMinutes).toBe(30);
    // Spawns realistic match divots
    expect(surface.getDivots().length).toBeGreaterThanOrEqual(2);
    // Applies wear to center circle and goalmouths
    expect(surface.getWearAt(0, 0)).toBeGreaterThan(0);
    expect(surface.getWearAt(-51.5, 0)).toBeGreaterThan(0);

    // Press J again: reaches 60 minutes
    sim.simulateMatchTraffic(30);
    expect(surface.getSimulatedMatchMinutes()).toBe(60);
    expect(surface.getDivots().length).toBeGreaterThanOrEqual(4);

    // Clear damage (C key): resets all damage and match minutes
    sim.clearPitchDamage();
    expect(surface.getSimulatedMatchMinutes()).toBe(0);
    expect(surface.getDivots().length).toBe(0);
    expect(surface.getWearAt(0, 0)).toBe(0);
  });

  it('decouples ruts from wear grid: rut creation leaves smooth vector furrow without blocky 0.5m grid tiles', () => {
    const pitch = new PitchSurface(24.0);
    const start = new Vector2(0, 0);
    const end = new Vector2(2.0, 0);

    // Wear grid before rut
    expect(pitch.getWearAt(0, 0)).toBe(0);
    expect(pitch.getWearAt(1.0, 0)).toBe(0);

    // Create rut furrow
    const rut = pitch.createRut(start, end, 0.7, 0);
    expect(rut.width).toBeGreaterThanOrEqual(0.12);
    expect(pitch.getRuts().length).toBe(1);

    // Decoupled: wear grid cells remain 0 so ruts do not create dark blocky square tile shadows
    expect(pitch.getWearAt(0, 0)).toBe(0);
    expect(pitch.getWearAt(1.0, 0)).toBe(0);
  });
});
