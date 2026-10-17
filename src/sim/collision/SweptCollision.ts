import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import { BootZoneId, classifyBootContact } from './BootZones';
import { ControlledBootResponse } from './BallControl';
import { CapsuleShape, ContactBody, SphereShape } from './ContactBody';

export interface ContactManifold {
  readonly hasImpact: boolean;
  readonly toi: number;           // Fraction of remaining timestep [0, 1]
  readonly contactPoint: Vector3;
  readonly normal: Vector3;        // Unit normal pointing FROM body TO ball
  readonly penetration: number;
  readonly body: ContactBody;
  readonly sParam?: number;
}

export interface CollisionImpulseResult {
  readonly deltaV: Vector3;
  readonly deltaOmega: Vector3;
  readonly posCorrection: Vector3;
  readonly isGroundPinned: boolean;
  readonly netImpulse: Vector3;
  readonly contactZone?: BootZoneId;
}

/**
 * Continuous Collision Detection (CCD) and physics impulse resolver.
 * Performs relative-frame swept sphere/capsule intersection, slip-stick Coulomb friction
 * with ball moment of inertia, endpoint velocity lerp for capsules, boot zone properties,
 * and ground-pin clamping.
 */
export class SweptCollisionResolver {
  /**
   * Sweeps the ball against a body in the relative reference frame over time interval dt.
   */
  static checkCollision(
    ballPos: Vector3,
    ballVel: Vector3,
    ballRadius: number,
    body: ContactBody,
    dt: number
  ): ContactManifold | null {
    if (dt <= 1e-6) return null;

    // Relative displacement over interval dt: ball moves by (v_ball - v_body) * dt
    const vRel = ballVel.sub(body.velocity);
    const dRel = vRel.scale(dt);

    if (body.shape.type === 'sphere') {
      return this.sweepSphereVsSphere(ballPos, dRel, ballRadius, body.shape, body);
    } else {
      return this.sweepSphereVsCapsule(ballPos, dRel, ballRadius, body.shape, body);
    }
  }

  /**
   * Swept sphere (ball) vs static sphere in relative frame.
   */
  private static sweepSphereVsSphere(
    ballPos: Vector3,
    dRel: Vector3,
    ballRadius: number,
    sphere: SphereShape,
    body: ContactBody
  ): ContactManifold | null {
    const c = sphere.center;
    const combinedRadius = ballRadius + sphere.radius;
    const m = ballPos.sub(c);
    const distSqStart = m.lengthSq();

    // 1. Initial Overlap (t = 0)
    if (distSqStart <= combinedRadius * combinedRadius) {
      const dist = Math.sqrt(distSqStart);
      const normal = dist > 1e-5 ? m.scale(1 / dist) : new Vector3(0, 0, 1);
      return {
        hasImpact: true,
        toi: 0,
        contactPoint: c.add(normal.scale(sphere.radius)),
        normal,
        penetration: combinedRadius - dist,
        body,
      };
    }

    // 2. Relative Ray Sweep
    const a = dRel.lengthSq();
    if (a < 1e-8) return null; // No relative movement

    const b = m.dot(dRel);
    // If moving away from sphere at t=0
    if (b > 0) return null;

    const cCoeff = distSqStart - combinedRadius * combinedRadius;
    const discriminant = b * b - a * cCoeff;
    if (discriminant < 0) return null;

    const toi = (-b - Math.sqrt(discriminant)) / a;
    if (toi < 0 || toi > 1.0) return null;

    const ballAtImpact = ballPos.add(dRel.scale(toi));
    const normal = ballAtImpact.sub(c).normalize();

    return {
      hasImpact: true,
      toi,
      contactPoint: c.add(normal.scale(sphere.radius)),
      normal,
      penetration: 0,
      body,
    };
  }

