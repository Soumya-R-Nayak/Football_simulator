import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';

export type Gait = 'walk' | 'jog' | 'sprint';

export interface Intent {
  /** Normalized desired movement direction vector (magnitude in [0, 1]) */
  readonly moveDir: Vector2;
  /** Desired torso facing direction vector (null to align torso with movement) */
  readonly faceDir?: Vector2 | null;
  /** Requested movement gait */
  readonly gait?: Gait;
  /** Locks torso orientation to current angle when true (jockeying / backpedaling) */
  readonly holdFacing?: boolean;
  /** Dev-only manual torso turn request (-1 = left, +1 = right, 0 = none) */
  readonly manualTurn?: number;
  /** Request an intentional controlled ground slide / slide tackle */
  readonly requestSlide?: boolean;
}

export type FootId = 'left' | 'right';
export type StridePhase = 'stance' | 'flight';

export interface StrideState {
  /** Active foot executing stance contact or swinging */
  readonly currentFoot: FootId;
  /** Stance (foot planted on turf applying force) vs. Flight (both feet airborne) */
  readonly phase: StridePhase;
  /** Progress through current phase [0.0, 1.0] */
  readonly phaseProgress: number;
  /** Dynamic cadence in strides per second (Hz) */
  readonly cadence: number;
  /** Dynamic stride length in meters */
  readonly strideLength: number;
  /** World coordinates of the planted cleat on turf (null during flight) */
  readonly plantPosition: Vector2 | null;
  /** Neutral lateral separation between feet (m) */
  readonly stanceWidth: number;
  /** World position of left foot */
  readonly leftFootPos: Vector2;
  /** World position of right foot */
  readonly rightFootPos: Vector2;
  /** Whether the player is currently executing a braking chop step */
  readonly isBraking: boolean;
  /** Number of chop steps remaining to complete high-speed stop */
  readonly chopStepsRemaining: number;
  /** Rhythmic pelvic yaw twist angle (radians relative to torso) */
  readonly pelvicAngle: number;
  /** Lateral displacement offset of COM over stance foot (meters) */
  readonly lateralSway: number;
  /** Whether the player is in an initial drop-step false start */
  readonly isDropStep: boolean;
  /** Whether both feet are on turf during walking double-support (no flight phase) */
  readonly isDoubleSupport: boolean;
}

export type FootDominance = 'right' | 'left' | 'both';

export interface PlayerFootedness {
  readonly dominantFoot: FootDominance;
  readonly weakFootAbility: number; // 0.2 (1-star / pure one-footed) to 1.0 (5-star / ambipedal)
}

export interface PlayerAttributes {
  readonly name: string;
  readonly heightCm: number;        // Anthropometrics: 165 to 198 cm
  readonly weightKg: number;        // Anthropometrics: 65 to 95 kg
  readonly topSpeed: number;        // 0 to 100 -> terminal sprint speed 7.2 to 9.8 m/s
  readonly acceleration: number;    // 0 to 100 -> propulsive GRF 4.8 to 7.5 m/s²
  readonly agility: number;         // 0 to 100 -> lateral grip 4.5 to 7.0 m/s², turn rate 6.5 to 11.5 rad/s
  readonly balance: number;         // 0 to 100 -> COM stability & recovery damping
  readonly strength: number;        // 0 to 100 -> eccentric braking 5.5 to 9.2 m/s²
  readonly stamina: number;         // 0 to 100 -> fatigue resistance
  readonly footedness: PlayerFootedness;
}

