import { BallControlIntent, PlayerAttributes } from '../types';
import { ContactBody } from './ContactBody';

export interface ControlledBootResponse {
  /** Restitution while the incoming normal speed is within the player's control envelope. */
  readonly baseRestitution: number;
  /** Incoming normal speed the player can cushion reliably, in m/s. */
  readonly handlingSpeedMps: number;
  /** Skill-scaled friction increase while the boot actively presents for the touch. */
  readonly frictionBonus: number;
}

/**
 * Converts a receive/trap request into boot-surface properties. It never moves
 * the ball directly; the collision solver still computes the contact impulse.
 */
export function getControlledBootResponse(
  intent: BallControlIntent | undefined,
  body: ContactBody,
  attributes: PlayerAttributes
): ControlledBootResponse | null {
  if (!intent || !body.id.endsWith('_boot')) return null;

  const foot = body.isRightFoot ? 'right' : 'left';
  if (intent.preferredFoot && intent.preferredFoot !== foot) return null;

  const firstTouch = Math.max(0, Math.min(100, attributes.firstTouch)) / 100;
  const isWeakFoot = attributes.footedness.dominantFoot !== 'both' &&
    attributes.footedness.dominantFoot !== foot;
  const weakFootFactor = isWeakFoot
    ? Math.max(0.2, Math.min(1, attributes.footedness.weakFootAbility))
    : 1;
  const quality = firstTouch * (0.8 + 0.2 * weakFootFactor);
  const isTrap = intent.mode === 'trap';

  return {
    baseRestitution: isTrap
      ? 0.05 + (1 - quality) * 0.18
      : 0.10 + (1 - quality) * 0.18,
    handlingSpeedMps: (isTrap ? 2.0 : 2.5) + quality * 4.5,
    frictionBonus: quality * (isTrap ? 0.20 : 0.12),
  };
}
