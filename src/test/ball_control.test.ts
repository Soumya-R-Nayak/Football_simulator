import { describe, expect, it } from 'vitest';
import { Vector3 } from '../math/Vector3';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { getControlledBootResponse } from '../sim/collision/BallControl';
import { ContactBody } from '../sim/collision/ContactBody';
import { ContactManifold, SweptCollisionResolver } from '../sim/collision/SweptCollision';
import { KeyboardInputManager } from '../sim/input/keybindings';
import { SimulationCore } from '../sim/SimulationCore';
import { BallControlIntent, PLAYER_PRESETS } from '../sim/types';

function makeBoot(id: 'left_boot' | 'right_boot' = 'right_boot'): ContactBody {
  return {
    id,
    shape: {
      type: 'capsule',
      p1: new Vector3(-0.14, 0, 0.11),
      p2: new Vector3(0.14, 0, 0.11),
      radius: SIM_CONFIG.COLLISION.BOOT_RADIUS,
      v1: Vector3.zero(),
      v2: Vector3.zero(),
    },
    prevPos: Vector3.zero(),
    currPos: Vector3.zero(),
    velocity: Vector3.zero(),
    effMass: SIM_CONFIG.COLLISION.BOOT_MAX_MASS,
    restitution: SIM_CONFIG.COLLISION.BOOT_MAX_RESTITUTION,
    friction: SIM_CONFIG.COLLISION.BOOT_FRICTION,
    loaded: false,
    active: true,
    bootYaw: 0,
    bootPitch: 0,
    isRightFoot: id === 'right_boot',
    ankleStiffness: 1,
  };
}

function resolveIncomingBall(
  body: ContactBody,
  incomingSpeed: number,
  response?: ReturnType<typeof getControlledBootResponse>
): number {
  const manifold: ContactManifold = {
    hasImpact: true,
    toi: 0,
    contactPoint: new Vector3(0.14, 0, 0.11),
    normal: new Vector3(1, 0, 0),
    penetration: 0,
    body,
  };
  const impulse = SweptCollisionResolver.resolveImpulse(
    manifold,
    new Vector3(-incomingSpeed, 0, 0),
    Vector3.zero(),
    SIM_CONFIG.BALL.MASS,
    SIM_CONFIG.BALL.INERTIA,
    SIM_CONFIG.BALL.RADIUS,
    response
  );
  return new Vector3(-incomingSpeed, 0, 0).add(impulse.deltaV).length();
}

describe('receive-and-cushion ball control', () => {
  it('maps the receive modifier to the simulation intent while held', () => {
    const manager = new KeyboardInputManager();
    const target = new EventTarget();
    const detach = manager.attachListeners(target);
    const dispatchKey = (type: 'keydown' | 'keyup') => {
      const event = new Event(type) as KeyboardEvent;
      Object.defineProperties(event, {
        code: { value: 'KeyR' },
        repeat: { value: false },
      });
      target.dispatchEvent(event);
    };

    dispatchKey('keydown');
    expect(manager.sampleIntent(SIM_CONFIG.LOOP.FIXED_DT).ballControl).toEqual({ mode: 'receive' });
    dispatchKey('keyup');
    expect(manager.sampleIntent(SIM_CONFIG.LOOP.FIXED_DT).ballControl).toBeUndefined();
    detach();
  });

  function simulateRollingReceive(control?: BallControlIntent): { speed: number; zone: string } | null {
    const sim = new SimulationCore(Vector2.zero(), 0);
    sim.setAttributes({ ...PLAYER_PRESETS.balanced, firstTouch: 90 });
    sim.resetBall(new Vector3(0.9, 0.14, SIM_CONFIG.BALL.RADIUS));
    sim.kickBall(4, 0, Math.PI);

    for (let i = 0; i < 90; i++) {
      sim.step({ moveDir: Vector2.zero(), gait: 'walk', ballControl: control });
      const marker = sim.getKickController().getLastContactMarker();
      if (marker) return { speed: sim.getBallState().velocity.length(), zone: marker.zone };
    }
    return null;
  }

  it('routes receive intent through a real rolling-ball boot collision', () => {
    const passive = simulateRollingReceive();
    const received = simulateRollingReceive({ mode: 'receive', preferredFoot: 'right' });

    expect(passive).not.toBeNull();
    expect(received).not.toBeNull();
    expect(received!.zone).toBe('toe');
    expect(received!.speed).toBeLessThan(passive!.speed);
  });

  it('reduces a reachable boot impact through the physical impulse solver', () => {
    const body = makeBoot();
    const attributes = { ...PLAYER_PRESETS.balanced, firstTouch: 90 };
    const response = getControlledBootResponse({ mode: 'receive' }, body, attributes);

    const passiveExitSpeed = resolveIncomingBall(body, 4);
    const controlledExitSpeed = resolveIncomingBall(body, 4, response);

    expect(response).not.toBeNull();
    expect(controlledExitSpeed).toBeLessThan(passiveExitSpeed);
    expect(controlledExitSpeed).toBeGreaterThan(0);
  });

  it('makes high-speed cushions harder and lets first-touch skill improve the result', () => {
    const body = makeBoot();
    const highSkill = getControlledBootResponse(
      { mode: 'trap' }, body, { ...PLAYER_PRESETS.balanced, firstTouch: 95 }
    );
    const lowSkill = getControlledBootResponse(
      { mode: 'trap' }, body, { ...PLAYER_PRESETS.balanced, firstTouch: 20 }
    );

    expect(resolveIncomingBall(body, 4, highSkill)).toBeLessThan(resolveIncomingBall(body, 4, lowSkill));
    expect(resolveIncomingBall(body, 9, highSkill)).toBeGreaterThan(resolveIncomingBall(body, 4, highSkill));
  });

  it('leaves passive contacts and non-selected boots under the ordinary collision response', () => {
    const rightBoot = makeBoot('right_boot');
    const leftBoot = makeBoot('left_boot');
    const attributes = PLAYER_PRESETS.balanced;

    expect(getControlledBootResponse({ mode: 'receive', preferredFoot: 'left' }, rightBoot, attributes)).toBeNull();
    expect(getControlledBootResponse({ mode: 'receive', preferredFoot: 'left' }, leftBoot, attributes)).not.toBeNull();
    expect(getControlledBootResponse(undefined, rightBoot, attributes)).toBeNull();
    expect(getControlledBootResponse({ mode: 'receive' }, { ...rightBoot, id: 'right_shin' }, attributes)).toBeNull();
  });
});
