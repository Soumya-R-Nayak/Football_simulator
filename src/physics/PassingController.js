import { Vector2 } from '../math/Vector2.js';

/**
 * High-Fidelity Football Passing & Targeting Controller.
 * Provides semi-assisted directional targeting, lead trajectory calculation into
 * teammate running strides, through ball corridor projection, and friction-compensated
 * pass velocities.
 */
export class PassingController {
  constructor() {
    // Maximum angle cone for semi-assisted teammate targeting (radians, ~55 degrees)
    this.targetConeAngle = 0.96;

    // Maximum targeting range in meters
    this.maxPassRange = 65.0;

    // Target lock weight: balance between directional alignment and distance
    this.angleWeight = 2.4;
    this.distanceWeight = 0.45;
  }

  /**
   * Evaluates teammates in the kicking cone and selects the best pass recipient.
   * @param {PlayerEntity} kicker
   * @param {PlayerEntity[]} teammates
   * @param {Vector2} aimDir
   * @returns {{ receiver: PlayerEntity, distance: number, angle: number, score: number } | null}
   */
  findTarget(kicker, teammates, aimDir) {
    if (!kicker || !teammates || teammates.length === 0) return null;

    const kickerPos = kicker.pos;
    const aim = (aimDir && aimDir.magnitudeSq() > 0.05)
      ? aimDir.clone().normalize()
      : Vector2.fromAngle(kicker.heading);

    let bestTarget = null;
    let highestScore = -Infinity;

    for (const mate of teammates) {
      if (mate === kicker) continue;

      const offset = Vector2.subtract(mate.pos, kickerPos);
      const dist = offset.magnitude();

      if (dist < 1.0 || dist > this.maxPassRange) continue;

      const dirToMate = offset.clone().normalize();
      const dot = Math.max(-1.0, Math.min(1.0, aim.dot(dirToMate)));
      const angle = Math.acos(dot);

      if (angle <= this.targetConeAngle) {
        // Higher score for closer alignment with aim, with slight penalty for extreme distances
        const distRatio = dist / this.maxPassRange;
        const score = (dot * this.angleWeight) - (distRatio * this.distanceWeight);

        if (score > highestScore) {
          highestScore = score;
          bestTarget = {
            receiver: mate,
            distance: dist,
            angle: angle,
            score: score,
            offset: offset,
            direction: dirToMate
          };
        }
      }
    }

    return bestTarget;
  }

  /**
   * Calculates ideal lead position into the receiver's space or stride.
   * @param {PlayerEntity} kicker
   * @param {PlayerEntity} receiver
   * @param {string} kickType - 'SHORT_PASS' | 'DRIVEN_PASS' | 'GROUND_THROUGH' | 'LOFTED_THROUGH' | 'LOFT_CHIP'
   * @param {number} power - 0.0 to 1.0
   * @param {Environment} environment
   * @returns {{ targetPos: Vector2, distance: number, direction: Vector2, leadDistance: number }}
   */
  calculateLeadTarget(kicker, receiver, kickType, power = 0.5, environment = null) {
    const kickerPos = kicker.pos;
    const recPos = receiver.pos.clone();
    const recSpeed = receiver.vel.magnitude();
    const recFacing = Vector2.fromAngle(receiver.heading);
    const recMoveDir = recSpeed > 0.4 ? receiver.vel.clone().normalize() : recFacing;

    let leadPos = recPos.clone();
    let leadDistance = 0.0;

    switch (kickType) {
      case 'SHORT_PASS':
      case 'DRIVEN_PASS': {
        // Direct to feet / front pocket: lead into receiver's forward facing direction slightly
        leadDistance = (recSpeed > 0.4) ? Math.min(2.2, recSpeed * 0.45) : 0.40;
        leadPos = Vector2.add(recPos, Vector2.multiply(recMoveDir, leadDistance));
        break;
      }

      case 'GROUND_THROUGH': {
        // Through ball into open running corridor: leads ahead of receiver
        leadDistance = 1.8 + power * 6.5; // 1.8m to 8.3m ahead into space
        leadPos = Vector2.add(recPos, Vector2.multiply(recMoveDir, leadDistance));
        break;
      }

      case 'LOFTED_THROUGH': {
        // Chipped through ball over defenders into running space
        leadDistance = 2.4 + power * 7.5; // 2.4m to 9.9m ahead
        leadPos = Vector2.add(recPos, Vector2.multiply(recMoveDir, leadDistance));
        break;
      }

      case 'LOFT_CHIP': {
        // Chipped pass landing at receiver feet / chest
        leadDistance = (recSpeed > 0.4) ? Math.min(1.5, recSpeed * 0.35) : 0.25;
        leadPos = Vector2.add(recPos, Vector2.multiply(recMoveDir, leadDistance));
        break;
      }

      default: {
        leadPos = recPos.clone();
        break;
      }
    }

    const leadOffset = Vector2.subtract(leadPos, kickerPos);
    const totalDist = leadOffset.magnitude();
    const finalDir = totalDist > 0.1 ? leadOffset.clone().normalize() : Vector2.fromAngle(kicker.heading);

    return {
      targetPos: leadPos,
      distance: totalDist,
      direction: finalDir,
      leadDistance: leadDistance
    };
  }

