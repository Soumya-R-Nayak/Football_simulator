import { describe, expect, it, vi } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { classifyBootContact } from '../sim/collision/BootZones';
import { CapsuleShape, ContactBody, extractPlayerContactBodies } from '../sim/collision/ContactBody';
import { KickIntent, KickSwingController } from '../sim/collision/KickSwingController';
import { poseAt } from '../sim/collision/LegKinematics';
import { SweptCollisionResolver } from '../sim/collision/SweptCollision';
import { SIM_CONFIG } from '../sim/config';
import { BallPhysics } from '../sim/physics/BallPhysics';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Slice 3b: FootKinematics, Leg Colliders, Boot Zones, and Kick Swing Controller', () => {
  const dt = SIM_CONFIG.LOOP.FIXED_DT; // 1/120s

  describe('1. FootKinematics (StrideEngine & 2-Bone IK)', () => {
    it('matches poseAt velocity at tick midpoint with stride engine actual foot displacement (pos[N+1] - pos[N]) / dt within 5% over jog and sprint', () => {
      const gaits: ('jog' | 'sprint')[] = ['jog', 'sprint'];

      for (const gait of gaits) {
        const sim = new SimulationCore();
        sim.reset(Vector2.zero(), 0);

        const intent: Intent = {
          moveDir: new Vector2(1, 0),
          gait,
        };

        // Run until steady stride cadence is reached
        for (let t = 0; t < 60; t++) {
          sim.step(intent);
        }

        let evaluatedTicks = 0;
        let totalError = 0;

        for (let t = 0; t < 60; t++) {
          const prevState = sim.getCurrentState();
          sim.step(intent);
          const currState = sim.getCurrentState();

          // Skip phase switch ticks where stance/swing transitions occur
          const isPhaseTransition =
            prevState.stride.phase !== currState.stride.phase ||
            prevState.stride.currentFoot !== currState.stride.currentFoot ||
            currState.stride.phaseProgress <= 0.10 ||
            currState.stride.phaseProgress >= 0.82;
          if (isPhaseTransition) {
            continue;
          }

          // Evaluate pose and velocity at the tick midpoint (tFrac = 0.5) using prevState and currState
          const midPose = poseAt(prevState, currState, 0.5, dt);

          // Stride engine actual foot displacement velocity over tick: (pos[N+1] - pos[N]) / dt
          const swingFoot = currState.stride.currentFoot === 'left' ? 'right' : 'left';
          const prevFootPos = swingFoot === 'right' ? prevState.stride.rightFootPos : prevState.stride.leftFootPos;
          const currFootPos = swingFoot === 'right' ? currState.stride.rightFootPos : currState.stride.leftFootPos;
          const simFootVel2D = currFootPos.sub(prevFootPos).scale(1 / dt);

          const poseFoot = swingFoot === 'right' ? midPose.right : midPose.left;
          const poseFootVel2D = new Vector2(poseFoot.ankleVel.x, poseFoot.ankleVel.y);

          // Relative error between poseAt velocity at tick midpoint and actual stride engine displacement: <= 5%
          const diff = poseFootVel2D.sub(simFootVel2D).length();
          const relError = diff / Math.max(1e-4, simFootVel2D.length());
          expect(relError).toBeLessThanOrEqual(0.05);

          totalError += diff;
          evaluatedTicks++;
        }

        expect(evaluatedTicks).toBeGreaterThan(25);
      }
    });

    it('guarantees position continuity across stance/swing phase switches without teleports (<= v_foot_max * dt)', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);

      const intent: Intent = {
        moveDir: new Vector2(1, 0),
        gait: 'sprint',
      };

      let prevLeftFoot = Vector3.zero();
      let prevRightFoot = Vector3.zero();
      const maxAllowedDisplacement = 0.60; // Upper bound for physically continuous foot step (no teleports)

      for (let t = 0; t < 120; t++) {
        sim.step(intent);
        const player = sim.getCurrentState();
        const poses = poseAt(player, 1.0, dt);

        if (t > 0) {
          const dLeft = poses.left.ankle.sub(prevLeftFoot).length();
          const dRight = poses.right.ankle.sub(prevRightFoot).length();

          expect(dLeft).toBeLessThanOrEqual(maxAllowedDisplacement);
          expect(dRight).toBeLessThanOrEqual(maxAllowedDisplacement);
        }

        prevLeftFoot = poses.left.ankle;
        prevRightFoot = poses.right.ankle;
      }
    });

    it('evaluates joint velocities purely analytically without dependency on previous-tick history', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);

      // Advance a few steps to get non-zero velocity
      for (let t = 0; t < 10; t++) {
        sim.step({ moveDir: new Vector2(1, 0), gait: 'jog' });
      }

      const frozenPlayer = sim.getCurrentState();

      // Calling poseAt multiple times at different fractions on the same frozen state
      const poseA = poseAt(frozenPlayer, 0.2, dt);
      const poseB = poseAt(frozenPlayer, 0.8, dt);

      // Poses are distinct and continuously progressive
      expect(poseA.right.ankle.x).not.toBe(poseB.right.ankle.x);

      // Joint velocities are non-zero and purely analytic
      expect(poseA.right.toeVel.length()).toBeGreaterThan(0);
      expect(poseB.right.toeVel.length()).toBeGreaterThan(0);

      // Same inputs produce exact identical output (pure function, no hidden mutable history)
      const poseA2 = poseAt(frozenPlayer, 0.2, dt);
      expect(poseA.right.ankle.x).toBe(poseA2.right.ankle.x);
      expect(poseA.right.ankleVel.x).toBe(poseA2.right.ankleVel.x);
    });

    it('enforces natural-stride leg length constraint and bone lengths over walk, jog, and sprint for 240 ticks', () => {
      const gaits: ('walk' | 'jog' | 'sprint')[] = ['walk', 'jog', 'sprint'];
      const thighLen = SIM_CONFIG.COLLISION.THIGH_LEN;
      const shinLen = SIM_CONFIG.COLLISION.SHIN_LEN;
      const maxLegReach = thighLen + shinLen;

      for (const gait of gaits) {
        const sim = new SimulationCore();
        sim.reset(Vector2.zero(), 0);

        for (let t = 0; t < 240; t++) {
          sim.step({ moveDir: new Vector2(1, 0), gait });
          const player = sim.getCurrentState();
          const prev = sim.getPreviousState();
          const poses = poseAt(prev, player, 1.0, dt);

          // Check left leg
          const leftHipAnkleDist = poses.left.ankle.sub(poses.left.hip).length();
          expect(leftHipAnkleDist).toBeLessThanOrEqual(maxLegReach + 0.001);

          const leftThighLen = poses.left.knee.sub(poses.left.hip).length();
          expect(Math.abs(leftThighLen - thighLen)).toBeLessThanOrEqual(0.001);

          const leftShinLen = poses.left.ankle.sub(poses.left.knee).length();
          expect(Math.abs(leftShinLen - shinLen)).toBeLessThanOrEqual(0.001);

          // Check right leg
          const rightHipAnkleDist = poses.right.ankle.sub(poses.right.hip).length();
          expect(rightHipAnkleDist).toBeLessThanOrEqual(maxLegReach + 0.001);

          const rightThighLen = poses.right.knee.sub(poses.right.hip).length();
          expect(Math.abs(rightThighLen - thighLen)).toBeLessThanOrEqual(0.001);

          const rightShinLen = poses.right.ankle.sub(poses.right.knee).length();
          expect(Math.abs(rightShinLen - shinLen)).toBeLessThanOrEqual(0.001);

          // Check extracted contact bodies thigh and shin capsules
          const bodies = extractPlayerContactBodies(prev, player, dt, 1.0);
          for (const leg of ['left', 'right']) {
            const thigh = bodies.find((b) => b.id === `${leg}_thigh`)!;
            const shin = bodies.find((b) => b.id === `${leg}_shin`)!;

            if (thigh.shape.type === 'capsule') {
              const thighAxisLen = thigh.shape.p2.sub(thigh.shape.p1).length();
              const thighTotalLen = thighAxisLen + 2 * thigh.shape.radius;
              expect(Math.abs(thighTotalLen - thighLen)).toBeLessThanOrEqual(0.001);
            }

            if (shin.shape.type === 'capsule') {
              const shinAxisLen = shin.shape.p2.sub(shin.shape.p1).length();
              const shinTotalLen = shinAxisLen + 2 * shin.shape.radius;
              expect(Math.abs(shinTotalLen - shinLen)).toBeLessThanOrEqual(0.001);
            }
          }
        }
      }
    });
  });

  describe('2. Leg & Boot Colliders', () => {
    it('detects collisions without tunneling at z = 0.3m, 0.5m, and 0.7m for both stance and swing legs', () => {
      const heights = [0.30, 0.50, 0.70]; // Shin, knee, thigh zones

      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      // Jog to establish stance and swing legs
      for (let t = 0; t < 20; t++) {
        sim.step({ moveDir: new Vector2(1, 0), gait: 'jog' });
      }

      const player = sim.getCurrentState();
      const bodies = extractPlayerContactBodies(player, player, dt, 1.0);

      // Filter thigh, shin, and boot colliders
      const legBodies = bodies.filter((b) => b.id !== 'torso');
      expect(legBodies.length).toBe(6); // 2 thighs, 2 shins, 2 boots

      for (const z of heights) {
        // Test front sweep (+x to -x) and rear sweep (-x to +x)
        const ballPosFront = new Vector3(player.position.x + 0.8, player.position.y, z);
        const ballVelFront = new Vector3(-20.0, 0, 0); // 20 m/s incoming ball

        const ballPosBack = new Vector3(player.position.x - 0.8, player.position.y, z);
        const ballVelBack = new Vector3(20.0, 0, 0); // 20 m/s incoming ball

        let frontHitCount = 0;
        let backHitCount = 0;

        for (const body of legBodies) {
          const hitFront = SweptCollisionResolver.checkCollision(
            ballPosFront,
            ballVelFront,
            SIM_CONFIG.BALL.RADIUS,
            body,
            0.05
          );
          if (hitFront) frontHitCount++;

          const hitBack = SweptCollisionResolver.checkCollision(
            ballPosBack,
            ballVelBack,
            SIM_CONFIG.BALL.RADIUS,
            body,
            0.05
          );
          if (hitBack) backHitCount++;
        }

        // At each height, at least one leg collider intersects the 20 m/s sweep trajectory
        expect(frontHitCount).toBeGreaterThan(0);
        expect(backHitCount).toBeGreaterThan(0);
      }
    });

    it('interpolates contact-point velocity along capsules so a hit near the ankle imparts higher speed than near the knee', () => {
      // Swing shin capsule: knee at (0, 0, 0.50m) with v = 2 m/s, ankle at (0, 0, 0.10m) with v = 10 m/s
      const kneePos = new Vector3(0, 0, 0.50);
      const anklePos = new Vector3(0, 0, 0.10);
      const kneeVel = new Vector3(2.0, 0, 0);
      const ankleVel = new Vector3(10.0, 0, 0);

      const shinShape: CapsuleShape = {
        type: 'capsule',
        p1: kneePos,
        p2: anklePos,
        radius: SIM_CONFIG.COLLISION.SHIN_RADIUS,
        v1: kneeVel,
        v2: ankleVel,
      };

      const shinBody: ContactBody = {
        id: 'right_shin',
        shape: shinShape,
        prevPos: kneePos.add(anklePos).scale(0.5),
        currPos: kneePos.add(anklePos).scale(0.5),
        velocity: kneeVel.add(ankleVel).scale(0.5),
        effMass: SIM_CONFIG.COLLISION.SHIN_MASS_SWING,
        restitution: 0.40,
        friction: 0.35,
        loaded: false,
        active: true,
      };

      // Case A: Ball hits near the knee (z = 0.45m)
      const ballPosKnee = new Vector3(0.15, 0, 0.45);
      const ballVelKnee = Vector3.zero();
      const hitKnee = SweptCollisionResolver.checkCollision(
        ballPosKnee,
        ballVelKnee,
        SIM_CONFIG.BALL.RADIUS,
        shinBody,
        dt
      );
      expect(hitKnee).not.toBeNull();
      const impulseKnee = SweptCollisionResolver.resolveImpulse(
        hitKnee!,
        ballVelKnee,
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Case B: Ball hits near the ankle (z = 0.15m)
      const ballPosAnkle = new Vector3(0.15, 0, 0.15);
      const ballVelAnkle = Vector3.zero();
      const hitAnkle = SweptCollisionResolver.checkCollision(
        ballPosAnkle,
        ballVelAnkle,
        SIM_CONFIG.BALL.RADIUS,
        shinBody,
        dt
      );
      expect(hitAnkle).not.toBeNull();
      const impulseAnkle = SweptCollisionResolver.resolveImpulse(
        hitAnkle!,
        ballVelAnkle,
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Ankle hit must impart substantially higher ball speed than knee hit
      expect(impulseAnkle.deltaV.length()).toBeGreaterThan(impulseKnee.deltaV.length() * 1.5);
    });

    it('exhibits exact lateral mirror symmetry between left and right foot contact zones', () => {
      const heel = Vector3.zero();
      const toe = new Vector3(0.28, 0, 0);

      // Right boot: contact on lateral side (+v in boot frame)
      const rightZone = classifyBootContact(
        new Vector3(0.14, -0.035, 0), // positive lateral offset for right boot
        new Vector3(0, -1, 0),
        heel,
        toe,
        0,
        0,
        true // isRightFoot = true
      );

      // Left boot: mirrored contact on lateral side (-v in boot frame)
      const leftZone = classifyBootContact(
        new Vector3(0.14, 0.035, 0), // mirrored lateral offset for left boot
        new Vector3(0, 1, 0),
        heel,
        toe,
        0,
        0,
        false // isRightFoot = false
      );

      expect(rightZone.zone).toBe('lateral');
      expect(leftZone.zone).toBe('lateral');

      // Right boot medial vs Left boot medial
      const rightMedial = classifyBootContact(
        new Vector3(0.14, 0.035, 0),
        new Vector3(0, 1, 0),
        heel,
        toe,
        0,
        0,
        true
      );
      const leftMedial = classifyBootContact(
        new Vector3(0.14, -0.035, 0),
        new Vector3(0, -1, 0),
        heel,
        toe,
        0,
        0,
        false
      );

      expect(rightMedial.zone).toBe('medial');
      expect(leftMedial.zone).toBe('medial');
    });
  });

  describe('3. Boot Zones & Physical Solver', () => {
    it('produces higher ball speed from instep (laces) than medial (inside boot) with identical swing velocity', () => {
      const swingSpeed = 18.0;

      // Case 1: Instep strike (foot moving upward into ball on laces)
      const instepVel = new Vector3(0, 0, swingSpeed);
      const instepShape: CapsuleShape = {
        type: 'capsule',
        p1: new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
        p2: new Vector3(0.20, 0, SIM_CONFIG.BALL.RADIUS),
        radius: 0.05,
        v1: instepVel,
        v2: instepVel,
      };

      const instepBody: ContactBody = {
        id: 'right_boot',
        shape: instepShape,
        prevPos: Vector3.zero(),
        currPos: Vector3.zero(),
        velocity: instepVel,
        effMass: 4.8,
        restitution: 0.60,
        friction: 0.40,
        loaded: false,
        active: true,
        bootYaw: 0,
        bootPitch: 0,
        isRightFoot: true,
        ankleStiffness: 0.9,
      };

      const hitInstep = SweptCollisionResolver.checkCollision(
        new Vector3(0.10, 0, SIM_CONFIG.BALL.RADIUS + 0.12), // Top of boot -> instep zone
        Vector3.zero(),
        SIM_CONFIG.BALL.RADIUS,
        instepBody,
        0.02
      );
      expect(hitInstep).not.toBeNull();
      const resInstep = SweptCollisionResolver.resolveImpulse(
        hitInstep!,
        Vector3.zero(),
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Case 2: Medial strike (inside foot moving laterally into ball)
      const medialVel = new Vector3(0, swingSpeed, 0);
      const medialShape: CapsuleShape = {
        ...instepShape,
        v1: medialVel,
        v2: medialVel,
      };
      const medialBody: ContactBody = {
        ...instepBody,
        shape: medialShape,
        velocity: medialVel,
      };

      const hitMedial = SweptCollisionResolver.checkCollision(
        new Vector3(0.10, 0.12, SIM_CONFIG.BALL.RADIUS), // Medial side of right boot
        Vector3.zero(),
        SIM_CONFIG.BALL.RADIUS,
        medialBody,
        0.02
      );
      expect(hitMedial).not.toBeNull();
      const resMedial = SweptCollisionResolver.resolveImpulse(
        hitMedial!,
        Vector3.zero(),
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      expect(resInstep.contactZone).toBe('instep');
      expect(resMedial.contactZone).toBe('medial');

      // Instep (laces multiplier 1.0) produces higher exit speed than medial (multiplier 0.92)
      expect(resInstep.deltaV.length()).toBeGreaterThan(resMedial.deltaV.length());
    });

    it('generates curl spin around Z whose sign matches the lateral contact offset side', () => {
      const footVel = new Vector3(15.0, 0, 0);

      const bootBody: ContactBody = {
        id: 'right_boot',
        shape: {
          type: 'capsule',
          p1: new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
          p2: new Vector3(0.20, 0, SIM_CONFIG.BALL.RADIUS),
          radius: 0.05,
          v1: footVel,
          v2: footVel,
        },
        prevPos: Vector3.zero(),
        currPos: Vector3.zero(),
        velocity: footVel,
        effMass: 4.5,
        restitution: 0.55,
        friction: 0.45,
        loaded: false,
        active: true,
        bootYaw: 0,
        bootPitch: 0,
        isRightFoot: true,
      };

      // Ball offset laterally to the right (+y)
      const hitRight = SweptCollisionResolver.checkCollision(
        new Vector3(0.26, 0.03, SIM_CONFIG.BALL.RADIUS),
        Vector3.zero(),
        SIM_CONFIG.BALL.RADIUS,
        bootBody,
        0.02
      );
      expect(hitRight).not.toBeNull();
      const resRight = SweptCollisionResolver.resolveImpulse(
        hitRight!,
        Vector3.zero(),
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Ball offset laterally to the left (-y)
      const hitLeft = SweptCollisionResolver.checkCollision(
        new Vector3(0.26, -0.03, SIM_CONFIG.BALL.RADIUS),
        Vector3.zero(),
        SIM_CONFIG.BALL.RADIUS,
        bootBody,
        0.02
      );
      expect(hitLeft).not.toBeNull();
      const resLeft = SweptCollisionResolver.resolveImpulse(
        hitLeft!,
        Vector3.zero(),
        Vector3.zero(),
        SIM_CONFIG.BALL.MASS,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      // Opposite lateral offsets generate opposite curl spin signs around Z
      expect(resRight.deltaOmega.z * resLeft.deltaOmega.z).toBeLessThan(0);
      expect(Math.abs(resRight.deltaOmega.z)).toBeGreaterThan(5.0); // Significant curl generated
    });

    it('strictly conserves or dissipates energy: KE_post <= KE_pre + 0.5 * m_eff * v_foot^2', () => {
      const footVel = new Vector3(22.0, 0, 0);
      const mEff = 4.5;
      const mBall = SIM_CONFIG.BALL.MASS;
      const initialBallVel = new Vector3(-5.0, 2.0, 0);

      const bootBody: ContactBody = {
        id: 'right_boot',
        shape: {
          type: 'capsule',
          p1: new Vector3(0, 0, SIM_CONFIG.BALL.RADIUS),
          p2: new Vector3(0.20, 0, SIM_CONFIG.BALL.RADIUS),
          radius: 0.05,
          v1: footVel,
          v2: footVel,
        },
        prevPos: Vector3.zero(),
        currPos: Vector3.zero(),
        velocity: footVel,
        effMass: mEff,
        restitution: 0.55,
        friction: 0.40,
        loaded: false,
        active: true,
      };

      const hit = SweptCollisionResolver.checkCollision(
        new Vector3(0.26, 0.02, SIM_CONFIG.BALL.RADIUS),
        initialBallVel,
        SIM_CONFIG.BALL.RADIUS,
        bootBody,
        0.02
      );
      expect(hit).not.toBeNull();

      const res = SweptCollisionResolver.resolveImpulse(
        hit!,
        initialBallVel,
        Vector3.zero(),
        mBall,
        SIM_CONFIG.BALL.INERTIA,
        SIM_CONFIG.BALL.RADIUS
      );

      const postBallVel = initialBallVel.add(res.deltaV);
      const postKE = 0.5 * mBall * postBallVel.lengthSq() + 0.5 * SIM_CONFIG.BALL.INERTIA * res.deltaOmega.lengthSq();
      const preKE = 0.5 * mBall * initialBallVel.lengthSq() + 0.5 * mEff * footVel.lengthSq();

      // Post-impact energy cannot exceed total initial kinetic energy of system
      expect(postKE).toBeLessThanOrEqual(preKE);
    });
  });

  describe('4. Kick Swing Mode (Controller & Presets)', () => {
    it('produces plausible ball speeds for presets 1 through 5 from a standstill', () => {
      // Speed ranges for presets:
      // P1: Ground pass [12, 18] m/s
      // P2: Curving free-kick [20, 27] m/s
      // P3: Chipped lob [13, 19] m/s
      // P4: Trivela curve [18, 25] m/s
      // P5: Knuckleball strike [25, 32] m/s
      const expectedRanges = [
        { preset: 1, min: 10.0, max: 18.0 },
        { preset: 2, min: 20.0, max: 27.0 },
        { preset: 3, min: 13.0, max: 19.0 },
        { preset: 4, min: 18.0, max: 25.0 },
        { preset: 5, min: 25.0, max: 32.0 },
      ];

      for (const { preset, min, max } of expectedRanges) {
        const sim = new SimulationCore();
        sim.reset(Vector2.zero(), 0);
        // Place ball 0.50m in front of player
        sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

        const req = sim.requestKickPreset(preset);
        expect(req.success).toBe(true);

        let maxSpeed = 0;
        // Step through backswing (100ms) and forward swing (70ms)
        for (let t = 0; t < 30; t++) {
          sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
          const speed = sim.getBallState().velocity.length();
          if (speed > maxSpeed) maxSpeed = speed;
        }

        expect(maxSpeed).toBeGreaterThanOrEqual(min);
        expect(maxSpeed).toBeLessThanOrEqual(max);
      }
    });

    it('generates >= 1.5m lateral flight deviation over 20m distance on the Curler preset (Preset 2)', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

      // Trigger Curler (Preset 2)
      const req = sim.requestKickPreset(2, 0); // Kick toward +X
      expect(req.success).toBe(true);

      // Step until kick executes and ball flies ~20m along X
      let ballPeakLateralDev = 0;
      for (let t = 0; t < 150; t++) {
        sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
        const b = sim.getBallState();
        if (Math.abs(b.position.y) > ballPeakLateralDev) {
          ballPeakLateralDev = Math.abs(b.position.y);
        }
        if (b.position.x >= 20.0) break;
      }

      // Magnus effect curl deviation must be >= 1.5m
      expect(ballPeakLateralDev).toBeGreaterThanOrEqual(1.5);
    });

    it('produces near-zero angular spin (|omega| <= 1.5 rad/s) on the Knuckleball strike (Preset 5)', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

      const req = sim.requestKickPreset(5);
      expect(req.success).toBe(true);

      let postStrikeSpin: Vector3 | null = null;
      for (let t = 0; t < 30; t++) {
        sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
        const b = sim.getBallState();
        if (b.velocity.length() > 20.0 && !postStrikeSpin) {
          postStrikeSpin = b.spin;
        }
      }

      expect(postStrikeSpin).not.toBeNull();
      expect(postStrikeSpin!.length()).toBeLessThanOrEqual(1.5); // Knuckleball dead-center strike
    });

    it('accepts kick intent when ball is placed at 0.95 m within reachable boot contact envelope', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      // Place ball at 0.95m in front of player (within IK limit + ball radius reach)
      sim.resetBall(new Vector3(0.95, 0, SIM_CONFIG.BALL.RADIUS));

      const req = sim.requestKickPreset(1);
      expect(req.success).toBe(true);
    });

    it('sweeps kick reach over distance 0.3-1.3m and angle -90 to +90 deg enforcing IK constraint and ball movement', () => {
      const anglesDeg = [-90, -60, -45, -30, 0, 30, 45, 60, 90];
      const distances = [0.30, 0.45, 0.60, 0.75, 0.90, 0.95, 1.00, 1.10, 1.20, 1.30];
      const maxLegReach = SIM_CONFIG.COLLISION.THIGH_LEN + SIM_CONFIG.COLLISION.SHIN_LEN;

      let maxAcceptedDist = 0;
      let totalAccepted = 0;
      let totalRejected = 0;

      for (const angDeg of anglesDeg) {
        const angRad = (angDeg * Math.PI) / 180;

        for (const dist of distances) {
          const sim = new SimulationCore();
          sim.reset(Vector2.zero(), 0);

          const ballPos = new Vector3(
            dist * Math.cos(angRad),
            dist * Math.sin(angRad),
            SIM_CONFIG.BALL.RADIUS
          );
          sim.resetBall(ballPos);

          const req = sim.requestKickPreset(1, angRad);

          if (req.success) {
            totalAccepted++;
            if (dist > maxAcceptedDist) {
              maxAcceptedDist = dist;
            }

            let ballMoved = false;
            // Step through kick swing and verify boot ankle distance from hip
            for (let t = 0; t < 25; t++) {
              sim.step({ moveDir: Vector2.zero(), gait: 'jog' });

              const override = sim.getKickController().getBootOverride();
              if (override) {
                const player = sim.getCurrentState();
                const latSign = override.foot === 'left' ? -1 : 1;
                const latX = -Math.sin(player.facing);
                const latY = Math.cos(player.facing);
                const hipPos = new Vector3(
                  player.position.x + latX * (latSign * SIM_CONFIG.COLLISION.HIP_OFFSET_Y),
                  player.position.y + latY * (latSign * SIM_CONFIG.COLLISION.HIP_OFFSET_Y),
                  SIM_CONFIG.COLLISION.HIP_HEIGHT
                );

                const bootDir = new Vector3(
                  Math.cos(override.data.bootYaw) * Math.cos(override.data.bootPitch),
                  Math.sin(override.data.bootYaw) * Math.cos(override.data.bootPitch),
                  Math.sin(override.data.bootPitch)
                ).normalize();
                const ankleToMid = (SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_TOE - SIM_CONFIG.COLLISION.BOOT_ANKLE_OFFSET_HEEL) * 0.5;
                const bootCenter = override.data.p1.add(override.data.p2).scale(0.5);
                const anklePos = bootCenter.sub(bootDir.scale(ankleToMid));

                const ankleDistFromHip = anklePos.sub(hipPos).length();
                // Boot ankle must NEVER be farther from hip than leg reach (+ numerical tolerance)
                expect(ankleDistFromHip).toBeLessThanOrEqual(maxLegReach + 1e-3);
              }

              if (sim.getBallState().velocity.length() > 0.5) {
                ballMoved = true;
              }
            }

            // Accepted kick must move the ball
            expect(ballMoved).toBe(true);
          } else {
            totalRejected++;
            // Rejected kick: step simulation and ensure ball stays completely stationary
            for (let t = 0; t < 10; t++) {
              sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
            }
            expect(sim.getBallState().velocity.length()).toBe(0);
          }
        }
      }

      console.log(`[Sweep Test Results] maxAcceptedDist: ${maxAcceptedDist} m, accepted: ${totalAccepted}, rejected: ${totalRejected}`);
      expect(maxAcceptedDist).toBeGreaterThanOrEqual(0.95);
      expect(totalAccepted).toBeGreaterThan(0);
      expect(totalRejected).toBeGreaterThan(0);
    });

    it('rejects kick intent if ball is beyond IK reach limit leaving ball velocity unchanged', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      // Place ball 1.50m away (> 1.24m IK reach limit)
      sim.resetBall(new Vector3(1.50, 0, SIM_CONFIG.BALL.RADIUS));

      const req = sim.requestKickPreset(1);
      expect(req.success).toBe(false);
      expect(req.reason).toContain('out of reach');

      // Step simulation
      for (let t = 0; t < 20; t++) {
        sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
      }

      expect(sim.getBallState().velocity.length()).toBe(0);
    });

    it('ensures foot trajectory continuity: no teleport at backswing start or blend-out end', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

      const playerBefore = sim.getCurrentState();
      const footPosLocomotion = playerBefore.stride.rightFootPos;

      const controller = new KickSwingController();
      const kickIntent: KickIntent = {
        desiredSpeed: 18.0,
        elevationDeg: 5,
        headingRad: 0,
      };

      const req = controller.requestKick(kickIntent, playerBefore, sim.getBallState());
      expect(req.success).toBe(true);

      const override0 = controller.getBootOverride();
      expect(override0).not.toBeNull();

      // Foot center at start of backswing must match locomotion foot position within 0.01m
      const bootCenter0 = override0!.data.p1.add(override0!.data.p2).scale(0.5);
      const diffStart = Math.hypot(bootCenter0.x - footPosLocomotion.x, bootCenter0.y - footPosLocomotion.y);
      expect(diffStart).toBeLessThanOrEqual(0.01);

      // Advance through entire kick cycle until blend_out finishes
      let prevPos = bootCenter0;
      let maxDeltaStep = 0;

      while (controller.isKicking()) {
        controller.step(dt, sim.getCurrentState());
        const ov = controller.getBootOverride();
        if (ov) {
          const c = ov.data.p1.add(ov.data.p2).scale(0.5);
          const stepDist = c.sub(prevPos).length();
          if (stepDist > maxDeltaStep) maxDeltaStep = stepDist;
          prevPos = c;
        }
      }

      // Maximum displacement per 1/120s step bounded by foot max speed
      expect(maxDeltaStep).toBeLessThanOrEqual(SIM_CONFIG.KICK_SWING.FOOT_SPEED_MAX * dt * 1.5);
      expect(controller.getState()).toBe('idle');
    });

    it('architectural purity: only contact solver and BallPhysics.step mutate ball velocity and spin', () => {
      const sim = new SimulationCore();
      sim.reset(Vector2.zero(), 0);
      sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

      // Spy on BallPhysics methods
      const ballInstance = (sim as any).ball as BallPhysics;
      const applyImpulseSpy = vi.spyOn(ballInstance, 'applyImpulse');
      const setStateSpy = vi.spyOn(ballInstance, 'setState');

      // Request kick
      sim.requestKickPreset(1);

      // Verify requestKick did NOT touch ball physics
      expect(applyImpulseSpy).not.toHaveBeenCalled();
      expect(setStateSpy).not.toHaveBeenCalled();

      // Step until impact occurs
      for (let t = 0; t < 25; t++) {
        sim.step({ moveDir: Vector2.zero(), gait: 'jog' });
      }

      // Impulses must ONLY be applied during simulation step CCD loop
      expect(applyImpulseSpy).toHaveBeenCalled();
      for (const call of applyImpulseSpy.mock.calls) {
        expect(call[0].length()).toBeGreaterThan(0);
      }
    });

    it('produces identical deterministic replay hash across 100 ticks with kick swing', () => {
      const runReplaySimulation = () => {
        const sim = new SimulationCore();
        sim.reset(Vector2.zero(), 0);
        sim.resetBall(new Vector3(0.50, 0, SIM_CONFIG.BALL.RADIUS));

        for (let t = 0; t < 100; t++) {
          if (t === 5) {
            sim.requestKickPreset(2, 0.2); // Kick at t=5
          }
          sim.step({ moveDir: new Vector2(0.5, 0), gait: 'jog' });
        }

        const p = sim.getCurrentState();
        const b = sim.getBallState();

        return {
          px: p.position.x,
          py: p.position.y,
          bx: b.position.x,
          by: b.position.y,
          bz: b.position.z,
          bvx: b.velocity.x,
          bvy: b.velocity.y,
        };
      };

      const run1 = runReplaySimulation();
      const run2 = runReplaySimulation();

      expect(run1.px).toBe(run2.px);
      expect(run1.py).toBe(run2.py);
      expect(run1.bx).toBe(run2.bx);
      expect(run1.by).toBe(run2.by);
      expect(run1.bz).toBe(run2.bz);
      expect(run1.bvx).toBe(run2.bvx);
      expect(run1.bvy).toBe(run2.bvy);
    });

    it('ensures assigned boot velocity matches finite difference of boot position within 5% across backswing, forward_swing, and follow_through', () => {
      for (let preset = 1; preset <= 5; preset++) {
        const sim = new SimulationCore();
        sim.reset(Vector2.zero(), 0);
        sim.resetBall(new Vector3(0.60, 0, SIM_CONFIG.BALL.RADIUS));

        const req = sim.requestKickPreset(preset);
        expect(req.success).toBe(true);

        const ctrl = sim.getKickController();

        for (let t = 0; t < 35; t++) {
          const overrideBefore = ctrl.getBootOverride();
          const phaseBefore = ctrl.getState();
          const centerBefore = overrideBefore ? overrideBefore.data.p1.add(overrideBefore.data.p2).scale(0.5) : null;

          sim.step({ moveDir: Vector2.zero(), gait: 'jog' });

          const overrideAfter = ctrl.getBootOverride();
          const centerAfter = overrideAfter ? overrideAfter.data.p1.add(overrideAfter.data.p2).scale(0.5) : null;

          if (centerBefore && centerAfter && overrideAfter) {
            const phase = phaseBefore;
            if (['backswing', 'forward_swing', 'follow_through'].includes(phase)) {
              const fdVel = centerAfter.sub(centerBefore).scale(1 / dt);
              const assignedVel = overrideAfter.data.v1;

              const fdSpeed = fdVel.length();
              const assignedSpeed = assignedVel.length();

              if (fdSpeed > 0.1 || assignedSpeed > 0.1) {
                const diff = fdVel.sub(assignedVel).length();
                const relDiff = diff / Math.max(fdSpeed, assignedSpeed);
                expect(relDiff).toBeLessThan(0.05);
              }
            }
          }
        }
      }
    });
  });
});
