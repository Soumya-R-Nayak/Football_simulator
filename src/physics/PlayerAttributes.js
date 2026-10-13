/**
 * Football Manager 2024 (FM24) 1-20 Physical Attributes Profile System.
 * Grounded in sports biomechanics with dynamic Height (m) and Weight (kg) modulation.
 *
 * Configurable Attributes:
 *  - pace: 1-20 (Max running velocity)
 *  - acceleration: 1-20 (Rate of velocity increase from stop/lower speeds)
 *  - agility: 1-20 (Ability to turn, pivot, weave, and cut at speed)
 *  - balance: 1-20 (Stability against toppling, off-balance shooting, and contact)
 *  - jumping: 1-20 (Jumping Reach / vertical leap in aerial contests)
 *  - stamina: 1-20 (Cardiovascular resistance to high-intensity sprint fatigue)
 *  - strength: 1-20 (Muscle force, body mass inertia, and physical shielding dominance)
 *
 * Physical Variables:
 *  - height: meters (typically 1.65m - 2.02m)
 *  - weight: kg (typically 60kg - 98kg)
 */
export class PlayerAttributes {
  constructor(options = {}) {
    // Morphological Variables
    this.height = options.height || 1.78; // meters
    this.weight = options.weight || 75.0; // kilograms

    // FM24 1-20 Physical Attributes
    const attrs = options.attributes || options;
    this.pace = this._clamp(attrs.pace !== undefined ? attrs.pace : 14);
    this.acceleration = this._clamp(attrs.acceleration !== undefined ? attrs.acceleration : 14);
    this.agility = this._clamp(attrs.agility !== undefined ? attrs.agility : 14);
    this.balance = this._clamp(attrs.balance !== undefined ? attrs.balance : 14);
    this.jumping = this._clamp(attrs.jumping !== undefined ? attrs.jumping : 14);
    this.stamina = this._clamp(attrs.stamina !== undefined ? attrs.stamina : 14);
    this.strength = this._clamp(attrs.strength !== undefined ? attrs.strength : 14);

    // FM24 1-20 Technical Attributes
    this.firstTouch = this._clamp(attrs.firstTouch !== undefined ? attrs.firstTouch : (attrs.first_touch !== undefined ? attrs.first_touch : 14));
    this.technique = this._clamp(attrs.technique !== undefined ? attrs.technique : 14);
    this.dribbling = this._clamp(attrs.dribbling !== undefined ? attrs.dribbling : 14);
  }

  _clamp(val) {
    return Math.max(1, Math.min(20, Number(val) || 10));
  }

  // --------------------------------------------------------------------------
  // Morphological & Biomechanical Ratios
  // --------------------------------------------------------------------------

  /** Center of mass height above turf (m) ~ 56% of total height */
  get centerOfMassZ() {
    return this.height * 0.56;
  }

  /**
   * Height Agility Modifier:
   * Rotational inertia I = m * r² makes tall bodies take longer to reorient.
   * Shorter players (< 1.80m) have a lower CoM and turn quicker; tall players have a slight penalty.
   */
  get heightAgilityModifier() {
    return Math.pow(1.80 / this.height, 0.5);
  }

  /**
   * Height Balance Modifier:
   * Taller bodies experience larger tipping moments (tau = F * h_com).
   * Shorter, stockier players possess extraordinary rotational stability.
   */
  get heightBalanceModifier() {
    return Math.pow(1.80 / this.height, 0.6);
  }

  /**
   * Power-to-weight ratio modifier for acceleration:
   * Heavier bodies require greater muscular force (F = m * a) to reach burst speed.
   */
  get powerToWeightModifier() {
    return Math.pow(75.0 / this.weight, 0.20);
  }

  // --------------------------------------------------------------------------
  // Derived SI Metric Locomotion Limits
  // --------------------------------------------------------------------------

  /**
   * Top terminal sprint speed (m/s) in open field without ball.
   * Rating 1: ~5.6 m/s (20 km/h) -> Rating 20: 10.0 m/s (36 km/h)
   */
  get effectiveSprintSpeed() {
    return 5.4 + (this.pace / 20.0) * 4.6;
  }

  /**
   * Cruising run / jog speed (m/s) ~ 58% of top sprint speed.
   */
  get effectiveRunSpeed() {
    return this.effectiveSprintSpeed * 0.58;
  }

