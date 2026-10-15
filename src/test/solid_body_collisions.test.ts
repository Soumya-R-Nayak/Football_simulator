import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationCore } from '../sim/SimulationCore';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SIM_CONFIG } from '../sim/config';
import { Intent } from '../sim/types';
import { SweptCollisionResolver, ContactManifold } from '../sim/collision/SweptCollision';
import { CapsuleShape, ContactBody } from '../sim/collision/ContactBody';
import { BallPhysics } from '../sim/physics/BallPhysics';

const neutralIntent: Intent = {
  moveDir: Vector2.zero(),
};

describe('Slice 3a: Physical Solid Body Collisions & Relative Swept CCD', () => {
  let sim: SimulationCore;

  beforeEach(() => {
    sim = new SimulationCore();
    sim.reset(Vector2.zero(), 0);
  });

  describe('Edge Case 1: High-Speed Anti-Tunneling (Ball at 30 m/s into Torso)', () => {
    it('reliably detects collision and rebounds a 30 m/s ball fired at a stationary torso without tunneling', () => {
      // Place player at (5, 0)
      sim.reset(new Vector2(5.0, 0), 0);

      // Fire ball at (1.0, 0, 1.2) - chest level (z = 1.2m) at 30 m/s towards player
      const ballStart = new Vector3(1.0, 0, 1.2);
      sim.resetBall(ballStart);
      sim.applyBallImpulse(new Vector3(30.0 * SIM_CONFIG.BALL.MASS, 0, 0));

      const initialBallVel = sim.getBallState().velocity;
      expect(initialBallVel.x).toBeCloseTo(30.0, 1);

      let collided = false;
      const torsoRadius = SIM_CONFIG.COLLISION.TORSO_RADIUS;
      const ballRadius = SIM_CONFIG.BALL.RADIUS;
      const playerX = 5.0;

      // Step simulation over 20 ticks (1/6 second)
      for (let t = 0; t < 20; t++) {
        sim.step(neutralIntent);
        const ball = sim.getBallState();

        // The ball should NEVER pass through the player's torso center
        expect(ball.position.x).toBeLessThan(playerX + torsoRadius + ballRadius);

        // Detect rebound
        if (ball.velocity.x < 0) {
          collided = true;
          // Rebound position should be on the front side of the player
          expect(ball.position.x).toBeLessThanOrEqual(playerX);
          break;
        }
      }

      expect(collided).toBe(true);
      const postRebound = sim.getBallState();
      expect(postRebound.velocity.x).toBeLessThan(0); // Rebounded backward
    });
  });

  describe('Edge Case 2: Sprinter Anti-Tunneling (Sprinter at 9.4 m/s into Ball)', () => {
    it('pushes a stationary ball forward when a top-speed sprinter runs into it, preventing ball phasing into body', () => {
      // Player starts at (0, 0)
      sim.reset(Vector2.zero(), 0);

      // Place stationary ball at (0.8, 0, SIM_CONFIG.BALL.RADIUS)
      sim.resetBall(new Vector3(0.8, 0, SIM_CONFIG.BALL.RADIUS));

      const sprintIntent: Intent = {
        moveDir: new Vector2(1.0, 0),
        gait: 'sprint',
      };

      let ballPushed = false;

      // Sprint for 100 ticks (~0.83s, covering ~3.5m)
      for (let t = 0; t < 100; t++) {
        sim.step(sprintIntent);
        const player = sim.getCurrentState();
        const ball = sim.getBallState();

        if (ball.velocity.x > 0.5) {
          ballPushed = true;
          // Ball is ahead of or at the leading/trailing leg envelope of the player (never trapped behind trailing leg)
          expect(ball.position.x).toBeGreaterThanOrEqual(player.position.x - 0.55);
        }
      }

      expect(ballPushed).toBe(true);
      expect(sim.getBallState().velocity.x).toBeGreaterThan(0);
    });
  });

  describe('Edge Case 3: High-Speed Relative Foot Sweep (15–25 m/s)', () => {
    it('catches and reflects a ball in a high relative velocity sweep without tunneling', () => {
      const ballPos = new Vector3(2.0, 0, 0.11);
      const ballVel = new Vector3(-12.0, 0, 0); // Ball flying left at 12 m/s
      const footPos = new Vector3(1.8, 0, 0.10);
      const footVel = new Vector3(8.0, 0, 0);   // Foot swinging right at 8 m/s (rel = 20 m/s)

      const footBody: ContactBody = {
        id: 'right_foot',
        shape: { type: 'sphere', center: footPos, radius: 0.09 },
        prevPos: footPos.sub(footVel.scale(1 / 120)),
        currPos: footPos,
        velocity: footVel,
        effMass: 3.5,
        restitution: 0.50,
        friction: 0.40,
        loaded: false,
        active: true,
      };

      const hit = SweptCollisionResolver.checkCollision(
        ballPos,
        ballVel,
        0.11,
        footBody,
        1 / 120
      );

      expect(hit).not.toBeNull();
      expect(hit!.hasImpact).toBe(true);
      expect(hit!.toi).toBeGreaterThanOrEqual(0);
      expect(hit!.toi).toBeLessThanOrEqual(1.0);

      // Verify impulse reverses ball
      const res = SweptCollisionResolver.resolveImpulse(
        hit!,
        ballVel,
        Vector3.zero(),
        0.43,
        0.00347,
        0.11
      );

      expect(res.deltaV.x).toBeGreaterThan(0);
      const finalVx = ballVel.x + res.deltaV.x;
      expect(finalVx).toBeGreaterThan(0); // Reversed from -12 m/s to positive
    });
  });

  describe('Edge Case 4: Pelvis Clearance for Ground-Level Close Dribbling', () => {
    it('allows a ground ball sitting 0.35m ahead of player center to pass beneath the torso capsule without collision', () => {
      // Player at (0, 0). Torso capsule sits from z = 0.85m to 1.80m
      const torsoBaseZ = SIM_CONFIG.COLLISION.TORSO_BASE_Z;
      expect(torsoBaseZ).toBeGreaterThanOrEqual(0.85);

      const torsoBody: ContactBody = {
        id: 'torso',
        shape: {
          type: 'capsule',
          p1: new Vector3(0, 0, torsoBaseZ),
          p2: new Vector3(0, 0, 1.80),
          radius: SIM_CONFIG.COLLISION.TORSO_RADIUS,
        },
        prevPos: new Vector3(0, 0, torsoBaseZ),
        currPos: new Vector3(0, 0, torsoBaseZ),
        velocity: Vector3.zero(),
        effMass: 75,
        restitution: 0.35,
        friction: 0.35,
        loaded: true,
        active: false,
      };

      // Ground ball directly in front of pelvis at (0.35, 0, 0.11)
      const groundBallPos = new Vector3(0.35, 0, SIM_CONFIG.BALL.RADIUS);
      const groundBallVel = new Vector3(0.5, 0, 0); // Gentle roll

      const hit = SweptCollisionResolver.checkCollision(
        groundBallPos,
        groundBallVel,
        SIM_CONFIG.BALL.RADIUS,
        torsoBody,
        1 / 120
      );

      // MUST NOT hit torso: ball is at z=0.11m, below torso base z=0.85m!
      expect(hit).toBeNull();
    });
  });

  describe('Edge Case 5: Vertical Capsule Bounding (Lofted Pass Overhead Clearance)', () => {
    it('allows a high aerial ball (z = 2.2m) to fly over the player without hitting an invisible collider', () => {
      // Player at (4.0, 0)
      sim.reset(new Vector2(4.0, 0), 0);

      // Fire lofted ball at (0, 0, 2.4m) traveling horizontally at 15 m/s
      sim.resetBall(new Vector3(0, 0, 2.4));
      sim.applyBallImpulse(new Vector3(15.0 * SIM_CONFIG.BALL.MASS, 0, 0));

      // Run 50 ticks (~0.41s) across player position
      for (let t = 0; t < 50; t++) {
        sim.step(neutralIntent);
        const ball = sim.getBallState();

        // While passing x = 4.0, altitude is still well above player's head (z > 1.95m)
        if (Math.abs(ball.position.x - 4.0) < 0.3) {
          expect(ball.position.z).toBeGreaterThan(1.95);
        }
      }

      const ballEnd = sim.getBallState();
      // Ball passed over player cleanly without being deflected backwards
      expect(ballEnd.position.x).toBeGreaterThan(5.0);
      expect(ballEnd.velocity.x).toBeGreaterThan(10.0);
    });
  });

  describe('Edge Case 6: Energy Conservation Bound (No Energy Injection from Collision)', () => {
    it('strictly conserves or dissipates energy across collisions (E_post <= E_pre)', () => {
      // Stationary rigid torso collider
      const torsoBody: ContactBody = {
        id: 'torso',
        shape: {
          type: 'capsule',
          p1: new Vector3(5, 0, 0.85),
          p2: new Vector3(5, 0, 1.80),
          radius: 0.28,
        },
        prevPos: new Vector3(5, 0, 0.85),
        currPos: new Vector3(5, 0, 0.85),
        velocity: Vector3.zero(),
        effMass: 75.0,
        restitution: 0.35, // e < 1
        friction: 0.40,
        loaded: true,
        active: false,
      };

      // Ball positioned 0.07m from contact boundary, traveling 0.12m in 1 tick
      const ballPos = new Vector3(4.55, 0.05, 1.2);
      const ballVel = new Vector3(14.0, 4.0, 0); // Oblique entry
      const ballSpin = new Vector3(0, 0, 10.0);
      const m = SIM_CONFIG.BALL.MASS;
      const I = (2 / 3) * m * SIM_CONFIG.BALL.RADIUS * SIM_CONFIG.BALL.RADIUS;

      const preKE = 0.5 * m * ballVel.lengthSq() + 0.5 * I * ballSpin.lengthSq();

      const hit = SweptCollisionResolver.checkCollision(
        ballPos,
        ballVel,
        SIM_CONFIG.BALL.RADIUS,
        torsoBody,
        1 / 120
      );

      expect(hit).not.toBeNull();

      const res = SweptCollisionResolver.resolveImpulse(
        hit!,
        ballVel,
        ballSpin,
        m,
        I,
        SIM_CONFIG.BALL.RADIUS
      );

      const postVel = ballVel.add(res.deltaV);
      const postSpin = ballSpin.add(res.deltaOmega);
      const postKE = 0.5 * m * postVel.lengthSq() + 0.5 * I * postSpin.lengthSq();

      // Energy must be dissipated or conserved, NEVER increased!
      expect(postKE).toBeLessThanOrEqual(preKE + 1e-4);
    });
  });

  describe('Edge Case 7: Oblique Impacts & Coulomb Friction Spin Generation', () => {
    it('generates angular spin from oblique tangential friction impulse', () => {
      const torsoBody: ContactBody = {
        id: 'torso',
        shape: {
          type: 'capsule',
          p1: new Vector3(0, 0, 0.85),
          p2: new Vector3(0, 0, 1.80),
          radius: 0.28,
        },
        prevPos: new Vector3(0, 0, 0.85),
        currPos: new Vector3(0, 0, 0.85),
        velocity: Vector3.zero(),
        effMass: 75.0,
        restitution: 0.40,
        friction: 0.50,
        loaded: true,
        active: false,
      };

      // Ball strikes off-center on the right flank (+Y) at an angle within 1 tick
      const ballPos = new Vector3(-0.43, 0.12, 1.2);
      const ballVel = new Vector3(10.0, 0, 0); // Pure forward velocity
      const ballSpin = Vector3.zero();         // Zero initial spin

      const hit = SweptCollisionResolver.checkCollision(
        ballPos,
        ballVel,
        SIM_CONFIG.BALL.RADIUS,
        torsoBody,
        1 / 120
      );

      expect(hit).not.toBeNull();
      // Contact normal is oblique
      expect(Math.abs(hit!.normal.y)).toBeGreaterThan(0.15);

      const res = SweptCollisionResolver.resolveImpulse(
        hit!,
        ballVel,
        ballSpin,
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Oblique friction torque MUST induce spin (deltaOmega != 0)
      expect(res.deltaOmega.lengthSq()).toBeGreaterThan(0.5);
    });
  });

  describe('Edge Case 8: Continuous Push of Resting Ball (No Penetration Explosion)', () => {
    it('pushes a resting ball smoothly over 60 consecutive ticks without velocity explosion or jitter', () => {
      sim.reset(Vector2.zero(), 0);

      // Place ball directly adjacent to player's foot position
      sim.resetBall(new Vector3(0.38, 0, SIM_CONFIG.BALL.RADIUS));

      const walkIntent: Intent = {
        moveDir: new Vector2(1.0, 0),
        gait: 'walk',
      };

      // Walk forward pushing the ball for 60 ticks (0.5s)
      for (let t = 0; t < 60; t++) {
        sim.step(walkIntent);
        const ball = sim.getBallState();

        // Speed should remain in realistic human walking push regime (< 5 m/s), never exploding to 100+ m/s
        expect(ball.velocity.length()).toBeLessThan(5.5);
        expect(Number.isFinite(ball.position.x)).toBe(true);
        expect(Number.isFinite(ball.position.y)).toBe(true);
        expect(Number.isFinite(ball.position.z)).toBe(true);
        expect(ball.position.z).toBeGreaterThanOrEqual(SIM_CONFIG.BALL.RADIUS - 0.005);
      }
    });
  });

  describe('Edge Case 9: Ground Pin Clamping', () => {
    it('clamps downward strike impulses against turf, preventing ball sinkage beneath grass level', () => {
      // Downward angled strike towards turf
      const footBody: ContactBody = {
        id: 'right_foot',
        shape: { type: 'sphere', center: new Vector3(0, 0, 0.22), radius: 0.09 },
        prevPos: new Vector3(0, 0, 0.28),
        currPos: new Vector3(0, 0, 0.22),
        velocity: new Vector3(2.0, 0, -6.0), // Foot driving downward
        effMass: 3.0,
        restitution: 0.40,
        friction: 0.35,
        loaded: false,
        active: true,
      };

      // Ball sitting on grass (z = 0.11m)
      const ballPos = new Vector3(0, 0, 0.11);
      const ballVel = Vector3.zero();

      const hit = SweptCollisionResolver.checkCollision(
        ballPos,
        ballVel,
        0.11,
        footBody,
        1 / 120
      );

      expect(hit).not.toBeNull();
      expect(hit!.normal.z).toBeLessThan(0); // Normal points downward

      const res = SweptCollisionResolver.resolveImpulse(
        hit!,
        ballVel,
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        0.11
      );

      expect(res.isGroundPinned).toBe(true);
    });
  });

  describe('Edge Case 10: Replay Determinism', () => {
    it('produces an identical state hash across 100 ticks with collisions given identical inputs', () => {
      const runSimulation = () => {
        const s = new SimulationCore();
        s.reset(Vector2.zero(), 0);
        s.resetBall(new Vector3(0.5, 0, SIM_CONFIG.BALL.RADIUS));

        const intent: Intent = {
          moveDir: new Vector2(0.8, 0.2),
          gait: 'jog',
        };

        for (let t = 0; t < 100; t++) {
          s.step(intent);
        }

        const player = s.getCurrentState();
        const ball = s.getBallState();

        return {
          px: player.position.x,
          py: player.position.y,
          bx: ball.position.x,
          by: ball.position.y,
          bz: ball.position.z,
          bvx: ball.velocity.x,
          bvy: ball.velocity.y,
        };
      };

      const run1 = runSimulation();
      const run2 = runSimulation();

      expect(run1.px).toBe(run2.px);
      expect(run1.py).toBe(run2.py);
      expect(run1.bx).toBe(run2.bx);
      expect(run1.by).toBe(run2.by);
      expect(run1.bz).toBe(run2.bz);
      expect(run1.bvx).toBe(run2.bvx);
      expect(run1.bvy).toBe(run2.bvy);
    });
  });

  describe('Edge Case 11: Multi-Substep Timestep Convergence (120 Hz vs 480 Hz Reference)', () => {
    it('achieves <= 2% post-impact ball velocity error at 120 Hz compared to a 480 Hz reference when swing foot hits in 2nd substep', () => {
      const dt120 = 1 / 120;
      const dt480 = 1 / 480;

      const runConvergenceSimulation = (stepDt: number) => {
        const ball = new BallPhysics(new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS));
        ball.setState({
          ...ball.getState(),
          position: new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
          velocity: new Vector3(2.0, 0, 0), // Moves in +x at 2 m/s
          spin: Vector3.zero(),
          flightState: 'rolling',
        });

        // Body 1: Light obstacle at x = 0.134.
        // Radius = 0.02, ball radius = 0.11. Gap = 0.134 - 0.13 = 0.004m.
        // Ball at 2 m/s hits it at t = 0.004 / 2 = 0.002s (Substep 1).
        const body1Radius = 0.02;
        const body1: ContactBody = {
          id: 'torso',
          shape: {
            type: 'sphere',
            center: new Vector3(0.134, 0, SIM_CONFIG.BALL.RADIUS),
            radius: body1Radius,
          },
          prevPos: new Vector3(0.134, 0, SIM_CONFIG.BALL.RADIUS),
          currPos: new Vector3(0.134, 0, SIM_CONFIG.BALL.RADIUS),
          velocity: Vector3.zero(),
          effMass: 0.01, // Tiny mass: triggers substep 1 without deflecting ball significantly
          restitution: 0.1,
          friction: 0.0,
          loaded: false,
          active: false,
        };

        // Body 2: Swing boot moving in +x at 20 m/s.
        // Starts at x = -0.241. Hits ball rear at t = 0.0045s in Substep 2!
        const bootRadius = SIM_CONFIG.COLLISION.BOOT_RADIUS; // 0.05m
        const bootSpeedX = 20.0;
        const bootInitialX = -0.241;

        let simTime = 0;
        const totalDuration = dt120;
        const totalSteps = Math.round(totalDuration / stepDt);
        let postFootVelocity: Vector3 | null = null;

        for (let step = 0; step < totalSteps; step++) {
          let tickElapsed = 0;

          for (let sub = 0; sub < 3; sub++) {
            const remDt = stepDt - tickElapsed;
            if (remDt <= 1e-7) break;

            const tCurrent = simTime + tickElapsed;

            // Update boot capsule for current sub-interval
            const bootX = bootInitialX + bootSpeedX * tCurrent;
            const bootShape: CapsuleShape = {
              type: 'capsule',
              p1: new Vector3(bootX, -0.05, SIM_CONFIG.BALL.RADIUS),
              p2: new Vector3(bootX, 0.05, SIM_CONFIG.BALL.RADIUS),
              radius: bootRadius,
              v1: new Vector3(bootSpeedX, 0, 0),
              v2: new Vector3(bootSpeedX, 0, 0),
            };
            const bootBody: ContactBody = {
              id: 'right_boot',
              shape: bootShape,
              prevPos: new Vector3(bootX - bootSpeedX * remDt, 0, SIM_CONFIG.BALL.RADIUS),
              currPos: new Vector3(bootX, 0, SIM_CONFIG.BALL.RADIUS),
              velocity: new Vector3(bootSpeedX, 0, 0),
              effMass: 4.5,
              restitution: 0.55,
              friction: 0.40,
              loaded: false,
              active: true,
            };

            // Body 1 only exists before t = 0.003s
            const bodies = tCurrent < 0.003 ? [body1, bootBody] : [bootBody];
            let earliestHit: ContactManifold | null = null;
            const bState = ball.getState();

            for (const body of bodies) {
              const hit = SweptCollisionResolver.checkCollision(
                bState.position,
                bState.velocity,
                ball.radius,
                body,
                remDt
              );
              if (hit && (!earliestHit || hit.toi < earliestHit.toi)) {
                earliestHit = hit;
              }
            }

            if (!earliestHit) {
              ball.step(remDt, tCurrent);
              tickElapsed = stepDt;
              break;
            }

            const subDuration = earliestHit.toi * remDt;
            if (subDuration > 1e-7) {
              ball.step(subDuration, tCurrent);
              tickElapsed += subDuration;
            }

            const impulse = SweptCollisionResolver.resolveImpulse(
              earliestHit,
              ball.getState().velocity,
              ball.getState().spin,
              ball.mass,
              ball.inertia,
              ball.radius
            );

            ball.applyImpulse(impulse.deltaV.scale(ball.mass));
            ball.setState({
              ...ball.getState(),
              position: ball.getState().position.add(impulse.posCorrection),
            });

            if (earliestHit.body.id === 'right_boot') {
              postFootVelocity = ball.getState().velocity.clone();
            }
          }

          simTime += stepDt;
        }

        return postFootVelocity ?? ball.getState().velocity;
      };

      const vel120 = runConvergenceSimulation(dt120);
      const vel480 = runConvergenceSimulation(dt480);

      const diff = vel120.sub(vel480).length();
      const refSpeed = vel480.length();
      const relativeError = diff / refSpeed;

      // Convergence tolerance: <= 2% (0.02)
      expect(relativeError).toBeLessThanOrEqual(0.02);
      expect(vel120.x).toBeGreaterThan(15.0);
    });
  });
});
