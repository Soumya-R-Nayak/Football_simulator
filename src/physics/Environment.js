import { Vector2 } from '../math/Vector2.js';

/**
 * Environmental parameters: air density, turf conditions (cut height, wetness, rolling friction),
 * and dynamic wind vectors. All values in SI units.
 */
export class Environment {
  constructor(options = {}) {
    // Standard atmosphere
    this.gravity = 9.81; // m/s²
    this.airDensity = 1.225; // kg/m³

    // Turf properties
    this.turfType = options.turfType || 'DRY'; // 'DRY' | 'WET' | 'LONG'
    this.cutLengthMm = 24; // mm

    // Wind dynamics
    this.baseWindSpeed = options.windSpeed || 0; // m/s
    this.windAngle = options.windAngle || 0; // radians (0 = pointing right)
    this.gustStrength = options.gustStrength || 0; // m/s variation
    this.windVector = new Vector2(0, 0);

    this.elapsedTime = 0;
    this.updateTurfProperties();
    this.updateWind(0);
  }

  setTurf(type) {
    this.turfType = type;
    this.updateTurfProperties();
  }

  toggleTurf() {
    if (this.turfType === 'DRY') {
      this.setTurf('WET');
    } else if (this.turfType === 'WET') {
      this.setTurf('LONG');
    } else {
      this.setTurf('DRY');
    }
    return this.turfType;
  }

  updateTurfProperties() {
    switch (this.turfType) {
      case 'WET':
        this.cutLengthMm = 22;
        this.rollingResistance = 0.075; // FIFA fast pitch standard: ball skims with lower friction
        this.restitutionZ = 0.52;      // Saturated ground absorbs more vertical energy
        this.tangentialRestitution = 0.85; // Less surface grip -> ball skids forward
        break;
      case 'LONG':
        this.cutLengthMm = 32;
        this.rollingResistance = 0.180; // Heavy drag, ball slows down quickly
        this.restitutionZ = 0.64;
        this.tangentialRestitution = 0.65;
        break;
      case 'DRY':
      default:
        this.cutLengthMm = 24;
        this.rollingResistance = 0.110; // FIFA standard dry manicured pitch (roll decel ~ 1.08 m/s²)
        this.restitutionZ = 0.60;
        this.tangentialRestitution = 0.72;
        break;
    }
  }

  setWind(speed, angleRadians) {
    this.baseWindSpeed = speed;
    this.windAngle = angleRadians;
    this.updateWind(0);
  }

  updateWind(dt) {
    this.elapsedTime += dt;
    // Low-frequency gust modulation
    const gust = Math.sin(this.elapsedTime * 0.8) * Math.cos(this.elapsedTime * 1.3) * this.gustStrength;
    const currentSpeed = Math.max(0, this.baseWindSpeed + gust);
    this.windVector = Vector2.fromAngle(this.windAngle, currentSpeed);
  }

  getRollingDeceleration() {
    // a_roll = mu_r * g (m/s²)
    return this.rollingResistance * this.gravity;
  }
}
