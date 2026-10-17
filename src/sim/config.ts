/**
 * Simulation Configuration & Biomechanical Tuning Constants (SI Metric Units).
 */
export const SIM_CONFIG = {
  // Pitch (FIFA Standard)
  PITCH: {
    LENGTH: 105.0, // meters along X [-52.5, +52.5]
    WIDTH: 68.0,   // meters along Y [-34.0, +34.0]
    BOUNDARY_MARGIN: 3.0, // meters runoff beyond touchlines
  },

  // Physics Timestep
  LOOP: {
    FIXED_DT: 1 / 120, // 120 Hz fixed timestep (~8.333 ms)
    MAX_CATCHUP_STEPS: 5,
  },

  // Athlete Gait Speeds (m/s)
  GAIT_SPEEDS: {
    walk: 1.6,   // 5.8 km/h brisk walking; keep steps within comfortable leg reach
    jog: 3.8,    // ~13.7 km/h; upper end of common soccer jogging bands
    run: 4.8,    // ~17.3 km/h; running reference speed for stride interpolation
    sprint: 9.4, // ~33.8 km/h (sprint button)
  },

  // Macroscopic Sprint Kinetics (Morin Model)
  KINEMATICS: {
    TAU: 0.95,            // Acceleration time constant (s)
    A_PROP_MAX: 9.5,      // Max forward propulsive acceleration from standstill (m/s²)
    A_BRAKE_MAX: 8.5,     // Max braking deceleration on cleat plant (m/s²)
    A_LAT_MAX: 6.5,       // Max lateral centripetal cutting acceleration (m/s²)
    OMEGA_MAX: 6.0,       // Baseline max torso angular speed (rad/s)
    ALPHA_YAW_MAX: 18.0,   // Baseline torso angular acceleration with firm support (rad/s²)
    SPEED_FACTOR_SIDE: 0.65, // Max speed factor when moving sideways (90 deg to torso)
    SPEED_FACTOR_BACK: 0.55, // Max speed factor when backpedaling (180 deg to torso)
  },

  // Discrete Stride Engine & Biomechanics
  STRIDE: {
    // Cadence / Step Frequencies (Hz - steps per second)
    CADENCE_WALK: 1.9,        // ~114 steps/min baseline brisk-walk cadence
    CADENCE_RUN: 2.8,         // ~168 steps/min at the running reference speed
    CADENCE_SPRINT: 4.3,      // ~258 steps/min (elite sprint frequency)
    CADENCE_JOCKEY: 3.2,      // ~192 steps/min (rapid defensive shuffle)
    CADENCE_BACKPEDAL: 3.6,   // ~216 steps/min (rapid high-frequency backpedal)

    // Foot recovery distances used to shape swing poses (m; not measured step length)
    STRIDE_LEN_WALK: 0.78,
    STRIDE_LEN_JOG: 1.40,
    STRIDE_LEN_SPRINT: 2.15,
    STRIDE_LEN_JOCKEY: 0.65,  // Choppy lateral slide
    STRIDE_LEN_BACKPEDAL: 0.60, // Short backward reach

    // Mediolateral COM Sway Amplitude (meters)
    SWAY_WALK: 0.035,         // ±3.5 cm lateral sway in inverted pendulum walk
    SWAY_JOG: 0.020,          // ±2.0 cm sway in jog
    SWAY_SPRINT: 0.008,       // ±0.8 cm narrow sway at top sprint
    SWAY_JOCKEY: 0.030,       // ±3.0 cm lateral surge pulse in jockey

    // Pelvic Yaw Rotation (radians)
    PELVIC_YAW_WALK: 0.08,    // ±4.6° hip twist
    PELVIC_YAW_JOG: 0.12,     // ±6.9° hip twist
    PELVIC_YAW_SPRINT: 0.20,  // ±11.5° explosive hip drive

    // Contact Timing (seconds)
    CONTACT_TIME_MIN: 0.09,   // Ground contact time at sprint
    CONTACT_TIME_MAX: 0.28,   // Ground contact time at walk

    // Anatomical Geometries
    STANCE_WIDTH_NORMAL: 0.28, // Neutral lateral hip separation (m)
    STANCE_WIDTH_JOCKEY: 0.44, // Wide athletic defensive base (m)
    DROP_STEP_DURATION: 0.07,  // Initial false-step hip drop on explosive start (s)
    DROP_STEP_OFFSET: 0.09,    // Backward drive foot anchor on drop step (m)
    MAX_LEG_LENGTH: 0.65,     // Inseam reach limit (m)
    REACH_FWD_MAX: 0.65,      // Max forward plant reach from hip (m)
    REACH_BACK_MAX: 0.65,     // Max backward push reach from hip (m)
    REACH_LAT_MIN: 0.05,      // Min lateral offset from centerline (m)
    REACH_LAT_MAX: 0.60,      // Max lateral abduction reach (m)
    MAX_TORSO_TWIST: 0.698,   // Max torso twist relative to pelvic propulsion (40 deg in rad)
    WALK_TO_RUN_SPEED: 2.1,   // Speed threshold between walking double-support and running flight (m/s)
    DOUBLE_SUPPORT_FRACTION: 0.22, // Fraction of step duration in double-support when walking
  },

  // Virtual Analog Input Dynamics
  INPUT: {
    RAMP_ATTACK_TIME: 0.100,   // Time to ramp from 0 to 1 (s, ~12 ticks at 120Hz)
    RAMP_REVERSAL_TIME: 0.035, // Time to cross zero on direction reversal (s, ~4 ticks)
  },

  // Visual/Render Dimensions & 3D Lean (meters)
  PLAYER_BODY: {
    TORSO_RADIUS: 0.24,  // Top-down torso shadow radius (collision uses COLLISION.TORSO_RADIUS)
    SHOULDER_WIDTH: 0.42, // Adult shoulder breadth at 1.80 m reference stature
    HEAD_RADIUS: 0.08,   // Head half-width for the top-down player drawing (m)
    CLEAT_LENGTH: 0.26,  // Boot visual length (m)
    CLEAT_WIDTH: 0.10,   // Boot visual width (m)
    MAX_ACCEL_LEAN: 0.18,  // Head forward/backward lean displacement (m)
    MAX_BANK_LEAN: 0.18,   // Head inward centripetal bank displacement (m)
    ARM_PUMP_MAX: 0.28,    // Shoulder counter-pump angle (rad, ~16°)
    MAX_GAZE_LEAD: 0.28,   // Max head look-ahead yaw during steering (rad, ~16°)
    DRIVE_PHASE_LEAN_BOOST: 0.08, // Extra forward lean in initial 0-4.5 m/s sprint drive (m)
    VERTICAL_BOUNCE_MAX: 0.055,   // Max vertical COM displacement in flight (m)
    COM_HEIGHT_RATIO: 0.55,        // Standing COM height as a fraction of player stature
    VERTICAL_COM_MIN_OFFSET: -0.12, // Maximum COM compression below standing height (m)
    VERTICAL_COM_SPRING_HZ: 12.0, // Stance support response frequency (rad/s)
    VERTICAL_COM_DAMPING_RATIO: 1.0,
    VERTICAL_COM_MAX_SUPPORT_G: 3.5,
  },

  // FIFA Standard Size 5 Match Ball & 3D Aerodynamics (Slice 2)
  BALL: {
    RADIUS: 0.11,                 // meters (22 cm diameter, 69 cm circumference)
    MASS: 0.430,                  // kilograms (430 grams)
    INERTIA: (2 / 3) * 0.430 * (0.11 * 0.11), // Thin spherical shell: ~0.00347 kg·m²
    GRAVITY: 9.81,                // m/s² downward
    AIR_DENSITY: 1.225,           // kg/m³ at sea level, 15°C
    DRAG_COEFFICIENT: 0.28,       // Baseline turbulent aerodynamic drag Cd
    LIFT_COEFFICIENT_MAX: 0.35,   // Peak Magnus lift coefficient CL
    SPIN_DRAG_FACTOR: 0.015,      // Aerodynamic spin damping per meter of travel (m⁻¹)
    RESTITUTION_TURF: 0.65,       // Vertical coefficient of restitution on natural grass
    RESTITUTION_POST: 0.75,       // Rebound coefficient off rigid steel goalpost
    FRICTION_SLIDE_TURF: 0.35,    // Kinetic sliding friction coefficient µ_k on grass
    FRICTION_ROLL_TURF: 0.08,     // Coulomb rolling resistance coefficient µ_roll
    STOP_VELOCITY_THRESHOLD: 0.05, // Speed below which ground rolling stops (m/s)
    STOP_BOUNCE_THRESHOLD: 0.12,  // Vertical velocity below which bounce stops (m/s)
  },

  // Physical Body Colliders & Contact Dynamics (Slice 3a & 3b)
  COLLISION: {
    // Torso 3D Capsule (starts at pelvis level, leaving space below for legs and close dribbling)
    TORSO_RADIUS: 0.28,             // meters
    TORSO_BASE_Z: 0.85,             // meters (pelvis bottom)
    TORSO_TOP_Z: 1.80,              // meters (top of head / torso capsule)
    TORSO_EFF_MASS: 75.0,           // kg
    TORSO_RESTITUTION: 0.35,        // Inelastic athletic torso rebound

    // Foot & Leg Anthropometrics (2-Bone IK Chain)
    HIP_HEIGHT: 0.90,               // meters (pelvis joint height)
    HIP_OFFSET_Y: 0.12,             // meters (lateral separation of hip joints from midline)
    HIP_TRANSLATION_MAX: 0.12,      // meters (pelvis shift toward the support base during stance)
    THIGH_LEN: 0.44,                // meters (femur length hip -> knee)
    SHIN_LEN: 0.44,                 // meters (tibia length knee -> ankle)
    THIGH_RADIUS: 0.10,             // meters (surface radius for thigh capsule)
    SHIN_RADIUS: 0.075,             // meters (surface radius for shin capsule)
    BOOT_LENGTH: 0.28,              // meters (heel to toe total length)
    BOOT_RADIUS: 0.05,              // meters (cross-sectional radius for boot capsule)
    BOOT_ANKLE_OFFSET_HEEL: 0.08,   // meters (ankle to heel distance)
    BOOT_ANKLE_OFFSET_TOE: 0.20,    // meters (ankle to toe distance)

    // Legacy Foot Colliders (kept for compatibility)
    FOOT_RADIUS: 0.09,              // meters
    FOOT_STANCE_Z: 0.05,            // meters
    FOOT_SWING_MAX_Z: 0.14,         // meters (peak swing clearance)

    // Segment Effective Masses (kg)
    LEG_LOADED_MASS: 80.0,          // kg (stance leg locked to ground by GRF)
    FOOT_LOADED_MASS: 80.0,         // kg (backward compatibility)
    FOOT_SWING_MASS: 2.5,           // kg (backward compatibility)
    THIGH_MASS_SWING: 7.0,          // kg (starting guess for free thigh swing)
    SHIN_MASS_SWING: 3.5,           // kg (starting guess for free shank swing)
    BOOT_MIN_MASS: 1.2,             // kg (relaxed ankle cushion)
    BOOT_MAX_MASS: 5.5,             // kg (locked ankle strike)

    // Restitution & Compliance
    FOOT_STANCE_RESTITUTION: 0.25,  // Heavy rigid ground stop
    FOOT_SWING_RESTITUTION: 0.45,   // Elastic passive swing tap
    BOOT_MIN_RESTITUTION: 0.18,     // Cushion / soft first touch
    BOOT_MAX_RESTITUTION: 0.65,     // Driven strike / locked ankle

    // Friction & Solver
    BOOT_FRICTION: 0.40,            // Coulomb friction coefficient
    MAX_SUBSTEPS: 3,                // Multi-contact TOI iterations per 120Hz tick
    PENETRATION_BUFFER: 0.002,      // 2 mm separation buffer
    SUBSTEP_EPSILON: 1e-6,          // Numerical time epsilon
    GROUND_PIN_REBOUND_FACTOR: 0.40, // Vertical rebound damping when ball is pinned against turf
  },

  // Boot Local Surface Zones (Slice 3b)
  BOOT_ZONES: {
    instep: {
      name: 'Instep (Laces)',
      restitutionMult: 1.0,
      friction: 0.35,
      powerCap: 34.0,              // m/s max ball exit speed
      errorSpreadRad: 0.03,         // Unused until 3e
    },
    medial: {
      name: 'Medial (Inside Foot)',
      restitutionMult: 0.92,
      friction: 0.45,
      powerCap: 26.0,
      errorSpreadRad: 0.04,
    },
    lateral: {
      name: 'Lateral (Outside Foot)',
      restitutionMult: 0.88,
      friction: 0.50,
      powerCap: 25.0,
      errorSpreadRad: 0.05,
    },
    toe: {
      name: 'Toe Tip',
      restitutionMult: 0.80,
      friction: 0.40,
      powerCap: 28.0,
      errorSpreadRad: 0.08,
    },
    heel: {
      name: 'Heel',
      restitutionMult: 0.65,
      friction: 0.45,
      powerCap: 18.0,
      errorSpreadRad: 0.10,
    },
    sole: {
      name: 'Sole (Underside Studs)',
      restitutionMult: 0.50,
      friction: 0.80,               // High friction generic zone
      powerCap: 15.0,
      errorSpreadRad: 0.06,
    },
  },

  // Kinematic Kick Swing Controller (Slice 3b)
  KICK_SWING: {
    KICK_REACH_M: 1.0,              // Max distance from hip to ball (meters)
    FOOT_SPEED_MAX: 26.0,           // Max swing foot speed at impact (m/s)
    BACKSWING_TIME: 0.08,           // Duration of backswing (seconds)
    FORWARD_SWING_TIME: 0.05,       // Duration of forward strike swing (seconds)
    FOLLOW_THROUGH_TIME: 0.06,      // Duration of follow-through deceleration (seconds)
    BLEND_OUT_TIME: 0.10,           // Duration of blend back to locomotion (seconds)
    MAX_STRIDE_WAIT_TIME: 0.40,     // Max wait time for running stride alignment (seconds)
  },
} as const;

/** Player leg proportions scaled from the 1.80 m reference athlete. */
export function getPlayerLegDimensions(heightCm: number) {
  const scale = Math.max(0.75, Math.min(1.25, heightCm / 180));
  const collision = SIM_CONFIG.COLLISION;
  return {
    scale,
    hipHeight: collision.HIP_HEIGHT * scale,
    hipOffsetY: collision.HIP_OFFSET_Y * scale,
    hipTranslationMax: collision.HIP_TRANSLATION_MAX * scale,
    thighLength: collision.THIGH_LEN * scale,
    shinLength: collision.SHIN_LEN * scale,
    thighRadius: collision.THIGH_RADIUS * scale,
    shinRadius: collision.SHIN_RADIUS * scale,
  };
}