  /**
   * Maximum longitudinal acceleration (m/s²).
   * Modulated by player weight (power-to-weight ratio).
   * Rating 1: ~2.4 m/s² -> Rating 20: up to 6.6 m/s²
   */
  get maxAcceleration() {
    const base = 2.4 + (this.acceleration / 20.0) * 4.2;
    return base * this.powerToWeightModifier;
  }

  /**
   * Maximum lateral centripetal traction acceleration (m/s²) before cleat skid.
   * Governs turning radius (R = v² / a_lat).
   * Shorter players gain an agility bonus due to lower CoM.
   */
  get maxLatAcceleration() {
    const base = 4.2 + (this.agility / 20.0) * 5.4;
    return base * this.heightAgilityModifier;
  }

  /**
   * Plant-and-cut hip/torso pivot angular velocity (rad/s).
   * Dictates how fast a player snaps hips during a 90° cut or 180° reversal.
   */
  get pivotAngularVelocity() {
    const base = 12.0 + (this.agility / 20.0) * 20.0;
    return base * this.heightAgilityModifier;
  }

  /**
   * Stance quality balance floor (minimum power retention when shooting off-balance).
   * Rating 1: 0.40 (scuffed to 40% power) -> Rating 20: up to 0.85 (85% power retained).
   */
  get stanceBalanceFloor() {
    const base = 0.35 + (this.balance / 20.0) * 0.42;
    return Math.max(0.38, Math.min(0.85, base * Math.pow(this.heightBalanceModifier, 0.5)));
  }

  /**
   * Maximum shot/pass dispersion noise (radians) when off-balance.
   * High balance virtually eliminates spray on half-turns.
   */
  get stanceAngleNoise() {
    return 0.38 * (1.0 - 0.75 * (this.balance / 20.0));
  }

  /**
   * Vertical leap elevation (m) above turf.
   * Rating 1: 0.23m -> Rating 20: up to 0.90m (elite leap)
   */
  get verticalLeap() {
    return 0.20 + (this.jumping / 20.0) * 0.70;
  }

  /**
   * Total aerial reach height (m) in aerial contests = Player Height + Vertical Leap.
   * e.g., Messi (1.70m, jumping 8) reaches 2.18m; Haaland (1.95m, jumping 18) reaches 2.78m.
   */
  get aerialReach() {
    return this.height + this.verticalLeap;
  }

  /**
   * Forward anatomical foot reach envelope (m) at full stride extension.
   * Longer legs extend further ahead of the pelvis.
   */
  get footReachForward() {
    return 1.05 * Math.pow(this.height / 1.78, 0.75);
  }

  /**
   * Lateral anatomical foot reach envelope (m) across body.
   */
  get footReachLateral() {
    return 0.65 * Math.pow(this.height / 1.78, 0.75);
  }

  /**
   * High-intensity sprint stamina drain rate (% per second).
   * Rating 1: 13.2 %/s (~7.5s sprint) -> Rating 20: 7.0 %/s (~14.3s sprint).
   */
  get staminaDrainRate() {
    return 13.5 - (this.stamina / 20.0) * 6.5;
  }

  /**
   * Active aerobic stamina recovery rate (% per second) when walking, jockeying or idling.
   * Rating 1: 3.8 %/s -> Rating 20: 10.0 %/s.
   */
  get staminaRecoveryRate() {
    return 3.5 + (this.stamina / 20.0) * 6.5;
  }

  /**
   * Physical shielding force (Newtons) exerted when protecting the ball.
   * Scales with Strength rating and body mass (Weight).
   */
  get shieldingForce() {
    const baseForce = 150.0 + (this.strength / 20.0) * 400.0;
    return baseForce * Math.pow(this.weight / 75.0, 0.6);
  }

  /**
   * Ankle Compliance Coefficient for Ball Reception / Trapping (0.05 to 0.55):
   * Restitution coefficient e when cushioning an incoming pass or heavy contact.
   * Modulated by First Touch rating and Balance (absorbing off-balance increases bounce).
   * Elite First Touch (20): e ~ 0.08 (deadens ball right at toe).
   * Amateur (1-5): e ~ 0.50 (involuntary rebound bounce 1.5 - 2.5m away).
   */
  get receptionRestitution() {
    const ftNorm = this.firstTouch / 20.0;
    const balNorm = this.balance / 20.0;
    // Base restitution between 0.08 (elite) and 0.52 (clumsy)
    const baseE = 0.52 - ftNorm * 0.44;
    // Off-balance reception penalty
    const balFactor = 0.85 + 0.15 * (1.0 - balNorm);
    return Math.max(0.06, Math.min(0.58, baseE * balFactor));
  }