export const PLAYER_PRESETS: Record<string, PlayerAttributes> = {
  balanced: {
    name: 'Balanced Pro',
    heightCm: 180,
    weightKg: 75,
    topSpeed: 80,
    acceleration: 80,
    agility: 80,
    balance: 80,
    strength: 80,
    stamina: 85,
    footedness: { dominantFoot: 'right', weakFootAbility: 0.2 },
  },
  explosive_agilist: {
    name: 'Explosive Agilist (Messi / Bernardo)',
    heightCm: 170,
    weightKg: 67,
    topSpeed: 82,
    acceleration: 95,
    agility: 96,
    balance: 95,
    strength: 64,
    stamina: 85,
    footedness: { dominantFoot: 'left', weakFootAbility: 0.8 },
  },
  lengthy_powerhouse: {
    name: 'Lengthy Powerhouse (Haaland / Van Dijk)',
    heightCm: 194,
    weightKg: 88,
    topSpeed: 96,
    acceleration: 84,
    agility: 68,
    balance: 75,
    strength: 96,
    stamina: 90,
    footedness: { dominantFoot: 'left', weakFootAbility: 0.6 },
  },
  speed_demon: {
    name: 'Direct Speed Demon (Mbappé / Davies)',
    heightCm: 178,
    weightKg: 73,
    topSpeed: 98,
    acceleration: 96,
    agility: 88,
    balance: 84,
    strength: 78,
    stamina: 88,
    footedness: { dominantFoot: 'right', weakFootAbility: 0.8 },
  },
  heavy_anchor: {
    name: 'Heavy Anchor (Maguire / Giroud)',
    heightCm: 193,
    weightKg: 91,
    topSpeed: 64,
    acceleration: 54,
    agility: 52,
    balance: 70,
    strength: 92,
    stamina: 82,
    footedness: { dominantFoot: 'right', weakFootAbility: 0.6 },
  },
};

export interface CutStatus {
  readonly isCutting: boolean;
  readonly plantFoot: FootId | null;
  readonly isOutsideFoot: boolean;
  readonly isDominantPlant: boolean;
  readonly plantEfficiency: number; // 0.84 to 1.0
}

export type StudType = 'fg_plastic' | 'sg_metal';
export type SlipType = 'none' | 'micro_slip' | 'wipeout' | 'controlled_slide';

export interface SlipStatus {
  readonly type: SlipType;
  readonly skidVelocity: Vector2;
  readonly timer: number;            // Remaining recovery time (seconds)
  readonly initialDuration: number; // Total initial duration of slip (seconds)
  readonly tractionDemand: number;   // Demanded horizontal acceleration / g
  readonly availableTraction: number;// Maximum available traction coefficient (TC_avail)
  readonly slipFoot: FootId | null;  // Foot that broke traction
  readonly isControlled?: boolean;   // True for deliberate slide tackle / slide brake
}

export interface PitchDivot {
  readonly id: number;
  readonly position: Vector2;        // In SI meters [x, y]
  readonly radius: number;          // Divot scar radius (meters)
  readonly depth: number;           // Divot depth (meters)
  readonly heading: number;         // Furrow tear orientation angle in radians
  readonly turfTornPct: number;     // 0.0 to 1.0 scar severity
  readonly createdAt: number;       // Sim timestamp when divot was created
}

export interface PitchRut {
  readonly id: number;
  readonly startPos: Vector2;       // In SI meters [x, y]
  readonly endPos: Vector2;         // In SI meters [x, y]
  readonly width: number;           // Rut furrow width (meters)
  readonly depth: number;           // Rut furrow depth (meters)
  readonly severity: number;        // 0.0 to 1.0
  readonly createdAt: number;       // Sim timestamp when rut was created
  readonly moisture?: number;       // Pitch surface moisture when furrow was cut
  readonly isWaterlogged?: boolean; // True if slide was hydroplaning in water/puddle
}

export type PitchTierId =
  | 'tier1_elite_hybrid'
  | 'tier2_pro_sand'
  | 'tier3_semipro_loam'
  | 'tier4_grassroots_clay';

export interface PitchTierProfile {
  readonly id: PitchTierId;
  readonly name: string;
  readonly tier: 1 | 2 | 3 | 4;
  readonly description: string;
  // Drainage & Hydrology
  readonly gravityDrainageMmH: number; // Natural soil percolation rate (mm/h)
  readonly vacuumDrainageMmH: number;  // Active SubAir vacuum suction (mm/h)
  readonly equilibriumMoisture: number;// Equilibrium moisture retention (0.15 to 0.35)
  // Micro-Topography
  readonly topographyRoughnessMm: number; // Planarity standard deviation (1mm = elite, 30mm = rough)
  // Soil Hardness & Clegg Impact
  readonly baseCleggHardness: number;  // Optimal CIV (65-85 FIFA standard)
  // Shear Endurance & Divots
  readonly rootShearStrengthNm: number; // Rotational traction resistance (Nm)
  readonly divotShearThreshold: number; // Cut acceleration required to tear sod (m/s²)
  readonly maxDivotRadius: number;     // Maximum divot scar radius (m)
  readonly rutDepthMultiplier: number; // Multiplier on furrow depth
}

