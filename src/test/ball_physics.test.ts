import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SIM_CONFIG } from '../sim/config';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { SimulationCore } from '../sim/SimulationCore';
import { BALL_PRESETS, Intent } from '../sim/types';

describe('3D Aerodynamic Ball Physics Engine (Slice 2)', () => {
  it('simulates inelastic vertical bounce decay and settles to rest on turf', () => {
    const ball = new BallPhysics(new Vector3(0, 0, 2.0)); // Drop from 2.0m height
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    let bounceCount = 0;
    let prevVz = 0;
    let apex1 = 0;
    let reachedRest = false;

    // Simulate up to 4.0 seconds
    for (let t = 0; t <= 4.0; t += dt) {
      const state = ball.step(dt, t);

      // Detect bounce rebound (vz flips from negative to positive)
      if (prevVz < 0 && state.velocity.z > 0) {
        bounceCount++;
      }
      prevVz = state.velocity.z;

      // Track first rebound apex
      if (bounceCount === 1 && state.position.z > apex1) {
        apex1 = state.position.z;
      }

      // Check if settled to rest on turf
      if (
        state.flightState === 'at_rest' &&
        Math.abs(state.position.z - SIM_CONFIG.BALL.RADIUS) < 1e-4
      ) {
        reachedRest = true;
        break;
      }
    }

    console.log(`Drop from 2.0m -> First Rebound Apex: ${apex1.toFixed(3)} m`);
    console.log(`Total Bounces: ${bounceCount}`);

    // Theoretical first apex: (2.0 - 0.11) * e^2 + 0.11 ≈ 1.89 * 0.4225 + 0.11 ≈ 0.908 m
    expect(bounceCount).toBeGreaterThanOrEqual(3);
    expect(apex1).toBeGreaterThan(0.70);
    expect(apex1).toBeLessThan(1.10);
    expect(reachedRest).toBe(true);
    expect(ball.getState().position.z).toBeCloseTo(SIM_CONFIG.BALL.RADIUS, 3);
  });

  it('exhibits realistic turf rolling deceleration and comes to a complete halt', () => {
    const ball = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Driven ground pass: 12.0 m/s East (0 rad heading, 0 deg elevation)
    ball.kick(12.0, 0, 0, 0, 0);

    let timeToStop = 0;
    let finalDistance = 0;

    for (let t = 0; t <= 20.0; t += dt) {
      const state = ball.step(dt, t);
      if (state.flightState === 'at_rest') {
        timeToStop = t;
        finalDistance = state.position.x;
        break;
      }
    }

    console.log(`12 m/s Ground Pass -> Rolling Distance: ${finalDistance.toFixed(2)} m, Time to stop: ${timeToStop.toFixed(2)} s`);

    // Ball must roll smoothly, decelerate under rolling friction, and halt cleanly
    expect(timeToStop).toBeGreaterThan(5.0);
    expect(timeToStop).toBeLessThan(18.0);
    expect(finalDistance).toBeGreaterThan(30.0);
    expect(finalDistance).toBeLessThan(90.0);
    expect(ball.getState().velocity.length()).toBe(0);
  });

  it('demonstrates Magnus Effect lateral curl on a spinning shot (Curving Free-Kick)', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Straight shot with ZERO sidespin: 26 m/s East (heading = 0), 10° elevation
    const straightBall = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    straightBall.kick(26.0, 10, 0, 0, 0);

    // 2. Curving shot with 8 revolutions/sec sidespin (counter-clockwise -> curves North / +Y)
    const curlingBall = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    curlingBall.kick(26.0, 10, 0, 8.0, 0);

    for (let t = 0; t <= 1.2; t += dt) {
      straightBall.step(dt, t);
      curlingBall.step(dt, t);
    }

    const straightPos = straightBall.getState().position;
    const curlingPos = curlingBall.getState().position;

    const lateralDeflectionY = curlingPos.y - straightPos.y;

    console.log(`Straight Shot at 1.2s: (${straightPos.x.toFixed(2)}, ${straightPos.y.toFixed(2)}, ${straightPos.z.toFixed(2)}) m`);
    console.log(`Curling Shot at 1.2s:  (${curlingPos.x.toFixed(2)}, ${curlingPos.y.toFixed(2)}, ${curlingPos.z.toFixed(2)}) m`);
    console.log(`Lateral Magnus Deflection Δy: ${lateralDeflectionY.toFixed(2)} m`);

    // Straight shot must travel with negligible lateral deviation
    expect(Math.abs(straightPos.y)).toBeLessThan(0.05);

    // Curving shot must exhibit significant lateral Magnus swerve (> 2.0 meters at 1.2s)
    expect(lateralDeflectionY).toBeGreaterThan(2.0);
  });

  it('demonstrates Backspin Floating Lift vs. Topspin Dipping Strike', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Backspin Lofted Pass: 22 m/s, 15° elevation, +6 RPS backspin
    const backspinBall = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    backspinBall.kick(22.0, 15, 0, 0, 6.0);

    // 2. Topspin Dipping Strike: 22 m/s, 15° elevation, -6 RPS topspin
    const topspinBall = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
    topspinBall.kick(22.0, 15, 0, 0, -6.0);

    let maxAltitudeBackspin = 0;
    let maxAltitudeTopspin = 0;

    for (let t = 0; t <= 1.5; t += dt) {
      const stateBack = backspinBall.step(dt, t);
      const stateTop = topspinBall.step(dt, t);

      if (stateBack.position.z > maxAltitudeBackspin) maxAltitudeBackspin = stateBack.position.z;
      if (stateTop.position.z > maxAltitudeTopspin) maxAltitudeTopspin = stateTop.position.z;
    }

    console.log(`Backspin Max Altitude (Lift): ${maxAltitudeBackspin.toFixed(2)} m`);
    console.log(`Topspin Max Altitude (Dip):   ${maxAltitudeTopspin.toFixed(2)} m`);

    // Backspin creates upward Magnus lift; Topspin creates downward Magnus dip
    expect(maxAltitudeBackspin).toBeGreaterThan(maxAltitudeTopspin + 0.4);
  });

  it('demonstrates Jabulani knuckleball volatility compared to stable Telstar 32-panel on zero-spin driven strike', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // 1. Jabulani (high seam roughness 0.88, late drag crisis 25.5 m/s)
    const jabulani = new BallPhysics(
      new Vector3(0, 0, BALL_PRESETS.jabulani_2010.radius),
      BALL_PRESETS.jabulani_2010
    );
    jabulani.kick(28.0, 7.5, 0, 0, 0); // 28 m/s zero-spin knuckle strike

    // 2. Classic Telstar (low seam roughness 0.08, ultra-stable)
    const telstar = new BallPhysics(
      new Vector3(0, 0, BALL_PRESETS.classic_telstar.radius),
      BALL_PRESETS.classic_telstar
    );
    telstar.kick(28.0, 7.5, 0, 0, 0);

    let jabulaniMaxWobble = 0;
    let telstarMaxWobble = 0;
    let jabulaniWasKnuckling = false;

    for (let t = 0; t <= 0.9; t += dt) {
      const sJab = jabulani.step(dt, t);
      const sTel = telstar.step(dt, t);

      if (sJab.isKnuckling) jabulaniWasKnuckling = true;

      if (Math.abs(sJab.position.y) > jabulaniMaxWobble) {
        jabulaniMaxWobble = Math.abs(sJab.position.y);
      }
      if (Math.abs(sTel.position.y) > telstarMaxWobble) {
        telstarMaxWobble = Math.abs(sTel.position.y);
      }
    }

    console.log(`Jabulani Max Lateral Knuckle Wobble: ${(jabulaniMaxWobble * 100).toFixed(1)} cm`);
    console.log(`Telstar Max Lateral Knuckle Wobble:  ${(telstarMaxWobble * 100).toFixed(1)} cm`);

    // Jabulani exhibits erratic seam vortex deflection ~8x greater than Telstar
    expect(jabulaniWasKnuckling).toBe(true);
    expect(jabulaniMaxWobble).toBeGreaterThan(telstarMaxWobble * 4);
  });

  it('simulates turf condition effects: Wet Slick turf skids and rolls farther than Dry Heavy grass', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    // Ground pass at 12 m/s
    const wetBall = new BallPhysics(
      new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
      BALL_PRESETS.modern_match,
      'wet_slick'
    );
    wetBall.kick(12.0, 0, 0, 0, 0);

    const dryBall = new BallPhysics(
      new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
      BALL_PRESETS.modern_match,
      'dry_heavy'
    );
    dryBall.kick(12.0, 0, 0, 0, 0);

    let wetDist = 0;
    let dryDist = 0;

    for (let t = 0; t <= 25.0; t += dt) {
      const sWet = wetBall.step(dt, t);
      const sDry = dryBall.step(dt, t);

      if (sWet.flightState === 'at_rest' && wetDist === 0) wetDist = sWet.position.x;
      if (sDry.flightState === 'at_rest' && dryDist === 0) dryDist = sDry.position.x;

      if (wetDist > 0 && dryDist > 0) break;
    }

    console.log(`Wet Slick Turf Rolling Distance: ${wetDist.toFixed(1)} m`);
    console.log(`Dry Heavy Turf Rolling Distance: ${dryDist.toFixed(1)} m`);

    // Wet turf has low rolling resistance (rolls farther), dry heavy grass has high resistance
    expect(wetDist).toBeGreaterThan(dryDist + 20.0);
  });

  it('simulates Futsal low-bounce ball exhibiting heavily damped restitution compared to Jabulani', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    const futsal = new BallPhysics(
      new Vector3(0, 0, 2.0),
      BALL_PRESETS.futsal_lowbounce
    );
    const jabulani = new BallPhysics(
      new Vector3(0, 0, 2.0),
      BALL_PRESETS.jabulani_2010
    );

    let apexFutsal = 0;
    let apexJabulani = 0;
    let bounceFutsal = 0;
    let bounceJabulani = 0;
    let prevVzF = 0;
    let prevVzJ = 0;

    for (let t = 0; t <= 3.0; t += dt) {
      const sF = futsal.step(dt, t);
      const sJ = jabulani.step(dt, t);

      if (prevVzF < 0 && sF.velocity.z > 0) bounceFutsal++;
      if (prevVzJ < 0 && sJ.velocity.z > 0) bounceJabulani++;

      prevVzF = sF.velocity.z;
      prevVzJ = sJ.velocity.z;

      if (bounceFutsal === 1 && sF.position.z > apexFutsal) apexFutsal = sF.position.z;
      if (bounceJabulani === 1 && sJ.position.z > apexJabulani) apexJabulani = sJ.position.z;
    }

    console.log(`Futsal 2.0m Drop Apex:   ${apexFutsal.toFixed(3)} m`);
    console.log(`Jabulani 2.0m Drop Apex: ${apexJabulani.toFixed(3)} m`);

    // Futsal is heavily damped (e = 0.42) compared to high-bounce Jabulani (e = 0.72)
    expect(apexFutsal).toBeLessThan(0.55);
    expect(apexJabulani).toBeGreaterThan(0.95);
  });

  it('integrates ball physics deterministically inside SimulationCore loop', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const initialBall = sim.getBallState();

    expect(initialBall.position.x).toBeCloseTo(0.6, 2);
    expect(initialBall.position.y).toBeCloseTo(0.0, 2);
    expect(initialBall.position.z).toBeCloseTo(SIM_CONFIG.BALL.RADIUS, 3);
    expect(initialBall.flightState).toBe('at_rest');

    // Kick ball East
    sim.kickBall(16.0, 15, 0, 4.0, 2.0);
    expect(sim.getBallState().flightState).toBe('flight');

    const idleIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    // Step 120 ticks (1.0 second)
    for (let i = 0; i < 120; i++) {
      sim.step(idleIntent, SIM_CONFIG.LOOP.FIXED_DT);
    }

    const midBall = sim.getBallState();
    const prevBall = sim.getPreviousBallState();

    expect(midBall.position.x).toBeGreaterThan(10.0);
    expect(prevBall.position.x).toBeLessThan(midBall.position.x);

    // Reset ball
    sim.resetBall();
    const resetBall = sim.getBallState();
    expect(resetBall.position.x).toBeCloseTo(0.6, 2);
    expect(resetBall.position.z).toBeCloseTo(SIM_CONFIG.BALL.RADIUS, 3);
    expect(resetBall.flightState).toBe('at_rest');
  });
});
