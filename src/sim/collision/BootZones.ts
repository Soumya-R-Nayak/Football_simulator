import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';

export type BootZoneId = 'instep' | 'medial' | 'lateral' | 'toe' | 'heel' | 'sole';

export interface BootZoneProperties {
  readonly name: string;
  readonly restitutionMult: number;
  readonly friction: number;
  readonly powerCap: number;
  readonly errorSpreadRad: number;
}

export interface BootLocalContact {
  readonly zone: BootZoneId;
  readonly properties: BootZoneProperties;
  readonly uLong: number;    // Projection along heel->toe axis [-1, 1]
  readonly vLat: number;     // Projection along lateral axis [-1, 1]
  readonly wUp: number;      // Projection along vertical laces axis [-1, 1]
  readonly sAxis: number;    // Longitudinal fraction along segment [0, 1]
}

/**
 * Resolves boot-local coordinates and classifies contact point into boot zones:
 * instep (laces), medial (inside), lateral (outside), toe, heel, sole.
 */
export function classifyBootContact(
  contactPoint: Vector3,
  normal: Vector3,            // Unit normal pointing FROM boot TO ball
  heelCenter: Vector3,
  toeCenter: Vector3,
  bootYaw: number,
  bootPitch: number,
  isRightFoot: boolean
): BootLocalContact {
  const bootAxis = toeCenter.sub(heelCenter);
  const axisLen = bootAxis.length();
  const uLongVec = axisLen > 1e-4
    ? bootAxis.scale(1 / axisLen)
    : new Vector3(Math.cos(bootYaw) * Math.cos(bootPitch), Math.sin(bootYaw) * Math.cos(bootPitch), Math.sin(bootPitch));

  // Closest point parameter s along heel->toe axis [0, 1]
  const toContact = contactPoint.sub(heelCenter);
  const sAxis = axisLen > 1e-4 ? Math.max(0, Math.min(1, toContact.dot(bootAxis) / (axisLen * axisLen))) : 0.5;

  // Lateral vector: points to the RIGHT side of the boot
  // In horizontal plane, perpendicular to yaw: (sin(yaw), -cos(yaw), 0)
  const vLatVec = new Vector3(Math.sin(bootYaw), -Math.cos(bootYaw), 0).normalize();

  // Up vector (perpendicular to long axis and lateral vector): points toward laces/instep (+z)
  const wUpVec = vLatVec.cross(uLongVec).normalize();

  // Normal projections in boot frame
  const uLong = normal.dot(uLongVec);
  const vLat = normal.dot(vLatVec);
  const wUp = normal.dot(wUpVec);

  // Determine whether lateral projection is on the outside (lateral) or inside (medial)
  // For Right Foot: +vLat is outside (lateral), -vLat is inside (medial)
  // For Left Foot:  -vLat is outside (lateral), +vLat is inside (medial)
  const isLateralSide = isRightFoot ? (vLat > 0) : (vLat < 0);

  let zone: BootZoneId;

  if (wUp < -0.32) {
    // Underside stud zone
    zone = 'sole';
  } else if (sAxis > 0.82 || uLong > 0.60) {
    // Front apex
    zone = 'toe';
  } else if (sAxis < 0.18 || uLong < -0.60) {
    // Rear apex
    zone = 'heel';
  } else if (wUp > 0.35 && Math.abs(vLat) < 0.52) {
    // Top surface / laces
    zone = 'instep';
  } else if (isLateralSide) {
    // Outside boot flank
    zone = 'lateral';
  } else {
    // Inside boot flank
    zone = 'medial';
  }

  const properties = SIM_CONFIG.BOOT_ZONES[zone];

  return {
    zone,
    properties,
    uLong,
    vLat,
    wUp,
    sAxis,
  };
}