export const PITCH_TIER_PRESETS: Record<PitchTierId, PitchTierProfile> = {
  tier1_elite_hybrid: {
    id: 'tier1_elite_hybrid',
    name: 'Tier 1: Elite Reinforced Hybrid (SISGrass / Desso)',
    tier: 1,
    description: 'Stitched polyethylene fiber sand carpet with active SubAir vacuum suction. Instant drainage, laser-graded flat, supreme shear resistance.',
    gravityDrainageMmH: 50.0,
    vacuumDrainageMmH: 30.0,
    equilibriumMoisture: 0.22,
    topographyRoughnessMm: 1.2,
    baseCleggHardness: 78.0,
    rootShearStrengthNm: 58.0,
    divotShearThreshold: 13.5,
    maxDivotRadius: 0.045,
    rutDepthMultiplier: 0.40,
  },
  tier2_pro_sand: {
    id: 'tier2_pro_sand',
    name: 'Tier 2: Professional Sand-Capped (Championship)',
    tier: 2,
    description: 'Sand-carpet rootzone with perforated gravity pipe drains. Good drainage, minimal undulations, solid natural turf shear strength.',
    gravityDrainageMmH: 20.0,
    vacuumDrainageMmH: 0.0,
    equilibriumMoisture: 0.25,
    topographyRoughnessMm: 4.5,
    baseCleggHardness: 74.0,
    rootShearStrengthNm: 44.0,
    divotShearThreshold: 9.5,
    maxDivotRadius: 0.070,
    rutDepthMultiplier: 0.75,
  },
  tier3_semipro_loam: {
    id: 'tier3_semipro_loam',
    name: 'Tier 3: Semi-Pro Sandy Loam (National League)',
    tier: 3,
    description: 'Native topsoil with basic slit drainage. Susceptible to pooling during heavy rain, noticeable micro-undulations and divot scars.',
    gravityDrainageMmH: 6.0,
    vacuumDrainageMmH: 0.0,
    equilibriumMoisture: 0.30,
    topographyRoughnessMm: 12.0,
    baseCleggHardness: 68.0,
    rootShearStrengthNm: 32.0,
    divotShearThreshold: 7.2,
    maxDivotRadius: 0.095,
    rutDepthMultiplier: 1.05,
  },
  tier4_grassroots_clay: {
    id: 'tier4_grassroots_clay',
    name: 'Tier 4: Grassroots Heavy Clay (Sunday League / Park)',
    tier: 4,
    description: 'Untreated heavy native clay with zero sub-surface drainage. Becomes a boggy mudbath in rain, rough bumpy surface, shallow easily-torn sod.',
    gravityDrainageMmH: 0.8,
    vacuumDrainageMmH: 0.0,
    equilibriumMoisture: 0.35,
    topographyRoughnessMm: 32.0,
    baseCleggHardness: 58.0,
    rootShearStrengthNm: 22.0,
    divotShearThreshold: 5.2,
    maxDivotRadius: 0.130,
    rutDepthMultiplier: 1.40,
  },
};

export interface PitchSurfaceState {
  readonly grassHeightMm: number;    // Regulation cutting height (18 to 36 mm, default 24 mm)
  readonly divotsCount: number;
  readonly rutsCount: number;        // Number of active cleat ruts on pitch
  readonly averageWear: number;      // Average wear over central pitch area (0.0 to 1.0)
  readonly baseMoisture: number;     // Water saturation level (0.0 = bone dry, 0.25 = damp, 0.65 = wet slick, 0.90 = waterlogged)
  readonly rollingFrictionMult: number; // Multiplier on ball rolling friction
  readonly puddlesCount: number;     // Standing puddle waterlogged count
  readonly tierId: PitchTierId;      // Active pitch profile tier
  readonly precipitationMmH: number; // Current rainfall rate (mm/h)
  readonly drainageRateMmH: number;  // Current active drainage extraction rate (mm/h)
  readonly cleggHardness: number;    // Soil hardness in Clegg Impact Value (CIV: 25 = mud, 75 = standard, 120 = baked hardpan)
  readonly simulatedMatchMinutes?: number; // Total simulated match wear time (minutes)
}

