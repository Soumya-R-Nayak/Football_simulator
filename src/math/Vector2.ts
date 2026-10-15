/**
 * Immutable 2D Vector representation for SI physics calculations.
 */
export class Vector2 {
  readonly x: number;
  readonly y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  static zero(): Vector2 {
    return new Vector2(0, 0);
  }

  static fromAngle(rad: number, length: number = 1): Vector2 {
    return new Vector2(Math.cos(rad) * length, Math.sin(rad) * length);
  }

  add(v: Vector2): Vector2 {
    return new Vector2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vector2): Vector2 {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  scale(s: number): Vector2 {
    return new Vector2(this.x * s, this.y * s);
  }

  dot(v: Vector2): number {
    return this.x * v.x + this.y * v.y;
  }

  cross(v: Vector2): number {
    return this.x * v.y - this.y * v.x;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): Vector2 {
    const len = this.length();
    if (len < 1e-7) return Vector2.zero();
    return new Vector2(this.x / len, this.y / len);
  }

  clampLength(maxLen: number): Vector2 {
    const lenSq = this.lengthSq();
    if (lenSq <= maxLen * maxLen) return this;
    const len = Math.sqrt(lenSq);
    return new Vector2((this.x / len) * maxLen, (this.y / len) * maxLen);
  }

  distance(v: Vector2): number {
    return this.sub(v).length();
  }

  distanceTo(v: Vector2): number {
    return this.distance(v);
  }

  distanceSq(v: Vector2): number {
    return this.sub(v).lengthSq();
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  rotate(rad: number): Vector2 {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new Vector2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  lerp(v: Vector2, t: number): Vector2 {
    return new Vector2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }

  equals(v: Vector2, epsilon: number = 1e-6): boolean {
    return Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon;
  }

  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
}
