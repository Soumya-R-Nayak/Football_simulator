import { Vector2 } from '../math/Vector2.js';

/**
 * Metric-to-Pixel Camera Projection.
 * Smoothly tracks target in meters and applies 2D viewport translation and scaling.
 */
export class Camera {
  constructor(canvas, pitch) {
    this.canvas = canvas;
    this.pitch = pitch;

    this.mode = 'FOLLOW'; // 'FOLLOW' | 'FULL_PITCH'
    this.orientation = 'HORIZONTAL'; // 'HORIZONTAL' (East-West) | 'VERTICAL' (South-to-North / Goal-to-Goal)
    this.zoomLevel = 'CLOSE'; // 'OVERHEAD' | 'BROADCAST' | 'TELE' | 'CLOSE' | 'TACTICAL'
    
    // Zoom height scale factor: 1.0 is default, adjustable from 0.6x (far/high) to 2.8x (very close/low)
    this.heightScale = 1.6; // Start with a close, readable height by default so text over player is crisp

    this.pos = new Vector2(pitch.halfLength, pitch.halfWidth);
    this.targetPos = new Vector2(pitch.halfLength, pitch.halfWidth);

    this.pixelsPerMeter = 36.0;
    this.targetPpm = 36.0;
    this.lerpSpeed = 0.14;
  }

  setOrientation(orientation) {
    if (orientation === 'VERTICAL' || orientation === 'HORIZONTAL') {
      this.orientation = orientation;
    }
  }

  toggleOrientation() {
    this.orientation = (this.orientation === 'HORIZONTAL') ? 'VERTICAL' : 'HORIZONTAL';
  }

  setZoomLevel(level) {
    this.zoomLevel = level;
    switch (level) {
      case 'OVERHEAD':
        this.heightScale = 0.75;
        break;
      case 'BROADCAST':
        this.heightScale = 1.0;
        break;
      case 'TELE':
        this.heightScale = 1.35;
        break;
      case 'CLOSE':
        this.heightScale = 1.85;
        break;
      case 'TACTICAL':
        this.heightScale = 2.40;
        break;
      default:
        this.heightScale = 1.5;
    }
  }

  setHeightScale(scale) {
    this.heightScale = Math.max(0.5, Math.min(3.2, Number(scale) || 1.0));
  }

  toggleMode() {
    this.mode = (this.mode === 'FOLLOW') ? 'FULL_PITCH' : 'FOLLOW';
  }

  update(player, ball) {
    const isVert = (this.orientation === 'VERTICAL');

    if (this.mode === 'FULL_PITCH') {
      // Fit 105m x 68m pitch with run-off margin into canvas
      const totalWidthMeters = isVert 
        ? (this.pitch.width + this.pitch.margin * 2)
        : (this.pitch.length + this.pitch.margin * 2);
      const totalHeightMeters = isVert
        ? (this.pitch.length + this.pitch.margin * 2)
        : (this.pitch.width + this.pitch.margin * 2);

      const scaleX = this.canvas.width / totalWidthMeters;
      const scaleY = this.canvas.height / totalHeightMeters;
      this.targetPpm = Math.min(scaleX, scaleY) * 0.95;
      this.targetPos.set(this.pitch.halfLength, this.pitch.halfWidth);
    } else {
      // Follow mode: Base PPM multiplied by custom camera height factor
      // Base PPM: ~22px/m at 1080p, scaled up by heightScale
      const basePpm = Math.max(18.0, Math.min(28.0, (this.canvas.height / 36.0)));
      this.targetPpm = basePpm * this.heightScale;

      let focusX = player.pos.x;
      let focusY = player.pos.y;

      // Look-ahead forward lead bias along player facing direction
      const facing = Vector2.fromAngle(player.heading);
      const speedRatio = Math.min(1.0, player.vel.magnitude() / player.locomotion.sprintSpeed);
      // Lead scaled down at closer heights to keep player well framed
      const leadMeters = (1.2 + speedRatio * 2.2) * (1.0 / Math.sqrt(this.heightScale));
      focusX += facing.x * leadMeters;
      focusY += facing.y * leadMeters;

      if (ball) {
        // Weighted blend with ball
        focusX = focusX * 0.72 + ball.pos.x * 0.28;
        focusY = focusY * 0.72 + ball.pos.y * 0.28;
      }

      // Clamping camera to prevent showing outside boundary voids
      const halfVisibleW = (this.canvas.width / (2 * this.targetPpm));
      const halfVisibleH = (this.canvas.height / (2 * this.targetPpm));

      const marginW = isVert ? halfVisibleH : halfVisibleW;
      const marginH = isVert ? halfVisibleW : halfVisibleH;

      const minX = -this.pitch.margin + marginW;
      const maxX = this.pitch.length + this.pitch.margin - marginW;
      const minY = -this.pitch.margin + marginH;
      const maxY = this.pitch.width + this.pitch.margin - marginH;

      if (minX < maxX) focusX = Math.max(minX, Math.min(maxX, focusX));
      if (minY < maxY) focusY = Math.max(minY, Math.min(maxY, focusY));

      this.targetPos.set(focusX, focusY);
    }

    // Smooth camera lerp
    this.pos.x += (this.targetPos.x - this.pos.x) * this.lerpSpeed;
    this.pos.y += (this.targetPos.y - this.pos.y) * this.lerpSpeed;
    this.pixelsPerMeter += (this.targetPpm - this.pixelsPerMeter) * this.lerpSpeed;
  }

  applyTransform(ctx) {
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    if (this.orientation === 'VERTICAL') {
      // Rotate 90° counter-clockwise so East (Goal 2) points UP (top of screen)
      // and West (Goal 1) points DOWN (bottom of screen)
      ctx.rotate(-Math.PI / 2);
    }
    ctx.scale(this.pixelsPerMeter, this.pixelsPerMeter);
    ctx.translate(-this.pos.x, -this.pos.y);
  }

  restoreTransform(ctx) {
    ctx.restore();
  }

  worldToScreen(worldPos) {
    const isVert = (this.orientation === 'VERTICAL');
    const dx = (worldPos.x - this.pos.x) * this.pixelsPerMeter;
    const dy = (worldPos.y - this.pos.y) * this.pixelsPerMeter;

    if (isVert) {
      // Rotated by -PI/2: (x', y') = (y, -x)
      return {
        x: dy + this.canvas.width / 2,
        y: -dx + this.canvas.height / 2
      };
    }

    return {
      x: dx + this.canvas.width / 2,
      y: dy + this.canvas.height / 2
    };
  }

  screenToWorld(screenX, screenY) {
    const isVert = (this.orientation === 'VERTICAL');
    let sx = screenX - this.canvas.width / 2;
    let sy = screenY - this.canvas.height / 2;

    if (isVert) {
      // Inverse of (y, -x): x = -y', y = x'
      const origSx = -sy;
      const origSy = sx;
      sx = origSx;
      sy = origSy;
    }

    const wx = sx / this.pixelsPerMeter + this.pos.x;
    const wy = sy / this.pixelsPerMeter + this.pos.y;
    return new Vector2(wx, wy);
  }
}
