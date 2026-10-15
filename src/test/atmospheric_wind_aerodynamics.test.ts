import { describe, it, expect } from 'vitest';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { BALL_PRESETS } from '../sim/types';

describe('Item 3: Atmospheric Wind Vector & Dynamic Aerodynamics', () => {
  it('demonstrates that a crosswind laterally deflects a lofted ball downwind compared to calm conditions', () => {
    // 1. Lofted driven pass in zero wind (calm)
    const calmBall = new BallPhysics(BALL_PRESETS.modern_match);
    calmBall.setWind({ speed: 0, heading: 0, gustIntensity: 0 });
    calmBall.kick(24.0, 18.0, 0, 0, 0); // Kicking along +X axis (East)

    // 2. Same kick with a strong 10 m/s crosswind blowing North (heading = π/2)
    const windyBall = new BallPhysics(BALL_PRESETS.modern_match);
    windyBall.setWind({ speed: 10.0, heading: Math.PI / 2, gustIntensity: 0 });
    windyBall.kick(24.0, 18.0, 0, 0, 0);

    const dt = 1 / 120;
    const flightDuration = 1.35; // seconds in flight before ground impact

    for (let t = 0; t <= flightDuration; t += dt) {
      calmBall.step(dt, t);
      windyBall.step(dt, t);
    }
    const calmPos = calmBall.getState().position;
    const windyPos = windyBall.getState().position;

    const lateralDeflection = windyPos.y - calmPos.y;
    console.log(
      `Calm Landing Pos: (${calmPos.x.toFixed(2)}, ${calmPos.y.toFixed(2)}) m | Windy Landing Pos: (${windyPos.x.toFixed(2)}, ${windyPos.y.toFixed(2)}) m`
    );
    console.log(`Crosswind Lateral Deflection: ${lateralDeflection.toFixed(2)} m`);

    // In calm air, lateral deviation along Y should be negligible (< 5cm)
    expect(Math.abs(calmPos.y)).toBeLessThan(0.05);

    // Under a 10 m/s crosswind over ~1.35s flight, real footballs deflect by 2 to 5 meters downwind
    expect(lateralDeflection).toBeGreaterThan(2.0);
    expect(lateralDeflection).toBeLessThan(6.0);
  });

  it('demonstrates that tailwinds extend carry distance while headwinds choke ball flight distance', () => {
    const dt = 1 / 120;
    const kickSpeed = 22.0;
    const kickElev = 22.0;
    const flightDuration = 1.4;

    // Baseline: Calm (0 m/s)
    const calm = new BallPhysics(BALL_PRESETS.modern_match);
    calm.setWind({ speed: 0, heading: 0, gustIntensity: 0 });
    calm.kick(kickSpeed, kickElev, 0, 0, 0);

    // Headwind: 10 m/s blowing West against the ball (heading = π)
    const headwind = new BallPhysics(BALL_PRESETS.modern_match);
    headwind.setWind({ speed: 10.0, heading: Math.PI, gustIntensity: 0 });
    headwind.kick(kickSpeed, kickElev, 0, 0, 0);

    // Tailwind: 10 m/s blowing East with the ball (heading = 0)
    const tailwind = new BallPhysics(BALL_PRESETS.modern_match);
    tailwind.setWind({ speed: 10.0, heading: 0, gustIntensity: 0 });
    tailwind.kick(kickSpeed, kickElev, 0, 0, 0);

    for (let t = 0; t <= flightDuration; t += dt) {
      calm.step(dt, t);
      headwind.step(dt, t);
      tailwind.step(dt, t);
    }

    const distCalm = calm.getState().position.x;
    const distHeadwind = headwind.getState().position.x;
    const distTailwind = tailwind.getState().position.x;

    console.log(
      `Carry Distances -> Headwind: ${distHeadwind.toFixed(2)} m | Calm: ${distCalm.toFixed(2)} m | Tailwind: ${distTailwind.toFixed(2)} m`
    );

    // Tailwind carry must exceed calm, and calm must exceed headwind
    expect(distTailwind).toBeGreaterThan(distCalm);
    expect(distCalm).toBeGreaterThan(distHeadwind);
    // Carry delta between tailwind and headwind should be substantial (> 6m)
    expect(distTailwind - distHeadwind).toBeGreaterThan(6.0);
  });

  it('demonstrates dynamic low-frequency gust modulation alters airspeed across time', () => {
    const ball = new BallPhysics(BALL_PRESETS.modern_match);
    ball.setWind({ speed: 8.0, heading: 0, gustIntensity: 0.35 });

    // Step in flight at different sim timestamps and verify gust variance
    ball.kick(20.0, 15.0, 0, 0, 0);
    const dt = 1 / 120;

    // Sim at t = 0 vs t = 2.5s will have distinct gust multipliers sin(t * 0.45 + 1.2)
    ball.step(dt, 0.0);
    const stateAt0 = ball.getState();

    const ball2 = new BallPhysics(BALL_PRESETS.modern_match);
    ball2.setWind({ speed: 8.0, heading: 0, gustIntensity: 0.35 });
    ball2.kick(20.0, 15.0, 0, 0, 0);
    ball2.step(dt, 2.5);
    const stateAt25 = ball2.getState();

    // Accelerations should differ due to time-varying gust modulation
    expect(stateAt0.velocity.x).not.toBe(stateAt25.velocity.x);
  });
});
