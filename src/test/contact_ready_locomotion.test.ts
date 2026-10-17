import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { SimulationCore } from '../sim/SimulationCore';
import { extractPlayerContactBodies } from '../sim/collision/ContactBody';
import { poseAt } from '../sim/collision/LegKinematics';
import { getPlayerLegDimensions, SIM_CONFIG } from '../sim/config';
import { StrideEngine } from '../sim/locomotion/StrideEngine';
import { Intent } from '../sim/types';

describe('contact-ready locomotion state', () => {
  it('scales hip height and both IK leg segments with player stature', () => {
    const posesByHeight = [165, 180, 198].map((heightCm) => {
      const sim = new SimulationCore();
      sim.setAttributes({ ...sim.getCurrentState().attributes, heightCm });
      sim.reset(Vector2.zero(), 0);
      const state = sim.getCurrentState();
      const pose = poseAt(state, state, 1, SIM_CONFIG.LOOP.FIXED_DT).left;
      return { heightCm, pose };
    });

    for (const { heightCm, pose } of posesByHeight) {
      const scale = heightCm / 180;
      expect(pose.hip.sub(pose.knee).length()).toBeCloseTo(SIM_CONFIG.COLLISION.THIGH_LEN * scale, 4);
      expect(pose.knee.sub(pose.ankle).length()).toBeCloseTo(SIM_CONFIG.COLLISION.SHIN_LEN * scale, 4);
    }
    expect(posesByHeight[0].pose.hip.z).toBeLessThan(posesByHeight[1].pose.hip.z);
    expect(posesByHeight[1].pose.hip.z).toBeLessThan(posesByHeight[2].pose.hip.z);
  });

  it('keeps cadence continuous across the fast-walk speed ceiling', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const getCadence = (speed: number) => new StrideEngine(Vector2.zero(), 0)
      .step(
        dt,
        speed,
        true,
        false,
        Vector2.zero(),
        0,
        0,
        0,
        false,
        new Vector2(speed, 0),
        Vector2.zero()
      ).strideState.cadence;

    const justBelow = getCadence(SIM_CONFIG.GAIT_SPEEDS.walk - 0.001);
    const justAbove = getCadence(SIM_CONFIG.GAIT_SPEEDS.walk + 0.001);
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(0.1);
  });

  it('publishes finite 3D COM and foot contact data for Slice 3', () => {
    const sim = new SimulationCore();
    sim.resetBall(new Vector3(100, 100, 0.11));
    const intent: Intent = { moveDir: new Vector2(1, 0), gait: 'sprint' };

    for (let i = 0; i < 240; i++) sim.step(intent);

    const contact = sim.getCurrentState().contactState;
    expect(contact).toBeDefined();
    expect(Number.isFinite(contact!.centerOfMass.z)).toBe(true);
    expect(Number.isFinite(contact!.centerOfMassVelocity.z)).toBe(true);
    expect(Number.isFinite(contact!.supportMarginM)).toBe(true);
    expect(Number.isFinite(contact!.centerOfMassAcceleration.x)).toBe(true);
    expect(Number.isFinite(contact!.centerOfMassAcceleration.y)).toBe(true);
    for (const foot of [contact!.leftFoot, contact!.rightFoot]) {
      expect(Number.isFinite(foot.position.x)).toBe(true);
      expect(Number.isFinite(foot.position.y)).toBe(true);
      expect(Number.isFinite(foot.position.z)).toBe(true);
      expect(Number.isFinite(foot.velocity.x)).toBe(true);
      expect(Number.isFinite(foot.velocity.y)).toBe(true);
      expect(Number.isFinite(foot.velocity.z)).toBe(true);
      expect(foot.normalLoadN).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps a planted foot anchored and simulates vertical flight', () => {
    const sim = new SimulationCore();
    let previous = sim.getCurrentState();
    let maximumComHeight = previous.contactState!.centerOfMass.z;
    let maxPlantDrift = 0;

    for (let i = 0; i < 360; i++) {
      sim.step({ moveDir: new Vector2(1, 0), gait: 'sprint' });
      const current = sim.getCurrentState();
      maximumComHeight = Math.max(maximumComHeight, current.contactState!.centerOfMass.z);
      const totalFootLoad = current.contactState!.leftFoot.normalLoadN + current.contactState!.rightFoot.normalLoadN;
      if (current.stride.phase === 'flight') expect(totalFootLoad).toBe(0);
      else expect(totalFootLoad).toBeGreaterThanOrEqual(0);

      for (const footId of ['leftFoot', 'rightFoot'] as const) {
        const before = previous.contactState![footId];
        const after = current.contactState![footId];
        const samePlant = previous.stride.currentFoot === current.stride.currentFoot ||
          (previous.stride.isDoubleSupport && current.stride.isDoubleSupport);
        if (samePlant && before.inContact && after.inContact) {
          maxPlantDrift = Math.max(maxPlantDrift, before.position.sub(after.position).length());
        }
      }
      previous = current;
    }

    expect(maxPlantDrift).toBeLessThan(0.01);
    expect(maximumComHeight).toBeGreaterThan(0.99 + 0.015);
    expect(sim.getCurrentState().contactState!.centerOfMass.z).toBeGreaterThan(0.80);
  });

  it('transfers normal load from the trailing foot to the incoming foot during double support', () => {
    const sim = new SimulationCore();
    const dt = SIM_CONFIG.LOOP.FIXED_DT;
    const intent: Intent = { moveDir: new Vector2(1, 0), gait: 'walk' };
    let loadRatioAtOverlapStart: number | null = null;
    let loadRatioNearOverlapEnd: number | null = null;

    for (let i = 0; i < 1200; i++) {
      sim.step(intent, dt);
      const state = sim.getCurrentState();
      if (!state.stride.isDoubleSupport || state.velocity.length() < 0.15) continue;

      const currentFootLoad = state.stride.currentFoot === 'left'
        ? state.contactState!.leftFoot.normalLoadN
        : state.contactState!.rightFoot.normalLoadN;
      const incomingFootLoad = state.stride.currentFoot === 'left'
        ? state.contactState!.rightFoot.normalLoadN
        : state.contactState!.leftFoot.normalLoadN;
      const totalLoad = currentFootLoad + incomingFootLoad;

      if (state.stride.phaseProgress >= 0.79 && state.stride.phaseProgress <= 0.80) {
        loadRatioAtOverlapStart = currentFootLoad / totalLoad;
      }
      if (state.stride.phaseProgress >= 0.95) {
        loadRatioNearOverlapEnd = currentFootLoad / totalLoad;
      }

      expect(totalLoad).toBeCloseTo(
        state.attributes.weightKg * (9.81 + state.contactState!.centerOfMassAcceleration.z),
        5
      );
    }

    expect(loadRatioAtOverlapStart).not.toBeNull();
    expect(loadRatioNearOverlapEnd).not.toBeNull();
    expect(loadRatioAtOverlapStart!).toBeGreaterThan(0.9);
    expect(loadRatioNearOverlapEnd!).toBeLessThan(0.1);
  });

  it('feeds the reported foot pose into Slice 3 contact bodies', () => {
    const sim = new SimulationCore();
    sim.resetBall(new Vector3(100, 100, 0.11));
    const dt = 1 / 120;
    for (let i = 0; i < 30; i++) sim.step({ moveDir: new Vector2(1, 0), gait: 'sprint' }, dt);

    const previous = sim.getPreviousState();
    const current = sim.getCurrentState();
    const bodies = extractPlayerContactBodies(previous, current, dt);
    for (const [bodyId, foot] of [
      ['left_boot', current.contactState!.leftFoot],
      ['right_boot', current.contactState!.rightFoot],
    ] as const) {
      const body = bodies.find((item) => item.id === bodyId)!;
      expect(body.shape.type).toBe('capsule');
      if (body.shape.type === 'capsule') {
        const center = body.shape.p1.add(body.shape.p2).scale(0.5);
        expect(center.sub(foot.position).length()).toBeLessThan(0.15);
      }
    }
  });

  it('keeps planted feet within a plausible COM reach without collapsing the pelvis', () => {
    const dt = SIM_CONFIG.LOOP.FIXED_DT;

    for (const heightCm of [165, 180, 198]) {
      const scale = heightCm / 180;
      const expectedHipFloor = getPlayerLegDimensions(heightCm).hipHeight +
        SIM_CONFIG.PLAYER_BODY.VERTICAL_COM_MIN_OFFSET;

      for (const gait of ['walk', 'jog', 'sprint'] as const) {
        const sim = new SimulationCore();
        sim.setAttributes({ ...sim.getCurrentState().attributes, heightCm });
        sim.reset(Vector2.zero(), 0);
        const intent: Intent = { moveDir: new Vector2(1, 0), gait };

        for (let i = 0; i < 240; i++) sim.step(intent, dt);

        let minimumLoadedHipHeight = Infinity;
        let maximumLoadedFootOffset = 0;
        let maximumLoadedAnkleError = 0;
        for (let i = 0; i < 720; i++) {
          sim.step(intent, dt);
          const previous = sim.getPreviousState();
          const current = sim.getCurrentState();
          const poses = poseAt(previous, current, 1, dt);

          for (const [footName, poseName] of [
            ['leftFoot', 'left'],
            ['rightFoot', 'right'],
          ] as const) {
            const footContact = current.contactState![footName];
            if (!footContact.inContact) continue;

            const pose = poses[poseName];
            minimumLoadedHipHeight = Math.min(minimumLoadedHipHeight, pose.hip.z);
            maximumLoadedAnkleError = Math.max(
              maximumLoadedAnkleError,
              pose.ankle.sub(footContact.position).length()
            );
            const loadedFootOffset = Math.hypot(
              footContact.position.x - current.contactState!.centerOfMass.x,
              footContact.position.y - current.contactState!.centerOfMass.y
            );
            if (loadedFootOffset > maximumLoadedFootOffset) {
              maximumLoadedFootOffset = loadedFootOffset;
            }
          }
        }

        expect(minimumLoadedHipHeight, `${heightCm} cm ${gait}`).toBeGreaterThanOrEqual(expectedHipFloor - 0.04);
        // During loaded stance, the COM moves past the fixed touchdown anchor;
        // validate the full stance reach separately from the tighter placement cap.
        expect(maximumLoadedFootOffset, `${heightCm} cm ${gait}`).toBeLessThanOrEqual(0.65 * scale);
        expect(maximumLoadedAnkleError).toBeLessThanOrEqual(0.02);
      }
    }
  });
});