export interface PlayerState {
  readonly id: string;
  readonly position: Vector2;       // In SI meters [x, y]
  readonly velocity: Vector2;       // In m/s [vx, vy]
  readonly facing: number;          // Torso heading angle in radians [-π, π]
  readonly angularVelocity: number; // Current rotation speed in rad/s
  readonly stamina: number;         // Normalized stamina pool [0.0, 1.0]
  readonly gait: Gait;              // Active gait
  readonly stride: StrideState;     // Discrete footstep and gait state
  readonly headOffset: Vector2;     // 3D head lean displacement relative to torso center (meters)
  readonly shoulderAngle: number;   // Arm/shoulder counter-pump angle (radians)
  readonly headYaw: number;         // Head look-ahead yaw relative to torso (radians, axial gaze anticipation)
  readonly verticalBounce: number;  // Vertical COM displacement (meters, + for flight, - for stance impact)
  readonly footedness: PlayerFootedness; // Footedness profile and weak-foot ability
  readonly cutStatus: CutStatus;    // Live plant-and-cut telemetry
  readonly attributes: PlayerAttributes; // Active physical and biomechanical attributes
  readonly curveIndex: number;      // Continuous Sprint Curve Index (κ in [-0.30, 0.30])
  readonly studType: StudType;      // Active footwear studs (FG plastic vs SG metal)
  readonly slipStatus: SlipStatus;  // Live biomechanical slipping / wipeout state
  readonly pitchFatigueMultiplier: number; // Pitch-coupled metabolic work multiplier (1.0 = optimal, > 1.4 = heavy mud/tall grass)
}

export type BallFlightState = 'flight' | 'bounce' | 'rolling' | 'at_rest';
export type DragRegime = 'subcritical' | 'transitional' | 'supercritical';
export type TurfCondition = 'standard' | 'wet_slick' | 'dry_heavy';

export interface TurfProperties {
  readonly name: string;
  readonly rollingFriction: number; // mu_roll
  readonly restitutionMult: number; // multiplier for ball restitution
  readonly skidFriction: number;    // mu_k
  readonly tractionFactor: number;  // Available cleat traction multiplier
}

export const TURF_PRESETS: Record<TurfCondition, TurfProperties> = {
  standard: {
    name: 'Standard Regulation Pitch',
    rollingFriction: 0.08,
    restitutionMult: 1.0,
    skidFriction: 0.35,
    tractionFactor: 1.0,
  },
  wet_slick: {
    name: 'Wet Slick Turf (Watered)',
    rollingFriction: 0.045,
    restitutionMult: 1.10,
    skidFriction: 0.22,
    tractionFactor: 0.68,
  },
  dry_heavy: {
    name: 'Dry Heavy Grass (Uncut)',
    rollingFriction: 0.125,
    restitutionMult: 0.90,
    skidFriction: 0.45,
    tractionFactor: 1.05,
  },
};

export type BallPatternType =
  | 'modern_speedshell'
  | 'jabulani_8'
  | 'classic_32'
  | 'futsal_lowbounce'
  | 'retro_leather';

export interface BallVisualConfig {
  readonly patternType: BallPatternType;
  readonly baseColor: string;
  readonly patchColor: string;
  readonly accentColor: string;
  readonly seamColor: string;
}

export interface BallModelConfig {
  readonly id: string;
  readonly name: string;
  readonly year: number;
  readonly description: string;
  readonly mass: number;           // kg (0.410 - 0.450 kg regulation)
  readonly radius: number;         // m (0.11 m regulation)
  readonly inertia: number;        // kg·m²
  readonly baseCd: number;         // Subcritical drag coefficient (e.g. 0.32 - 0.38)
  readonly supercriticalCd: number;// Supercritical turbulent drag coefficient (e.g. 0.15 - 0.22)
  readonly criticalSpeed: number;  // Speed (m/s) where boundary layer transitions (drag crisis)
  readonly seamRoughness: number;  // 0.0 to 1.0 (higher = more erratic low-spin knuckleball wobble)
  readonly magnusGain: number;     // Multiplier on Magnus lift/curl response
  readonly restitution: number;    // Base turf bounce restitution (e_turf)
  readonly visual: BallVisualConfig;
}

