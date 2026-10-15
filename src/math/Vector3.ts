import { Vector2 } from './Vector2';

/**
 * Immutable 3D Vector for physical trajectories, aerodynamics, and spatial simulation.
 */
export class Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  static from(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
  }

  static fromVector2(v: Vector2, z: number = 0): Vector3 {
    return new Vector3(v.x, v.y, z);
  }

  add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  scale(s: number): Vector3 {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): Vector3 {
    const len = this.length();
    if (len === 0) return Vector3.zero();
    return new Vector3(this.x / len, this.y / len, this.z / len);
  }

  distanceTo(v: Vector3): number {
    return this.sub(v).length();
  }

  distanceToSq(v: Vector3): number {
    return this.sub(v).lengthSq();
  }

  clampLength(maxLen: number): Vector3 {
    const len = this.length();
    if (len > maxLen && len > 0) {
      return this.scale(maxLen / len);
    }
    return this;
  }

  toVector2(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  lerp(v: Vector3, t: number): Vector3 {
    return new Vector3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  equals(v: Vector3, epsilon: number = 1e-6): boolean {
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon
    );
  }
}