  /**
   * Calculates friction-compensated release velocity and assists trajectory direction.
   * @param {PlayerEntity} kicker
   * @param {PlayerEntity} receiver
   * @param {string} kickType
   * @param {number} userPower
   * @param {Vector2} rawAimDir
   * @param {Environment} environment
   * @returns {{ targetDir: Vector2, speed: number, loft: number, backspin: number }}
   */
  tunePassExecution(kicker, receiver, kickType, userPower, rawAimDir, environment = null) {
    // Total effective ground deceleration (turf rolling friction + aerodynamic boundary drag)
    const baseTurfDecel = environment ? environment.getRollingDeceleration() : 1.08;
    const effectiveDecel = baseTurfDecel * 1.35;
    const targetLead = this.calculateLeadTarget(kicker, receiver, kickType, userPower, environment);

    // Magnetic direction blend: 78% assist towards target lead point, 22% raw user aim
    const aim = (rawAimDir && rawAimDir.magnitudeSq() > 0.05) ? rawAimDir.clone().normalize() : targetLead.direction;
    const assistedDir = Vector2.lerp(aim, targetLead.direction, 0.78).normalize();

    // Physics required ground roll speed:
    // v_target^2 = v_arrival^2 + 2 * decel * dist
    const dist = targetLead.distance;
    let arrivalSpeed = 3.6; // comfortable reception speed
    if (kickType === 'DRIVEN_PASS') arrivalSpeed = 6.8;
    if (kickType === 'GROUND_THROUGH') arrivalSpeed = 5.2;

    const reqGroundSpeed = Math.sqrt(arrivalSpeed * arrivalSpeed + 2.0 * effectiveDecel * dist);

    let finalSpeed = reqGroundSpeed;
    let finalLoft = 0.0;
    let finalBackspin = 0.0;

    switch (kickType) {
      case 'SHORT_PASS':
        // Scale with user power around ideal requirement
        finalSpeed = Math.max(5.5, Math.min(14.5, reqGroundSpeed * (0.92 + userPower * 0.28)));
        finalLoft = 0.0;
        break;

      case 'DRIVEN_PASS':
        finalSpeed = Math.max(11.0, Math.min(18.5, reqGroundSpeed * (0.95 + userPower * 0.25)));
        finalLoft = 0.25;
        break;

      case 'GROUND_THROUGH':
        finalSpeed = Math.max(7.5, Math.min(18.5, reqGroundSpeed * (0.92 + userPower * 0.30)));
        finalLoft = 0.0;
        break;

      case 'LOFTED_THROUGH':
        // Calculate ballistic arc for distance
        // Flight time t ~= sqrt(2 * dist / 9.81)
        finalSpeed = Math.max(8.0, Math.min(16.5, Math.sqrt(dist * 5.0) * (0.85 + userPower * 0.30)));
        finalLoft = Math.max(4.0, Math.min(8.5, Math.sqrt(dist * 2.2) + userPower * 2.5));
        finalBackspin = -26.0 - userPower * 20.0;
        break;

      case 'LOFT_CHIP':
        finalSpeed = Math.max(6.5, Math.min(19.0, Math.sqrt(dist * 6.0) * (0.85 + userPower * 0.30)));
        finalLoft = Math.max(3.8, Math.min(9.0, Math.sqrt(dist * 2.5) + userPower * 3.0));
        finalBackspin = -30.0 - userPower * 18.0;
        break;
    }

    return {
      targetDir: assistedDir,
      speed: finalSpeed,
      loft: finalLoft,
      backspin: finalBackspin,
      targetLead: targetLead
    };
  }
}
