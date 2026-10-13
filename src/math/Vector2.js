/**
 * 2D Vector mathematics utility class for SI physics calculations (meters, m/s, m/s²).
 */
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  subtract(v) {
    return this.sub(v);
  }

  multiply(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  divide(scalar) {
    if (scalar !== 0) {
      this.x /= scalar;
      this.y /= scalar;
    }
    return this;
  }

  magnitudeSq() {
    return this.x * this.x + this.y * this.y;
  }

  magnitude() {
    return Math.sqrt(this.magnitudeSq());
  }

  normalize() {
    const mag = this.magnitude();
    if (mag > 1e-6) {
      this.divide(mag);
    } else {
      this.x = 0;
      this.y = 0;
    }
    return this;
  }

  limit(max) {
    const magSq = this.magnitudeSq();
    if (magSq > max * max) {
      this.normalize().multiply(max);
    }
    return this;
  }

  heading() {
    return Math.atan2(this.y, this.x);
  }

  dist(v) {
    return Math.sqrt(this.distSq(v));
  }

  distSq(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  rotate(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = this.x * cos - this.y * sin;
    const ry = this.x * sin + this.y * cos;
    this.x = rx;
    this.y = ry;
    return this;
  }

  static add(v1, v2) {
    return new Vector2(v1.x + v2.x, v1.y + v2.y);
  }

  static sub(v1, v2) {
    return new Vector2(v1.x - v2.x, v1.y - v2.y);
  }

  static subtract(v1, v2) {
    return new Vector2(v1.x - v2.x, v1.y - v2.y);
  }

  static multiply(v, scalar) {
    return new Vector2(v.x * scalar, v.y * scalar);
  }

  static dist(v1, v2) {
    return v1.dist(v2);
  }

  static dot(v1, v2) {
    return v1.dot(v2);
  }

  static fromAngle(angle, length = 1) {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  static lerp(v1, v2, t) {
    return new Vector2(v1.x + (v2.x - v1.x) * t, v1.y + (v2.y - v1.y) * t);
  }
}
