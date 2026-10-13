import { Vector2 } from '../math/Vector2.js';

/**
 * Authentic IFAB Law 1 Pitch Dimensions and Boundary Geometry (all in meters).
 */
export class Pitch {
  constructor() {
    // Official FIFA/UEFA Standard Competition Dimensions
    this.length = 105.00; // m
    this.width = 68.00;   // m
    this.halfLength = this.length / 2; // 52.50 m
    this.halfWidth = this.width / 2;   // 34.00 m
    this.center = new Vector2(this.halfLength, this.halfWidth);

    // Goal specifications
    this.goalWidth = 7.32;  // 8 yards (inner post to inner post)
    this.goalHeight = 2.44; // 8 feet (crossbar height)
    this.goalDepth = 2.00;  // depth of netting
    this.postDiameter = 0.12; // 12 cm regulation post width
    this.goalTop = this.halfWidth - this.goalWidth / 2;    // 30.34 m
    this.goalBottom = this.halfWidth + this.goalWidth / 2; // 37.66 m

    // Penalty areas: 16.50 m depth × 40.32 m width
    this.penaltyDepth = 16.50;
    this.penaltyWidth = 40.32;
    this.penaltyTop = this.halfWidth - this.penaltyWidth / 2;    // 13.84 m
    this.penaltyBottom = this.halfWidth + this.penaltyWidth / 2; // 54.16 m

    // Goal area (6-yard box): 5.50 m depth × 18.32 m width
    this.goalAreaDepth = 5.50;
    this.goalAreaWidth = 18.32;
    this.goalAreaTop = this.halfWidth - this.goalAreaWidth / 2;    // 24.84 m
    this.goalAreaBottom = this.halfWidth + this.goalAreaWidth / 2; // 43.16 m

    // Penalty spots and circles
    this.penaltySpotDist = 11.00; // 12 yards from goal line
    this.centerCircleRadius = 9.15; // 10 yards
    this.penaltyArcRadius = 9.15;   // 10 yards from penalty spot
    this.cornerArcRadius = 1.00;    // 1 yard
    this.lineWidth = 0.12;          // 12 cm regulation line width

    // Boundary margins around the pitch (green run-off area)
    this.margin = 3.50; // meters

    // Goalpost coordinate locations for collision detection
    this.leftPosts = [
      new Vector2(0, this.goalTop),
      new Vector2(0, this.goalBottom)
    ];
    this.rightPosts = [
      new Vector2(this.length, this.goalTop),
      new Vector2(this.length, this.goalBottom)
    ];
  }

  isOutOfBounds(pos) {
    return pos.x < 0 || pos.x > this.length || pos.y < 0 || pos.y > this.width;
  }

  isGoal(pos, prevPos = null) {
    // Check crossing of left goal line
    if (pos.x <= 0 && pos.y >= this.goalTop && pos.y <= this.goalBottom) {
      if (!prevPos || prevPos.x > 0) return 'LEFT';
    }
    // Check crossing of right goal line
    if (pos.x >= this.length && pos.y >= this.goalTop && pos.y <= this.goalBottom) {
      if (!prevPos || prevPos.x < this.length) return 'RIGHT';
    }
    return null;
  }

  clampToPitch(pos, padding = 0.2) {
    return new Vector2(
      Math.max(padding, Math.min(this.length - padding, pos.x)),
      Math.max(padding, Math.min(this.width - padding, pos.y))
    );
  }
}