  /**
   * Swept sphere (ball) vs static 3D vertical capsule in relative frame.
   */
  private static sweepSphereVsCapsule(
    ballPos: Vector3,
    dRel: Vector3,
    ballRadius: number,
    capsule: CapsuleShape,
    body: ContactBody
  ): ContactManifold | null {
    const p1 = capsule.p1;
    const p2 = capsule.p2;
    const capRadius = capsule.radius;
    const combinedRadius = ballRadius + capRadius;

    const axis = p2.sub(p1);
    const axisLen = axis.length();

    // If degenerate segment, treat as single sphere at p1
    if (axisLen < 1e-5) {
      return this.sweepSphereVsSphere(ballPos, dRel, ballRadius, { type: 'sphere', center: p1, radius: capRadius }, body);
    }

    const uAxis = axis.scale(1 / axisLen);

    // 1. Initial Overlap (t = 0)
    const m0 = ballPos.sub(p1);
    const s0 = Math.max(0, Math.min(axisLen, m0.dot(uAxis)));
    const closest0 = p1.add(uAxis.scale(s0));
    const delta0 = ballPos.sub(closest0);
    const distSq0 = delta0.lengthSq();

    if (distSq0 <= combinedRadius * combinedRadius) {
      const dist = Math.sqrt(distSq0);
      const normal = dist > 1e-5 ? delta0.scale(1 / dist) : uAxis;
      return {
        hasImpact: true,
        toi: 0,
        contactPoint: closest0.add(normal.scale(capRadius)),
        normal,
        penetration: combinedRadius - dist,
        body,
      };
    }

    const dLenSq = dRel.lengthSq();
    if (dLenSq < 1e-8) return null;

    let earliestToi = 2.0;
    let bestNormal = Vector3.zero();
    let bestPoint = Vector3.zero();

    // 2. Relative Ray Sweep vs Cylinder Body (infinite along uAxis, clamped to [0, axisLen])
    const mPerp = m0.sub(uAxis.scale(m0.dot(uAxis)));
    const dPerp = dRel.sub(uAxis.scale(dRel.dot(uAxis)));
    const aPerp = dPerp.lengthSq();

    if (aPerp > 1e-8) {
      const bPerp = mPerp.dot(dPerp);
      const cPerp = mPerp.lengthSq() - combinedRadius * combinedRadius;
      const disc = bPerp * bPerp - aPerp * cPerp;

      if (disc >= 0) {
        const toiCyl = (-bPerp - Math.sqrt(disc)) / aPerp;
        if (toiCyl >= 0 && toiCyl <= 1.0) {
          const ballAtImpact = ballPos.add(dRel.scale(toiCyl));
          const sImpact = ballAtImpact.sub(p1).dot(uAxis);
          if (sImpact >= 0 && sImpact <= axisLen) {
            earliestToi = toiCyl;
            const centerOnAxis = p1.add(uAxis.scale(sImpact));
            bestNormal = ballAtImpact.sub(centerOnAxis).normalize();
            bestPoint = centerOnAxis.add(bestNormal.scale(capRadius));
          }
        }
      }
    }

    // 3. Spherical End-Caps (p1 sphere and p2 sphere)
    const cap1Hit = this.sweepSphereVsSphere(ballPos, dRel, ballRadius, { type: 'sphere', center: p1, radius: capRadius }, body);
    if (cap1Hit && cap1Hit.toi < earliestToi) {
      earliestToi = cap1Hit.toi;
      bestNormal = cap1Hit.normal;
      bestPoint = cap1Hit.contactPoint;
    }

    const cap2Hit = this.sweepSphereVsSphere(ballPos, dRel, ballRadius, { type: 'sphere', center: p2, radius: capRadius }, body);
    if (cap2Hit && cap2Hit.toi < earliestToi) {
      earliestToi = cap2Hit.toi;
      bestNormal = cap2Hit.normal;
      bestPoint = cap2Hit.contactPoint;
    }

    if (earliestToi <= 1.0) {
      return {
        hasImpact: true,
        toi: earliestToi,
        contactPoint: bestPoint,
        normal: bestNormal,
        penetration: 0,
        body,
      };
    }

    return null;
  }

