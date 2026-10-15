import { Vector2 } from '../math/Vector2.js';

/**
 * Clean Keyboard Input Manager for Player Movement & Simulation Controls.
 * Handles directional vectors, gaits (Sprint, Run, Jockey), and environment hotkeys.
 */
export class InputManager {
  constructor() {
    this.keys = {};
    this.moveDir = new Vector2(0, 0);
    this.activeGait = 'RUN';

    // Callbacks for simulation controls
    this.onToggleTurf = null;
    this.onToggleCamera = null;
    this.onResetBall = null;
    this.onToggleDrill = null;
    this.onZoomIn = null;
    this.onZoomOut = null;
    this.onToggleCamOrientation = null;

    this.setupListeners();
  }

  setupListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      this.keys[e.code] = true;
      if (e.key) {
        this.keys[e.key.toLowerCase()] = true;
      }

      // Hotkey triggers
      if ((e.code === 'KeyT' || e.key === 't') && this.onToggleTurf) {
        this.onToggleTurf();
      }
      if ((e.code === 'KeyV' || e.key === 'v') && this.onToggleCamera) {
        this.onToggleCamera();
      }
      if ((e.code === 'KeyY' || e.key === 'y') && this.onToggleCamOrientation) {
        this.onToggleCamOrientation();
      }
      if ((e.code === 'Equal' || e.key === '=' || e.key === '+') && this.onZoomIn) {
        this.onZoomIn();
      }
      if ((e.code === 'Minus' || e.key === '-') && this.onZoomOut) {
        this.onZoomOut();
      }
      if ((e.code === 'KeyR' || e.key === 'r') && this.onResetBall) {
        this.onResetBall();
      }
      if ((e.code === 'KeyG' || e.key === 'g' || e.key === 'G') && this.onToggleDrill) {
        this.onToggleDrill();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.key) {
        this.keys[e.key.toLowerCase()] = false;
      }
    });

    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  isKeyActive(...keyCodes) {
    for (const k of keyCodes) {
      if (this.keys[k]) return true;
    }
    return false;
  }

  update(player, ball, dt, environment = null) {
    // 1. Calculate desired movement direction
    // Supports WASD, WACD ergonomic layout, and Arrow keys
    const dir = new Vector2(0, 0);
    if (this.isKeyActive('KeyW', 'w', 'ArrowUp')) dir.y -= 1;
    if (this.isKeyActive('KeyC', 'c', 'KeyX', 'x', 'KeyS', 's', 'ArrowDown')) dir.y += 1;
    if (this.isKeyActive('KeyA', 'a', 'ArrowLeft')) dir.x -= 1;
    if (this.isKeyActive('KeyD', 'd', 'ArrowRight')) dir.x += 1;

    if (dir.magnitudeSq() > 0) {
      dir.normalize();
    }
    this.moveDir = dir.clone();

    // 2. Determine active locomotion gait
    let gait = 'RUN';
    const isShiftHeld = this.isKeyActive('ShiftLeft', 'ShiftRight', 'Shift');
    const isSpaceHeld = this.isKeyActive('Space', ' ', 'ControlLeft', 'ControlRight', 'Control');
    const isAltHeld = this.isKeyActive('AltLeft', 'AltRight', 'Alt');

    if (isShiftHeld) {
      gait = 'SPRINT';
    } else if (isSpaceHeld) {
      gait = 'JOCKEY';
    } else if (isAltHeld) {
      gait = 'WALK';
    }

    this.activeGait = gait;

    // 3. Move player
    player.move(dir, gait, dt, ball);
  }
}