  /**
   * Directional trap & cut angle dispersion noise (radians).
   * Governed by Technique and First Touch.
   * High Technique produces lasers along intended trajectory; low Technique sprays ±20°.
   */
  get directionalTouchNoise() {
    const techFactor = (20.0 - this.technique) / 19.0;
    const ftFactor = (20.0 - this.firstTouch) / 19.0;
    const composite = (techFactor * 0.6 + ftFactor * 0.4);
    return composite * 0.38; // Up to 0.38 rad (~22°) for lowest rating
  }

  /**
   * Plant-and-Cut Exit Velocity Retention (%):
   * Momentum retained when executing a 90° or 180° cut while dribbling.
   * Synergizes Agility (musculoskeletal pivot) and Technique (clean cleat contact).
   */
  get cutSpeedRetention() {
    const agiNorm = this.agility / 20.0;
    const techNorm = this.technique / 20.0;
    // 0.52 (clunky amateur) up to 0.88 (Messi / Modrić)
    return 0.50 + agiNorm * 0.20 + techNorm * 0.18;
  }

  /**
   * Unconventional foot surface efficiency (outside-of-boot, heel, sole roll):
   * High Technique executes sharp angles and outside-of-foot touches with zero penalty.
   */
  get surfaceEfficiency() {
    return 0.60 + (this.technique / 20.0) * 0.40;
  }

  /**
   * Composite Dribble Quality Index (0.0 to 1.0):
   * Combines Dribbling (45%), Technique (30%), Agility (15%), Balance (10%).
   */
  get compositeDribbleQuality() {
    const d = this.dribbling / 20.0;
    const t = this.technique / 20.0;
    const a = this.agility / 20.0;
    const b = this.balance / 20.0;
    return d * 0.45 + t * 0.30 + a * 0.15 + b * 0.10;
  }

  // --------------------------------------------------------------------------
  // Static Iconic Archetypes
  // --------------------------------------------------------------------------

  static createArchetype(name) {
    switch (name.toUpperCase()) {
      case 'MESSI':
        return new PlayerAttributes({
          height: 1.70,
          weight: 72.0,
          attributes: { 
            pace: 16, acceleration: 19, agility: 20, balance: 20, jumping: 8, stamina: 16, strength: 12,
            firstTouch: 20, technique: 20, dribbling: 20
          }
        });
      case 'HAALAND':
        return new PlayerAttributes({
          height: 1.95,
          weight: 88.0,
          attributes: { 
            pace: 19, acceleration: 17, agility: 13, balance: 15, jumping: 18, stamina: 17, strength: 19,
            firstTouch: 15, technique: 15, dribbling: 14
          }
        });
      case 'MBAPPE':
        return new PlayerAttributes({
          height: 1.78,
          weight: 75.0,
          attributes: { 
            pace: 20, acceleration: 20, agility: 18, balance: 16, jumping: 12, stamina: 17, strength: 14,
            firstTouch: 17, technique: 18, dribbling: 19
          }
        });
      case 'MODRIC':
        return new PlayerAttributes({
          height: 1.72,
          weight: 66.0,
          attributes: { 
            pace: 14, acceleration: 15, agility: 19, balance: 18, jumping: 7, stamina: 19, strength: 10,
            firstTouch: 19, technique: 20, dribbling: 17
          }
        });
      case 'VAN_DIJK':
        return new PlayerAttributes({
          height: 1.93,
          weight: 92.0,
          attributes: { 
            pace: 16, acceleration: 14, agility: 12, balance: 16, jumping: 19, stamina: 16, strength: 20,
            firstTouch: 14, technique: 14, dribbling: 12
          }
        });
      case 'AMATEUR':
        return new PlayerAttributes({
          height: 1.78,
          weight: 80.0,
          attributes: { 
            pace: 7, acceleration: 7, agility: 7, balance: 7, jumping: 7, stamina: 6, strength: 8,
            firstTouch: 6, technique: 6, dribbling: 6
          }
        });
      default:
        return new PlayerAttributes();
    }
  }
}