  /**
   * Recomputes contact point, surface normal, penetration depth, and segment parameter s
   * against a body re-posed at tauImpact.
   */
  static refineContactGeometry(
    ballPos: Vector3,
    ballRadius: number,
    body: ContactBody
  ): { contactPoint: Vector3; normal: Vector3; penetration: number; sParam: number } {
    if (body.shape.type === 'capsule') {
      const p1 = body.shape.p1;
      const p2 = body.shape.p2;
      const radius = body.shape.radius;
      const seg = p2.sub(p1);
      const segLenSq = seg.lengthSq();
      const sParam = segLenSq > 1e-8
        ? Math.max(0, Math.min(1, ballPos.sub(p1).dot(seg) / segLenSq))
        : 0.5;
      const closestOnAxis = p1.add(seg.scale(sParam));
      const diff = ballPos.sub(closestOnAxis);
      const dist = diff.length();
      const normal = dist > 1e-6 ? diff.scale(1 / dist) : new Vector3(0, 0, 1);
      const penetration = Math.max(0, (radius + ballRadius) - dist);
      const contactPoint = closestOnAxis.add(normal.scale(radius));
      return { contactPoint, normal, penetration, sParam };
    } else {
      const center = body.shape.center;
      const radius = body.shape.radius;
      const diff = ballPos.sub(center);
      const dist = diff.length();
      const normal = dist > 1e-6 ? diff.scale(1 / dist) : new Vector3(0, 0, 1);
      const penetration = Math.max(0, (radius + ballRadius) - dist);
      const contactPoint = center.add(normal.scale(radius));
      return { contactPoint, normal, penetration, sParam: 0.5 };
    }
  }

