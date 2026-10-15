import { Vector2 } from '../math/Vector2.js';

/**
 * Training Obstacle & Slalom Cone Course System.
 * Simulates physical rubber training cones with elastic player/ball collisions,
 * deflection physics, and configurable drill layouts (Slalom, Zigzag, Box Agility).
 */
export class TrainingCourse {
  constructor() {
    this.active = false;
    this.mode = 'SLALOM'; // 'SLALOM' | 'ZIGZAG' | 'BOX'
    this.cones = [];
    this.lastClippedCone = null;
    this.clipCooldown = 0.0;

    this.buildCourse(this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    this.buildCourse(mode);
  }

  toggle() {
    this.active = !this.active;
    return this.active;
  }

  buildCourse(mode) {
    this.cones = [];
    const coneRadius = 0.18; // 18cm base radius

    if (mode === 'SLALOM') {
      // 8 cones spaced 2.5m apart in a straight slalom weave corridor
      const startX = 43.5;
      const centerY = 34.0;
      const spacing = 2.5;
      for (let i = 0; i < 8; i++) {
        this.cones.push({
          id: i + 1,
          pos: new Vector2(startX + i * spacing, centerY),
          radius: coneRadius,
          hitTimer: 0.0,
          wobbleOffset: new Vector2(0, 0)
        });
      }
    } else if (mode === 'ZIGZAG') {
      // 6 cones in an aggressive alternating plant-and-cut zigzag corridor
      const points = [
        { x: 44.0, y: 32.0 },
        { x: 48.0, y: 36.0 },
        { x: 52.0, y: 32.0 },
        { x: 56.0, y: 36.0 },
        { x: 60.0, y: 32.0 },
        { x: 64.0, y: 36.0 }
      ];
      points.forEach((pt, idx) => {
        this.cones.push({
          id: idx + 1,
          pos: new Vector2(pt.x, pt.y),
          radius: coneRadius,
          hitTimer: 0.0,
          wobbleOffset: new Vector2(0, 0)
        });
      });
    } else if (mode === 'BOX') {
      // 4-Corner Agility Box + Center Pivot Cone
      const boxPoints = [
        { x: 47.0, y: 30.5 },
        { x: 57.0, y: 30.5 },
        { x: 57.0, y: 37.5 },
        { x: 47.0, y: 37.5 },
        { x: 52.0, y: 34.0 } // Center cone
      ];
      boxPoints.forEach((pt, idx) => {
        this.cones.push({
          id: idx + 1,
          pos: new Vector2(pt.x, pt.y),
          radius: coneRadius,
          hitTimer: 0.0,
          wobbleOffset: new Vector2(0, 0)
        });
      });
    }
  }

  getStartPlacement() {
    if (this.cones.length === 0) {
      return { playerPos: new Vector2(40.0, 34.0), ballPos: new Vector2(40.5, 34.0), heading: 0.0 };
    }
    const firstCone = this.cones[0].pos;
    return {
      playerPos: new Vector2(firstCone.x - 2.8, firstCone.y),
      ballPos: new Vector2(firstCone.x - 2.2, firstCone.y),
      heading: 0.0 // Facing East towards the drill
    };
  }

  resetDrill(player, ball) {
    const start = this.getStartPlacement();
    player.pos.set(start.playerPos.x, start.playerPos.y);
    player.vel.set(0, 0);
    player.heading = start.heading;
    player.faceLockHeading = start.heading;
    player.kickCooldown = 0.0;
    if (player.dribble) player.dribble.touchCooldown = 0.0;

    ball.pos.set(start.ballPos.x, start.ballPos.y);
    ball.vel.set(0, 0);
    ball.z = 0.0;
    ball.vz = 0.0;
    ball.owner = null;
    ball.lastTouch = player;

    player.notifyAction(`🚩 DRILL RESET (${this.mode})`, '#f97316', 0.85);
  }

  update(dt, player, ball) {
    if (!this.active || this.cones.length === 0) return;

    if (this.clipCooldown > 0) {
      this.clipCooldown -= dt;
    }

    const pRadius = player.locomotion.radius; // 0.35m
    const bRadius = ball.radius; // 0.11m

    for (const cone of this.cones) {
      if (cone.hitTimer > 0) {
        cone.hitTimer -= dt;
        const wobbleMag = Math.sin(cone.hitTimer * 30.0) * (cone.hitTimer * 0.06);
        cone.wobbleOffset.set(wobbleMag, 0);
        if (cone.hitTimer <= 0) {
          cone.wobbleOffset.set(0, 0);
        }
      }

      // 1. Player-Cone Physical Collision
      const pDiff = Vector2.subtract(player.pos, cone.pos);
      const pDist = pDiff.magnitude();
      const pMinDist = pRadius + cone.radius; // ~0.53m

      if (pDist < pMinDist && pDist > 0.001) {
        const norm = pDiff.clone().normalize();
        const overlap = pMinDist - pDist;
        // Resolve overlap
        player.pos.add(Vector2.multiply(norm, overlap));

        // Normal velocity damping (brush penalty)
        const vDotN = player.vel.dot(norm);
        if (vDotN < 0) {
          player.vel.sub(Vector2.multiply(norm, vDotN * 0.75));
        }

        cone.hitTimer = 0.35;
        if (this.clipCooldown <= 0 && player.vel.magnitude() > 2.0) {
          player.notifyAction('⚠️ CONE CLIPPED', '#f97316', 0.50);
          this.clipCooldown = 0.60;
        }
      }

      // 2. Ball-Cone Elastic Collision (only when ball is low on turf)
      if (ball.z < 0.30) {
        const bDiff = Vector2.subtract(ball.pos, cone.pos);
        const bDist = bDiff.magnitude();
        const bMinDist = bRadius + cone.radius; // ~0.29m

        if (bDist < bMinDist && bDist > 0.001) {
          const norm = bDiff.clone().normalize();
          const overlap = bMinDist - bDist;
          ball.pos.add(Vector2.multiply(norm, overlap));

          const vDotN = ball.vel.dot(norm);
          if (vDotN < 0) {
            // Elastic deflection (e = 0.68)
            const restitution = 0.68;
            ball.vel.sub(Vector2.multiply(norm, (1.0 + restitution) * vDotN));
            cone.hitTimer = 0.35;
          }
        }
      }
    }
  }
}
