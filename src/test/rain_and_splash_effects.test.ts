import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { PitchSurface } from '../sim/physics/PitchSurface';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { PlayerState, BallState, Intent } from '../sim/types';

// Lightweight headless mock Canvas & 2D Context
function createMockCanvas(): HTMLCanvasElement {
  const mockGradient = {
    addColorStop: () => {},
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => mockGradient;
      }
      return () => {};
    },
    set(_target, _prop, _value) {
      return true;
    },
  };

  const mockCtx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 1920,
    height: 1080,
    getContext: (type: string) => (type === '2d' ? mockCtx : null),
  } as unknown as HTMLCanvasElement;

  return canvas;
}

function createDummyPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'player-1',
    position: new Vector2(0, 0),
    velocity: new Vector2(0, 0),
    facing: 0,
    angularVelocity: 0,
    stamina: 1.0,
    gait: 'jog',
    stride: {
      currentFoot: 'right',
      phase: 'flight',
      phaseProgress: 0.5,
      cadence: 2.8,
      strideLength: 1.4,
      plantPosition: null,
      stanceWidth: 0.28,
      leftFootPos: new Vector2(-0.14, 0),
      rightFootPos: new Vector2(0.14, 0),
      isBraking: false,
      chopStepsRemaining: 0,
      pelvicAngle: 0,
      lateralSway: 0,
      isDropStep: false,
      isDoubleSupport: false,
    },
    headOffset: new Vector2(0, 0),
    shoulderAngle: 0,
    headYaw: 0,
    verticalBounce: 0,
    footedness: { dominantFoot: 'right', weakFootAbility: 0.5 },
    cutStatus: {
      isCutting: false,
      plantFoot: null,
      isOutsideFoot: false,
      isDominantPlant: true,
      plantEfficiency: 1.0,
    },
    attributes: {
      name: 'Test Pro',
      heightCm: 180,
      weightKg: 75,
      topSpeed: 80,
      acceleration: 80,
      agility: 80,
      balance: 80,
      strength: 80,
      stamina: 80,
      footedness: { dominantFoot: 'right', weakFootAbility: 0.5 },
    },
    curveIndex: 0,
    studType: 'fg_plastic',
    slipStatus: {
      type: 'none',
      skidVelocity: Vector2.zero(),
      timer: 0,
      initialDuration: 0,
      tractionDemand: 0,
      availableTraction: 0.8,
      slipFoot: null,
    },
    pitchFatigueMultiplier: 1.0,
    ...overrides,
  };
}

function createDummyBall(overrides: Partial<BallState> = {}): BallState {
  return {
    position: new Vector3(0, 0, 0.11),
    velocity: new Vector3(0, 0, 0),
    spin: new Vector3(0, 0, 0),
    flightState: 'at_rest',
    lastContactTime: 0,
    modelId: 'modern_match',
    dragRegime: 'subcritical',
    isKnuckling: false,
    turfCondition: 'standard',
    wind: { speed: 0, heading: 0, gustIntensity: 0.2 },
    ...overrides,
  };
}

const dummyIntent: Intent = {
  moveDir: Vector2.zero(),
};