  /**
   * Resolves collision impulse, Coulomb slip-stick friction, and angular spin.
   */
  static resolveImpulse(
    manifold: ContactManifold,
    ballVel: Vector3,
    ballSpin: Vector3,
    ballMass: number,
    ballInertia: number,
    ballRadius: number,
    controlledBootResponse?: ControlledBootResponse | null
  ): CollisionImpulseResult {
    const body = manifold.body;
    const n = manifold.normal;

    // Contact point on capsule interpolates endpoint velocities by closest-point parameter s
    let bodyContactVel = body.velocity;
    if (body.shape.type === 'capsule' && body.shape.v1 && body.shape.v2) {
      const p1 = body.shape.p1;
      const p2 = body.shape.p2;
      const seg = p2.sub(p1);
      const segLenSq = seg.lengthSq();
      const sParam = segLenSq > 1e-6
        ? Math.max(0, Math.min(1, manifold.contactPoint.sub(p1).dot(seg) / segLenSq))
        : 0.5;
      bodyContactVel = body.shape.v1.scale(1 - sParam).add(body.shape.v2.scale(sParam));
    }

    // Check if boot zone properties apply
    let effectiveRestitution = body.restitution;
    let effectiveFriction = body.friction;
    let contactZone: BootZoneId | undefined;
    let powerCap: number | undefined;

    if ((body.id.includes('boot') || body.id.includes('foot')) && body.shape.type === 'capsule') {
      const isRight = body.isRightFoot ?? body.id.includes('right');
      const bootYaw = body.bootYaw ?? Math.atan2(bodyContactVel.y, bodyContactVel.x);
      const bootPitch = body.bootPitch ?? 0;
      const bootContact = classifyBootContact(
        manifold.contactPoint,
        n,
        body.shape.p1,
        body.shape.p2,
        bootYaw,
        bootPitch,
        isRight
      );
      contactZone = bootContact.zone;
      effectiveRestitution = body.restitution * bootContact.properties.restitutionMult;
      effectiveFriction = bootContact.properties.friction;
      powerCap = bootContact.properties.powerCap;
    }

    // Contact point radius vector from ball center: r_contact = -n * ballRadius
    const rContact = n.scale(-ballRadius);

    // Surface velocity of ball at contact point (including spin: v + omega x r)
    const spinLinearVel = ballSpin.cross(rContact);
    const ballContactVel = ballVel.add(spinLinearVel);

    // Relative contact velocity between ball surface and moving body contact point
    const vRel = ballContactVel.sub(bodyContactVel);
    const vRelNormal = vRel.dot(n);

    // Normal Impulse: Only apply if approaching (vRelNormal < 0)
    let jNormal = 0;
    const invMassBall = 1 / ballMass;
    const invMassBody = 1 / body.effMass;
    const invEffMassNormal = invMassBall + invMassBody;

    // Zone power cap enforcement via speed-dependent restitution:
    // If the prospective normal impulse from relative velocity would exceed what the boot zone structure
    // can transmit (powerCap), the restitution compresses smoothly rather than artificially clamping post-impact velocity.
    if (powerCap !== undefined && vRelNormal < 0) {
      const maxNormalSpeed = powerCap;
      const nominalPostSpeed = -(1 + effectiveRestitution) * vRelNormal / (1 + ballMass / body.effMass);
      if (nominalPostSpeed > maxNormalSpeed) {
        const requiredRestitution = Math.max(0.05, (maxNormalSpeed * (1 + ballMass / body.effMass) / -vRelNormal) - 1);
        effectiveRestitution = Math.min(effectiveRestitution, requiredRestitution);
      }
    }

    // A deliberate cushion changes boot compliance, while retaining the same
    // finite-mass impulse and Coulomb-friction calculation as passive contact.
    if (controlledBootResponse && vRelNormal < 0) {
      const approachSpeed = -vRelNormal;
      const excessSpeed = Math.max(0, approachSpeed - controlledBootResponse.handlingSpeedMps);
      const skillAdjustedRestitution = controlledBootResponse.baseRestitution + excessSpeed * 0.08;
      effectiveRestitution = Math.min(effectiveRestitution, skillAdjustedRestitution);
      effectiveFriction = Math.min(1.2, effectiveFriction + controlledBootResponse.frictionBonus);
    }

    if (vRelNormal < 0) {
      jNormal = -(1 + effectiveRestitution) * vRelNormal / invEffMassNormal;
    }

    // Tangential Slip Velocity
    const vNormalVec = n.scale(vRelNormal);
    const vTangential = vRel.sub(vNormalVec);
    const vTanSpeed = vTangential.length();

    let deltaOmega = Vector3.zero();
    let jTangentialVec = Vector3.zero();

    // Skip tangential impulse when jNormal == 0 or the contact is separating (vRelNormal >= 0)
    if (vTanSpeed > 1e-4 && jNormal > 0 && vRelNormal < 0) {
      const uTan = vTangential.scale(1 / vTanSpeed);

      // Tangential Effective Mass (including ball moment of inertia: 1/m + r^2/I = 2.5/m for thin shell)
      const invEffMassTan = (2.5 / ballMass) + invMassBody;

      // Slip-Stick Clamp: impulse needed to completely zero contact-point slip
      const jStick = vTanSpeed / invEffMassTan;

      // Coulomb Friction Limit: mu * j_normal
      const jMaxFriction = effectiveFriction * jNormal;

      const jTanMag = Math.min(jStick, jMaxFriction);
      jTangentialVec = uTan.scale(-jTanMag);

      // Torque from tangential friction impulse generates angular spin: deltaOmega = (r x j_t) / I
      const torqueImpulse = rContact.cross(jTangentialVec);
      deltaOmega = torqueImpulse.scale(1 / ballInertia);
    }

    // Total Linear Velocity Change: deltaV = (j_n * n + j_t) / m_ball
    let netImpulse = n.scale(jNormal).add(jTangentialVec);
    let deltaV = netImpulse.scale(invMassBall);

    // Positional Penetration Resolution
    const separationBuffer = SIM_CONFIG.COLLISION.PENETRATION_BUFFER;
    const posCorrection = n.scale(manifold.penetration + separationBuffer);

    // Ground Pin Detection: If ball is driven downward into the pitch
    let isGroundPinned = false;
    if (n.z < -0.1) {
      isGroundPinned = true;
    }

    return {
      deltaV,
      deltaOmega,
      posCorrection,
      isGroundPinned,
      netImpulse,
      contactZone,
    };
  }
}
