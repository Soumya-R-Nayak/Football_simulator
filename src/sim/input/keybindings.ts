import { Vector2 } from '../../math/Vector2';
import { SIM_CONFIG } from '../config';
import { Gait, Intent } from '../types';

export const KEY_CODES = {
  MOVE_UP: 'KeyW',
  MOVE_DOWN: 'KeyS',
  MOVE_LEFT: 'KeyA',
  MOVE_RIGHT: 'KeyD',
  SPRINT_LEFT: 'ShiftLeft',
  SPRINT_RIGHT: 'ShiftRight',
  WALK: 'KeyZ',
  HOLD_FACING: 'Space',
  DEV_TURN_LEFT: 'ArrowLeft',
  DEV_TURN_RIGHT: 'ArrowRight',

  // Reserved for future actions
  RESERVED_I: 'KeyI',
  RESERVED_J: 'KeyJ',
  RESERVED_K: 'KeyK',
  RESERVED_L: 'KeyL',
  RESERVED_U: 'KeyU',
  RESERVED_O: 'KeyO',
  RESERVED_Q: 'KeyQ',
  RESERVED_E: 'KeyE',
  RESERVED_R: 'KeyR',
  RESERVED_F: 'KeyF',
} as const;

/**
 * Virtual Analog Stick smoothing digital key inputs into analog directional magnitudes.
 * - Attack ramp from 0 to 1 over ~100 ms.
 * - Snap-through-zero reversal over ~35 ms when opposing key is pressed.
 * - Diagonal normalization to unit vector length <= 1.0.
 */
export class VirtualAnalogStick {
  private x: number = 0;
  private y: number = 0;

  update(dt: number, heldKeys: ReadonlySet<string>): Vector2 {
    let targetX = 0;
    let targetY = 0;

    if (heldKeys.has(KEY_CODES.MOVE_RIGHT)) targetX += 1;
    if (heldKeys.has(KEY_CODES.MOVE_LEFT)) targetX -= 1;
    if (heldKeys.has(KEY_CODES.MOVE_DOWN)) targetY += 1;
    if (heldKeys.has(KEY_CODES.MOVE_UP)) targetY -= 1;

    this.x = this.smoothAxis(this.x, targetX, dt);
    this.y = this.smoothAxis(this.y, targetY, dt);

    const stick = new Vector2(this.x, this.y);
    return stick.clampLength(1.0);
  }

  private smoothAxis(current: number, target: number, dt: number): number {
    if (target === 0) {
      // Releasing toward neutral: decay using attack rate
      const step = dt / SIM_CONFIG.INPUT.RAMP_ATTACK_TIME;
      if (Math.abs(current) <= step) return 0;
      return current > 0 ? current - step : current + step;
    }

    const opposing = (current > 0 && target < 0) || (current < 0 && target > 0);
    const rate = opposing ? SIM_CONFIG.INPUT.RAMP_REVERSAL_TIME : SIM_CONFIG.INPUT.RAMP_ATTACK_TIME;
    const step = dt / rate;

    if (current < target) {
      return Math.min(target, current + step);
    } else {
      return Math.max(target, current - step);
    }
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
  }
}

/**
 * Input controller managing keyboard events and sampling 120 Hz tick Intent.
 */
export class KeyboardInputManager {
  private readonly heldKeys: Set<string> = new Set();
  private readonly stick: VirtualAnalogStick = new VirtualAnalogStick();

  constructor() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
  }

  attachListeners(target: EventTarget = window): () => void {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('blur', this.onBlur as EventListener);

    return () => {
      target.removeEventListener('keydown', this.onKeyDown as EventListener);
      target.removeEventListener('keyup', this.onKeyUp as EventListener);
      target.removeEventListener('blur', this.onBlur as EventListener);
      this.heldKeys.clear();
      this.stick.reset();
    };
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;

    if (
      e.code === KEY_CODES.HOLD_FACING ||
      e.code === KEY_CODES.DEV_TURN_LEFT ||
      e.code === KEY_CODES.DEV_TURN_RIGHT
    ) {
      e.preventDefault();
    }

    this.heldKeys.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  private onBlur(): void {
    this.heldKeys.clear();
    this.stick.reset();
  }

  sampleIntent(dt: number): Intent {
    const moveDir = this.stick.update(dt, this.heldKeys);

    let gait: Gait = 'jog';
    if (this.heldKeys.has(KEY_CODES.SPRINT_LEFT) || this.heldKeys.has(KEY_CODES.SPRINT_RIGHT)) {
      gait = 'sprint';
    } else if (this.heldKeys.has(KEY_CODES.WALK)) {
      gait = 'walk';
    }

    const holdFacing = this.heldKeys.has(KEY_CODES.HOLD_FACING);
    const requestSlide = this.heldKeys.has(KEY_CODES.RESERVED_E);
    const ballControl = this.heldKeys.has(KEY_CODES.RESERVED_R)
      ? { mode: 'receive' as const }
      : undefined;

    let manualTurn = 0;
    if (this.heldKeys.has(KEY_CODES.DEV_TURN_LEFT)) manualTurn -= 1;
    if (this.heldKeys.has(KEY_CODES.DEV_TURN_RIGHT)) manualTurn += 1;

    return {
      moveDir,
      faceDir: null, // by default facing tracks movement unless holdFacing
      gait,
      holdFacing,
      manualTurn,
      requestSlide,
      ballControl,
    };
  }
}
