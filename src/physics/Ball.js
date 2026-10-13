import { Vector2 } from '../math/Vector2.js';

/**
 * High-fidelity FIFA Size 5 Football physics model.
 * Incorporates continuous aerodynamic drag (drag crisis), Magnus lateral spin force,
 * turf rolling friction, and 3D bounce restitution in SI metric units.
 */
export class Ball {
  constructor(x = 52.50, y = 34.00) {
    // Spatial coordinates (meters)
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0); // m/s
    this.z = 0.0;                 // Elevation off turf (meters)
    this.vz = 0.0;                // Vertical velocity (m/s)

    // FIFA Size 5 Physical Constants
    this.mass = 0.430;            // kg (430 grams)
    this.radius = 0.110;          // m (11 cm radius / 22 cm diameter)
    this.area = Math.PI * this.radius * this.radius; // 0.03801 m²

    // Spin dynamics
    this.spinZ = 0.0;             // rad/s (lateral spin around vertical Z axis: positive = curving right)
    this.spinDecay = 0.985;       // Spin rate damping per second
    this.backspin = 0.0;          // rad/s (pitch axis backspin: checks up on bounce)

    // Ownership & control state
    this.owner = null;
    this.lastTouch = null;

    // Telemetry tracking
    this.distanceSinceKick = 0.0;
    this.lastKickSpeed = 0.0;
    this.lastKickType = 'NONE';
    this.isRolling = false;
  }

  kick(direction, speedMps, loftMps = 0.0, spinRadPerSec = 0.0, kicker = null, kickType = 'KICK', backspinRadPerSec = 0.0) {
    this.owner = null;
    this.lastTouch = kicker;
    this.distanceSinceKick = 0.0;
    this.lastKickSpeed = speedMps;
    this.lastKickType = kickType;

    const dir = direction.clone().normalize();
    this.vel = dir.multiply(speedMps);
    this.vz = loftMps;
    this.spinZ = spinRadPerSec;
    this.backspin = backspinRadPerSec;
  }

  getDragCoefficient(speed) {
    // Empirical drag crisis curve for modern textured footballs (Brazuca/Al Rihla)
    if (speed < 12.0) {
      return 0.45; // Subcritical laminar boundary layer
    } else if (speed < 18.0) {
      // Critical transition zone (drag drops sharply)
      return 0.45 - (speed - 12.0) * (0.30 / 6.0);
    } else {
      return 0.15; // Supercritical turbulent boundary layer (low drag for high-speed shots)
    }
  }

  update(dt, environment, pitch) {
    // If possessed by a dribbler, positional updates are locked to the player's feet
    if (this.owner) {
      this.z = 0.0;
      this.vz = 0.0;
      this.spinZ = 0.0;
      return;
    }

    const speed = this.vel.magnitude();
    const prevPos = this.pos.clone();

    // 1. Aerodynamic Drag & Wind Interaction
    // v_rel = v - v_wind
    const vRel = Vector2.sub(this.vel, environment.windVector);
    const speedRel = vRel.magnitude();

    if (speedRel > 0.01) {
      const cd = this.getDragCoefficient(speedRel);
      // F_drag = 0.5 * Cd * rho * A * v_rel²
      // a_drag = F_drag / m
      const dragMag = (0.5 * cd * environment.airDensity * this.area * speedRel * speedRel) / this.mass;
      const dragAcc = vRel.clone().normalize().multiply(-dragMag);

      this.vel.x += dragAcc.x * dt;
      this.vel.y += dragAcc.y * dt;
    }

    // 2. Lateral Magnus Spin Force (Curling shots and crosses)
    if (Math.abs(this.spinZ) > 0.5 && speedRel > 1.0) {
      // Spin parameter: S_p = (omega * r) / v_rel
      const spinParam = (Math.abs(this.spinZ) * this.radius) / speedRel;
      // Lift coefficient CL approx 1.2 * Sp (capped at 0.32)
      const cL = Math.min(0.32, 1.2 * spinParam);
      // Magnus acceleration magnitude
      const magnusMag = (0.5 * cL * environment.airDensity * this.area * speedRel * speedRel) / this.mass;

      // Force direction is perpendicular to relative velocity: [-v_y, v_x] * sign(spin)
      const perpDir = new Vector2(-vRel.y, vRel.x).normalize();
      const magnusAcc = perpDir.multiply(magnusMag * Math.sign(this.spinZ));

      this.vel.x += magnusAcc.x * dt;
      this.vel.y += magnusAcc.y * dt;

      // Damp spin gradually
      this.spinZ *= Math.pow(this.spinDecay, dt * 60);
    } else {
      this.spinZ = 0.0;
    }

    // 3. Vertical Dynamics & Gravitational Free-fall
    if (this.z > 0.0 || this.vz > 0.0) {
      this.z += this.vz * dt;
      this.vz -= environment.gravity * dt;

      // Vertical air resistance
      if (Math.abs(this.vz) > 0.1) {
        const cdZ = this.getDragCoefficient(Math.abs(this.vz));
        const dragZ = (0.5 * cdZ * environment.airDensity * this.area * this.vz * Math.abs(this.vz)) / this.mass;
        this.vz -= dragZ * dt;
      }

      // Ground impact & bounce
      if (this.z <= 0.0) {
        this.z = 0.0;
        if (Math.abs(this.vz) > 0.6) {
          const horizSpeed = this.vel.magnitude();
          const impactAngle = Math.atan2(Math.abs(this.vz), Math.max(0.1, horizSpeed));
          // Shallow grazing skips retain ~95-98% forward momentum; steep high drops absorb more
          let skidRetention = 1.0 - (1.0 - environment.tangentialRestitution) * Math.sin(impactAngle);

          // Backspin traction bite on landing turf: checks up the ball!
          if (Math.abs(this.backspin) > 1.0) {
            const checkUpFactor = Math.max(0.20, 1.0 - Math.abs(this.backspin) * 0.012);
            skidRetention *= checkUpFactor;
            this.backspin *= 0.35; // Dissipate backspin on turf friction
          }

          this.vel.multiply(skidRetention);
          this.vz = -this.vz * environment.restitutionZ;
        } else {
          this.vz = 0.0; // Ball settles flat onto the turf
          this.backspin = 0.0;
        }
      }
      this.isRolling = false;
    } else {
      // 4. Ground Rolling Resistance (when ball is rolling flat on grass)
      this.z = 0.0;
      this.vz = 0.0;

      const rollDecel = environment.getRollingDeceleration(); // a_r = mu_r * g
      const currentSpeed = this.vel.magnitude();

      if (currentSpeed > 0.001) {
        this.isRolling = true;
        const newSpeed = currentSpeed - rollDecel * dt;

        if (newSpeed <= 0) {
          this.vel.set(0, 0);
          this.isRolling = false;
        } else {
          this.vel.multiply(newSpeed / currentSpeed);
        }
      } else {
        this.vel.set(0, 0);
        this.isRolling = false;
      }
    }

    // 5. Update 2D Position
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Accumulate distance rolled/traveled since kick
    const frameDist = this.pos.dist(prevPos);
    this.distanceSinceKick += frameDist;

    // 6. Goalpost Collision Check
    this.checkPostCollisions(pitch);
  }

  checkPostCollisions(pitch) {
    const allPosts = [...pitch.leftPosts, ...pitch.rightPosts];
    const postRadius = pitch.postDiameter / 2;
    const combinedRadius = this.radius + postRadius;

    for (const post of allPosts) {
      const dist = this.pos.dist(post);
      if (dist < combinedRadius && dist > 1e-4) {
        // Elastic rebound off cylindrical post
        const normal = Vector2.sub(this.pos, post).normalize();
        // Separate from overlap
        this.pos = Vector2.add(post, Vector2.multiply(normal, combinedRadius + 0.01));

        // Reflect velocity vector: v' = v - 2(v . n)n * e_post
        const ePost = 0.75;
        const dot = this.vel.dot(normal);
        if (dot < 0) {
          const reflect = Vector2.sub(this.vel, Vector2.multiply(normal, (1 + ePost) * dot));
          this.vel = reflect;
        }
      }
    }
  }

  reset(x = 52.50, y = 34.00) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.z = 0.0;
    this.vz = 0.0;
    this.spinZ = 0.0;
    this.backspin = 0.0;
    this.owner = null;
    this.lastTouch = null;
    this.distanceSinceKick = 0.0;
    this.lastKickSpeed = 0.0;
    this.lastKickType = 'RESET';
    this.isRolling = false;
  }
}