export const BALL_PRESETS: Record<string, BallModelConfig> = {
  modern_match: {
    id: 'modern_match',
    name: 'Modern Match Ball (Nike Flight / Al Rihla)',
    year: 2024,
    description: 'Debossed Aerowsculpt micro-grooves. Engineered for flight stability and sharp late-bend curl.',
    mass: 0.430,
    radius: 0.11,
    inertia: 0.00347,
    baseCd: 0.32,
    supercriticalCd: 0.20,
    criticalSpeed: 19.5,
    seamRoughness: 0.20,
    magnusGain: 1.00,
    restitution: 0.65,
    visual: {
      patternType: 'modern_speedshell',
      baseColor: '#ffffff',
      patchColor: '#0f172a',
      accentColor: '#06b6d4',
      seamColor: '#334155',
    },
  },
  jabulani_2010: {
    id: 'jabulani_2010',
    name: 'Adidas Jabulani (2010 World Cup)',
    year: 2010,
    description: 'Radically smooth 8-panel sphere with shallow seams. Late drag crisis and violent unpredictable knuckleball wobbles.',
    mass: 0.438,
    radius: 0.11,
    inertia: 0.00353,
    baseCd: 0.38,
    supercriticalCd: 0.15,
    criticalSpeed: 25.5,
    seamRoughness: 0.88,
    magnusGain: 1.15,
    restitution: 0.72,
    visual: {
      patternType: 'jabulani_8',
      baseColor: '#ffffff',
      patchColor: '#000000',
      accentColor: '#eab308',
      seamColor: '#1e293b',
    },
  },
  classic_telstar: {
    id: 'classic_telstar',
    name: 'Classic Telstar (1970 32-Panel)',
    year: 1970,
    description: 'Traditional 32 hand-stitched hexagon/pentagon panels. Early drag crisis, ultra-stable predictable flight with zero knuckle drift.',
    mass: 0.440,
    radius: 0.11,
    inertia: 0.00355,
    baseCd: 0.34,
    supercriticalCd: 0.22,
    criticalSpeed: 16.5,
    seamRoughness: 0.08,
    magnusGain: 0.95,
    restitution: 0.62,
    visual: {
      patternType: 'classic_32',
      baseColor: '#ffffff',
      patchColor: '#0f172a',
      accentColor: '#475569',
      seamColor: '#1e293b',
    },
  },
  futsal_lowbounce: {
    id: 'futsal_lowbounce',
    name: 'Futsal Pro (Low-Bounce Training)',
    year: 2024,
    description: 'Damped synthetic bladder with heavier core. Minimal bounce apex, tight turf rolling control.',
    mass: 0.445,
    radius: 0.105,
    inertia: 0.00327,
    baseCd: 0.33,
    supercriticalCd: 0.21,
    criticalSpeed: 18.0,
    seamRoughness: 0.15,
    magnusGain: 0.85,
    restitution: 0.42,
    visual: {
      patternType: 'futsal_lowbounce',
      baseColor: '#bef264',
      patchColor: '#4c1d95',
      accentColor: '#a855f7',
      seamColor: '#3b0764',
    },
  },
  retro_leather: {
    id: 'retro_leather',
    name: 'Retro 1966 Heavy Leather',
    year: 1966,
    description: 'Heavy 18-strip stitched raw leather. Significant inertia, solid thud, lower Magnus curvature.',
    mass: 0.468,
    radius: 0.112,
    inertia: 0.00392,
    baseCd: 0.36,
    supercriticalCd: 0.24,
    criticalSpeed: 17.0,
    seamRoughness: 0.18,
    magnusGain: 0.88,
    restitution: 0.55,
    visual: {
      patternType: 'retro_leather',
      baseColor: '#b45309',
      patchColor: '#78350f',
      accentColor: '#d97706',
      seamColor: '#451a03',
    },
  },
};

export interface WindCondition {
  readonly speed: number;          // Base wind speed in m/s (0 = calm, 6 = moderate breeze, 12 = gale)
  readonly heading: number;        // Direction wind blows TOWARD in radians (0 = blowing East, PI/2 = blowing North)
  readonly gustIntensity: number;  // 0.0 to 1.0 gust volatility (default 0.20)
}

export interface BallState {
  readonly position: Vector3;       // 3D position in meters (x, y on pitch, z is altitude; turf level is z = 0.11m)
  readonly velocity: Vector3;       // 3D velocity in m/s (vx, vy, vz)
  readonly spin: Vector3;           // 3D rotational spin vector in rad/s (ωx, ωy, ωz)
  readonly flightState: BallFlightState;
  readonly lastContactTime: number; // Sim timestamp of last turf impact or roll (s)
  readonly modelId: string;         // ID of the active ball preset
  readonly dragRegime: DragRegime;  // Current aerodynamic boundary layer regime
  readonly isKnuckling: boolean;    // Whether chaotic seam vortex perturbation is active
  readonly turfCondition: TurfCondition; // Active turf condition
  readonly wind?: WindCondition;    // Active atmospheric wind condition
}