describe('Atmospheric Rain & Dynamic Wet Pitch Splash System (Presentation Layer)', () => {
  let renderer: CanvasRenderer;
  let pitch: PitchSurface;

  beforeEach(() => {
    // Setup globalThis window mock if not running in browser
    if (typeof window === 'undefined') {
      (globalThis as unknown as { window: unknown }).window = {
        innerWidth: 1920,
        innerHeight: 1080,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }

    const canvas = createMockCanvas();
    renderer = new CanvasRenderer(canvas);
    pitch = new PitchSurface(24.0, 'tier1_elite_hybrid');
  });

  afterEach(() => {
    renderer.clearParticles();
  });

  describe('Edge-Case Test 1: Precipitation Intensity & Particle Budget Clamping', () => {
    it('generates zero raindrops when precipitation is 0 mm/h (dry weather)', () => {
      pitch.setPrecipitation(0);
      const player = createDummyPlayer();
      const ball = createDummyBall();

      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      expect(renderer.getRainDropCount()).toBe(0);
    });

    it('scales rain drops proportionally across drizzle, moderate rain, and heavy thunderstorm', () => {
      const player = createDummyPlayer();
      const ball = createDummyBall();

      // Light Drizzle: 5 mm/h
      pitch.setPrecipitation(5);
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      const drizzleCount = renderer.getRainDropCount();
      expect(drizzleCount).toBeGreaterThanOrEqual(35);
      expect(drizzleCount).toBeLessThan(100);

      // Moderate Rain: 15 mm/h
      pitch.setPrecipitation(15);
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      const moderateCount = renderer.getRainDropCount();
      expect(moderateCount).toBeGreaterThan(drizzleCount);
      expect(moderateCount).toBeGreaterThanOrEqual(140);
      expect(moderateCount).toBeLessThanOrEqual(160);

      // Heavy Downpour: 35 mm/h
      pitch.setPrecipitation(35);
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      const heavyCount = renderer.getRainDropCount();
      expect(heavyCount).toBeGreaterThan(moderateCount);
      expect(heavyCount).toBeGreaterThanOrEqual(340);
      expect(heavyCount).toBeLessThanOrEqual(360);
    });

    it('safely caps raindrop array at maximum limit (400 drops) under extreme tropical monsoon surge (120 mm/h)', () => {
      const player = createDummyPlayer();
      const ball = createDummyBall();

      pitch.setPrecipitation(120); // Extreme deluge
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);

      expect(renderer.getRainDropCount()).toBe(400);
    });

    it('clears rain particles when weather switches from torrential rain back to clear dry skies', () => {
      const player = createDummyPlayer();
      const ball = createDummyBall();

      pitch.setPrecipitation(35);
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      expect(renderer.getRainDropCount()).toBeGreaterThan(300);

      // Weather switches to dry
      pitch.setPrecipitation(0);
      renderer.render(player, player, 1.0, dummyIntent, ball, ball, pitch);
      expect(renderer.getRainDropCount()).toBe(0);
    });
  });

  describe('Edge-Case Test 2: Wet Pitch Footstep Splash & Ripple Generation', () => {
    it('produces ZERO splashes or ripples on dry regulation pitch (moisture < 0.35)', () => {
      pitch.setBaseMoisture(0.20);
      const playerFlight = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'flight',
        },
      });
      const playerStance = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'right',
          rightFootPos: new Vector2(0, 0),
        },
        velocity: new Vector2(4.5, 0),
      });

      // Frame 1: Flight
      renderer.render(playerFlight, playerFlight, 1.0, dummyIntent, undefined, undefined, pitch);
      expect(renderer.getGroundSplashCount()).toBe(0);
      expect(renderer.getGroundRippleCount()).toBe(0);

      // Frame 2: Stance contact on dry turf
      renderer.render(playerFlight, playerStance, 1.0, dummyIntent, undefined, undefined, pitch);
      expect(renderer.getGroundSplashCount()).toBe(0);
      expect(renderer.getGroundRippleCount()).toBe(0);
    });

    it('spawns expanding ripple ring and backward water droplets when foot plants on saturated wet turf (moisture >= 0.35)', () => {
      pitch.setBaseMoisture(0.70); // Wet slick / water saturated
      const playerFlight = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'flight',
        },
      });
      const playerStance = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'right',
          rightFootPos: new Vector2(2.0, 1.0),
        },
        velocity: new Vector2(5.0, 0),
      });

      // Transition into stance plant
      renderer.render(playerFlight, playerStance, 1.0, dummyIntent, undefined, undefined, pitch);

      expect(renderer.getGroundRippleCount()).toBe(1);
      expect(renderer.getGroundSplashCount()).toBeGreaterThanOrEqual(4);
    });

    it('prevents multi-triggering duplicate splashes while foot remains continuously planted in the same stance contact', () => {
      pitch.setBaseMoisture(0.70);
      const playerStance1 = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'right',
          rightFootPos: new Vector2(2.0, 1.0),
        },
        velocity: new Vector2(4.0, 0),
      });
      const playerStance2 = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'right', // Same foot still planted
          rightFootPos: new Vector2(2.0, 1.0),
        },
        velocity: new Vector2(4.0, 0),
      });

      // Initial plant
      renderer.render(playerStance1, playerStance1, 1.0, dummyIntent, undefined, undefined, pitch);
      const initialRipples = renderer.getGroundRippleCount();
      const initialSplashes = renderer.getGroundSplashCount();

      // Subsequent tick in same stance phase
      renderer.render(playerStance1, playerStance2, 1.0, dummyIntent, undefined, undefined, pitch);
      expect(renderer.getGroundRippleCount()).toBe(initialRipples);
      expect(renderer.getGroundSplashCount()).toBe(initialSplashes);
    });

    it('triggers a fresh splash when stepping onto the contralateral foot (left foot)', () => {
      pitch.setBaseMoisture(0.70);
      const playerRightStance = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'right',
          rightFootPos: new Vector2(2.0, 1.0),
        },
        velocity: new Vector2(4.0, 0),
      });
      const playerLeftStance = createDummyPlayer({
        stride: {
          ...createDummyPlayer().stride,
          phase: 'stance',
          currentFoot: 'left', // Swapped foot
          leftFootPos: new Vector2(3.2, 1.0),
        },
        velocity: new Vector2(4.0, 0),
      });

      // Right foot plant
      renderer.render(playerRightStance, playerRightStance, 1.0, dummyIntent, undefined, undefined, pitch);
      expect(renderer.getGroundRippleCount()).toBe(1);

      // Left foot plant
      renderer.render(playerRightStance, playerLeftStance, 1.0, dummyIntent, undefined, undefined, pitch);
      expect(renderer.getGroundRippleCount()).toBe(2);
    });
  });

  describe('Edge-Case Test 3: Ball Ground Impact & Roll Wake Hydrodynamics', () => {
    it('spawns a radial crown splash when a fast descending ball bounces off wet turf', () => {
      pitch.setBaseMoisture(0.65);

      const ballFalling = createDummyBall({
        position: new Vector3(5, 5, 0.15), // altitude 4 cm
        velocity: new Vector3(8, 0, -3.5),  // strong downward velocity
      });
      const ballImpact = createDummyBall({
        position: new Vector3(5.1, 5, 0.11), // touchdown at turf level (alt 0)
        velocity: new Vector3(7.5, 0, 2.2),  // bouncing up
      });

      const player = createDummyPlayer();
      renderer.render(player, player, 1.0, dummyIntent, ballFalling, ballImpact, pitch);

      expect(renderer.getGroundRippleCount()).toBe(1);
      expect(renderer.getGroundSplashCount()).toBeGreaterThanOrEqual(10);
    });

    it('does NOT trigger bounce splash when ball is descending but still airborne (alt > 1.5 cm)', () => {
      pitch.setBaseMoisture(0.65);

      const ball1 = createDummyBall({
        position: new Vector3(5, 5, 0.30),
        velocity: new Vector3(8, 0, -3.5),
      });
      const ball2 = createDummyBall({
        position: new Vector3(5.1, 5, 0.20), // Still 9 cm above ground
        velocity: new Vector3(8, 0, -3.5),
      });

      const player = createDummyPlayer();
      renderer.render(player, player, 1.0, dummyIntent, ball1, ball2, pitch);

      expect(renderer.getGroundRippleCount()).toBe(0);
      expect(renderer.getGroundSplashCount()).toBe(0);
    });

    it('does NOT trigger bounce splash when ball lands gently on dry turf (moisture < 0.35)', () => {
      pitch.setBaseMoisture(0.22); // Dry pitch

      const ballFalling = createDummyBall({
        position: new Vector3(5, 5, 0.15),
        velocity: new Vector3(2, 0, -2.5),
      });
      const ballImpact = createDummyBall({
        position: new Vector3(5.1, 5, 0.11),
        velocity: new Vector3(1.8, 0, 1.5),
      });

      const player = createDummyPlayer();
      renderer.render(player, player, 1.0, dummyIntent, ballFalling, ballImpact, pitch);

      expect(renderer.getGroundRippleCount()).toBe(0);
      expect(renderer.getGroundSplashCount()).toBe(0);
    });
  });

  describe('Edge-Case Test 4: Particle Bounds Capping & Stability under Long Simulation', () => {
    it('strictly enforces memory bounds across 150 consecutive wet sprint & bounce frames', () => {
      pitch.setBaseMoisture(0.80);
      pitch.setPrecipitation(35);

      const playerFlight = createDummyPlayer({
        stride: { ...createDummyPlayer().stride, phase: 'flight' },
      });

      // Run 150 simulated frames alternating feet rapidly
      for (let f = 0; f < 150; f++) {
        const foot = f % 2 === 0 ? 'left' : 'right';
        const playerStance = createDummyPlayer({
          stride: {
            ...createDummyPlayer().stride,
            phase: 'stance',
            currentFoot: foot,
            leftFootPos: new Vector2(f * 0.1, 0),
            rightFootPos: new Vector2(f * 0.1, 0.3),
          },
          velocity: new Vector2(6.0, 0),
        });

        renderer.render(playerFlight, playerStance, 1.0, dummyIntent, undefined, undefined, pitch);
      }

      // Strict particle array capping guarantees zero memory leaks
      expect(renderer.getGroundRippleCount()).toBeLessThanOrEqual(35);
      expect(renderer.getGroundSplashCount()).toBeLessThanOrEqual(100);
      expect(renderer.getRainDropCount()).toBeLessThanOrEqual(400);
    });
  });
});
