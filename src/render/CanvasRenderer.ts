import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { ContactBody } from '../sim/collision/ContactBody';
import { poseAt } from '../sim/collision/LegKinematics';
import { SIM_CONFIG } from '../sim/config';
import { PitchSurface } from '../sim/physics/PitchSurface';
import {
  BALL_PRESETS,
  BallState,
  Intent,
  PlayerState,
  StudType,
  TurfCondition,
} from '../sim/types';

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  layer: 0 | 1;
}

interface GroundSplash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface GroundRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  alpha: number;
}

/**
 * Top-Down Canvas Pitch & Player Locomotion Renderer with Tick Interpolation.
 */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pixelsPerMeter: number = 28; // Default 28 px/m (zoomable from 16 to 64 px/m)
  private cameraPos: Vector2 = Vector2.zero();

  // 3D Aerodynamic Ball Visualization
  private ballVisualYaw: number = 0;
  private ballVisualPitch: number = 0;
  private readonly ballTrail: { x: number; y: number; z: number; visualY: number; time: number }[] = [];
  private lastBallRenderTime: number = performance.now() / 1000;

  // Atmospheric Rain Simulation
  private readonly rainDrops: RainDrop[] = [];
  private lastRenderTime: number = performance.now() / 1000;

  // Wet Pitch Dynamic Splashes & Ground Ripples
  private readonly groundSplashes: GroundSplash[] = [];
  private readonly groundRipples: GroundRipple[] = [];
  private lastPlantedFoot: string | null = null;
  private lastBallBounceTime: number = 0;

  // Physical 3D Collider Debug Wireframe
  private showColliders: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    this.ctx = ctx;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();

    // Smooth mouse wheel zoom control
    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        this.pixelsPerMeter = Math.max(16, Math.min(64, this.pixelsPerMeter * factor));
      },
      { passive: true }
    );
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  screenToWorld(screenX: number, screenY: number): Vector2 {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const worldX = (screenX - w / 2) / this.pixelsPerMeter + this.cameraPos.x;
    const worldY = (screenY - h / 2) / this.pixelsPerMeter + this.cameraPos.y;
    return new Vector2(worldX, worldY);
  }

  render(
    prevState: PlayerState,
    currState: PlayerState,
    alpha: number,
    intent: Intent,
    prevBall?: BallState,
    currBall?: BallState,
    pitchSurface?: PitchSurface,
    contactBodies?: readonly ContactBody[],
    lastContactMarker?: { point: Vector3; normal: Vector3; zone: string; impulse: Vector3; time: number } | null
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const now = performance.now() / 1000;
    const renderDt = Math.min(0.05, Math.max(0.001, now - this.lastRenderTime));
    this.lastRenderTime = now;

    // Soft leash camera tracking allowing discrete body surges and sway to be visible relative to screen
    const interpPos = prevState.position.lerp(currState.position, alpha);
    const toPlayer = interpPos.sub(this.cameraPos);
    const dist = toPlayer.length();
    const deadzone = 0.45; // 45 cm soft window
    if (dist > deadzone) {
      const excess = dist - deadzone;
      const targetCam = this.cameraPos.add(toPlayer.normalize().scale(excess));
      this.cameraPos = this.cameraPos.lerp(targetCam, 0.08);
    } else {
      this.cameraPos = this.cameraPos.lerp(interpPos, 0.02);
    }

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    // Center camera on screen
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.pixelsPerMeter, this.pixelsPerMeter);
    ctx.translate(-this.cameraPos.x, -this.cameraPos.y);

    const grassHeight = pitchSurface ? pitchSurface.getGrassHeight() : 24;
    this.drawPitch(currBall?.turfCondition, grassHeight);
    if (pitchSurface) {
      this.drawPitchDamage(pitchSurface);
    }

    // Footstep splash trigger on wet turf during stance phase
    if (currState.stride.phase === 'stance') {
      const currentFoot = currState.stride.currentFoot;
      if (this.lastPlantedFoot !== currentFoot) {
        this.lastPlantedFoot = currentFoot;
        const footPos =
          currentFoot === 'left' ? currState.stride.leftFootPos : currState.stride.rightFootPos;
        const localMoisture = pitchSurface ? pitchSurface.getMoistureAt(footPos.x, footPos.y) : 0.25;
        if (localMoisture >= 0.35) {
          this.spawnFootstepSplash(footPos, currState.velocity, localMoisture);
        }
      }
    } else {
      this.lastPlantedFoot = null;
    }

    // Dynamic ground effects (expanding ripples & turf splash droplets)
    this.updateAndDrawGroundEffects(renderDt);

    if (prevBall && currBall) {
      const interpBallPos = prevBall.position.lerp(currBall.position, alpha);
      const interpBallVel = prevBall.velocity.lerp(currBall.velocity, alpha);
      const interpBallSpin = prevBall.spin.lerp(currBall.spin, alpha);

      const ballRadius = BALL_PRESETS[currBall.modelId]?.radius ?? SIM_CONFIG.BALL.RADIUS;
      const alt = Math.max(0, interpBallPos.z - ballRadius);
      const perspectiveFactor = 0.65;
      const visualX = interpBallPos.x;
      const visualY = interpBallPos.y - alt * perspectiveFactor;

      const dt = Math.min(0.05, Math.max(0.001, now - this.lastBallRenderTime));
      this.lastBallRenderTime = now;

      // Rotate visual yaw and pitch
      this.ballVisualYaw += interpBallSpin.z * dt;
      const groundSpeed = Math.hypot(interpBallVel.x, interpBallVel.y);
      if (alt < 0.02 && groundSpeed > 0.05) {
        this.ballVisualPitch += (groundSpeed / ballRadius) * dt;
      } else {
        const flightSpinRate = Math.hypot(interpBallSpin.x, interpBallSpin.y);
        this.ballVisualPitch += flightSpinRate * dt;
      }

      // Detect ball ground bounce impact on wet turf
      const prevAlt = Math.max(0, prevBall.position.z - ballRadius);
      const currAlt = Math.max(0, currBall.position.z - ballRadius);
      if (prevAlt > 0.015 && currAlt <= 0.015 && Math.abs(prevBall.velocity.z) > 0.8) {
        if (now - this.lastBallBounceTime > 0.08) {
          this.lastBallBounceTime = now;
          const localMoisture = pitchSurface
            ? pitchSurface.getMoistureAt(currBall.position.x, currBall.position.y)
            : 0.25;
          if (localMoisture >= 0.35) {
            this.spawnBallImpactSplash(currBall.position, currBall.velocity, localMoisture);
          }
        }
      } else if (currAlt <= 0.02 && groundSpeed > 2.5) {
        const localMoisture = pitchSurface
          ? pitchSurface.getMoistureAt(currBall.position.x, currBall.position.y)
          : 0.25;
        if (localMoisture >= 0.38) {
          this.spawnBallRollWake(currBall.position, currBall.velocity, localMoisture);
        }
      }

      // Record trail if airborne or moving fast
      if (alt > 0.05 || interpBallVel.length() > 5.0) {
        this.ballTrail.push({
          x: interpBallPos.x,
          y: interpBallPos.y,
          z: interpBallPos.z,
          visualY,
          time: now,
        });
      }
      while (
        this.ballTrail.length > 50 ||
        (this.ballTrail.length > 0 && now - this.ballTrail[0].time > 1.2)
      ) {
        this.ballTrail.shift();
      }

      this.drawBallTrail();
      this.drawBallShadow(interpBallPos.x, interpBallPos.y, alt, ballRadius);

      // Add high-frequency knuckle wobble jitter if ball is in knuckling regime
      const knuckleJitterX = currBall.isKnuckling ? (Math.random() - 0.5) * 0.03 : 0;
      const knuckleJitterY = currBall.isKnuckling ? (Math.random() - 0.5) * 0.03 : 0;

      // Depth sorting with player
      const playerY = interpPos.y;
      if (visualY < playerY && alt < 0.25) {
        this.drawBall(visualX + knuckleJitterX, visualY + knuckleJitterY, alt, currBall);
        this.drawPlayer(prevState, currState, alpha, intent, pitchSurface);
      } else {
        this.drawPlayer(prevState, currState, alpha, intent, pitchSurface);
        this.drawBall(visualX + knuckleJitterX, visualY + knuckleJitterY, alt, currBall);
      }
    } else {
      this.drawPlayer(prevState, currState, alpha, intent, pitchSurface);
    }

    if (contactBodies && this.showColliders) {
      this.drawColliders(contactBodies, lastContactMarker);
    }

    ctx.restore();

    // Atmospheric dynamic rain overlay (screen-space)
    this.updateAndDrawRain(renderDt, pitchSurface, currBall);
  }

  private modulateColor(hex: string, factor: number): string {
    const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
    const num = parseInt(cleanHex, 16);
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;

    r = Math.max(0, Math.min(255, Math.round(r * (1 + factor))));
    g = Math.max(0, Math.min(255, Math.round(g * (1 + factor))));
    b = Math.max(0, Math.min(255, Math.round(b * (1 + factor))));

    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  private drawPitch(turf?: TurfCondition, grassHeightMm: number = 24): void {
    const ctx = this.ctx;
    const halfL = SIM_CONFIG.PITCH.LENGTH / 2;
    const halfW = SIM_CONFIG.PITCH.WIDTH / 2;

    let grassBase = '#16431b';
    let grassStripe = '#184b1e';
    if (turf === 'wet_slick') {
      grassBase = '#0d2d12';
      grassStripe = '#0f3516';
    } else if (turf === 'dry_heavy') {
      grassBase = '#234a21';
      grassStripe = '#275225';
    }

    // Grass Height Color Tone Modulation:
    // Short grass (< 22mm) is crisper emerald green; tall grass (> 26mm) is deep dense dark green
    const heightFactor = (grassHeightMm - 24.0) / 12.0; // [-0.5, +1.0]
    if (heightFactor > 0.05) {
      grassBase = this.modulateColor(grassBase, -0.16 * heightFactor);
      grassStripe = this.modulateColor(grassStripe, -0.16 * heightFactor);
    } else if (heightFactor < -0.05) {
      grassBase = this.modulateColor(grassBase, 0.16 * Math.abs(heightFactor));
      grassStripe = this.modulateColor(grassStripe, 0.16 * Math.abs(heightFactor));
    }

    // Pitch grass base
    ctx.fillStyle = grassBase;
    ctx.fillRect(
      -halfL - SIM_CONFIG.PITCH.BOUNDARY_MARGIN,
      -halfW - SIM_CONFIG.PITCH.BOUNDARY_MARGIN,
      SIM_CONFIG.PITCH.LENGTH + SIM_CONFIG.PITCH.BOUNDARY_MARGIN * 2,
      SIM_CONFIG.PITCH.WIDTH + SIM_CONFIG.PITCH.BOUNDARY_MARGIN * 2
    );

    // Mown grass stripes
    ctx.fillStyle = grassStripe;
    const stripeWidth = 5.25; // 20 stripes across 105m
    for (let x = -halfL; x < halfL; x += stripeWidth * 2) {
      ctx.fillRect(x, -halfW, stripeWidth, SIM_CONFIG.PITCH.WIDTH);
    }

    // Line markings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 0.12; // 12 cm regulation line width

    // Boundary touchlines & goal lines
    ctx.strokeRect(-halfL, -halfW, SIM_CONFIG.PITCH.LENGTH, SIM_CONFIG.PITCH.WIDTH);

    // Halfway line
    ctx.beginPath();
    ctx.moveTo(0, -halfW);
    ctx.lineTo(0, halfW);
    ctx.stroke();

    // Center circle (r = 9.15m) & Center spot
    ctx.beginPath();
    ctx.arc(0, 0, 9.15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
    ctx.fill();

    // Penalty Areas (16.5m depth, 40.32m width)
    const penW = 40.32;
    const penD = 16.5;
    // Left Penalty Box
    ctx.strokeRect(-halfL, -penW / 2, penD, penW);
    // Right Penalty Box
    ctx.strokeRect(halfL - penD, -penW / 2, penD, penW);

    // Goal Areas (5.5m depth, 18.32m width)
    const goalW = 18.32;
    const goalD = 5.5;
    ctx.strokeRect(-halfL, -goalW / 2, goalD, goalW);
    ctx.strokeRect(halfL - goalD, -goalW / 2, goalD, goalW);

    // Penalty spots (11m from goal line)
    ctx.beginPath();
    ctx.arc(-halfL + 11.0, 0, 0.18, 0, Math.PI * 2);
    ctx.arc(halfL - 11.0, 0, 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPitchDamage(pitchSurface: PitchSurface): void {
    const ctx = this.ctx;
    const wearGrid = pitchSurface.getWearGrid();
    const dims = pitchSurface.getGridDimensions();

    const visibleHalfW = this.canvas.width / 2 / this.pixelsPerMeter + 2;
    const visibleHalfH = this.canvas.height / 2 / this.pixelsPerMeter + 2;

    const minC = Math.max(0, Math.floor((this.cameraPos.x - visibleHalfW - dims.minX) / dims.cellSize));
    const maxC = Math.min(dims.cols - 1, Math.floor((this.cameraPos.x + visibleHalfW - dims.minX) / dims.cellSize));
    const minR = Math.max(0, Math.floor((this.cameraPos.y - visibleHalfH - dims.minY) / dims.cellSize));
    const maxR = Math.min(dims.rows - 1, Math.floor((this.cameraPos.y + visibleHalfH - dims.minY) / dims.cellSize));

    // 1. Draw spatial wear patches in visible view frustum
    for (let r = minR; r <= maxR; r++) {
      const cy = dims.minY + r * dims.cellSize;
      for (let c = minC; c <= maxC; c++) {
        const wear = wearGrid[r * dims.cols + c];
        if (wear > 0.015) {
          const cx = dims.minX + c * dims.cellSize;
          // Smooth alpha: subtle grass thinning at 0.02, clear soil wear above 0.12
          const alpha = Math.min(0.85, Math.pow(wear, 0.70) * 0.72);
          ctx.fillStyle = `rgba(52, 38, 20, ${alpha.toFixed(2)})`;
          ctx.fillRect(cx, cy, dims.cellSize + 0.04, dims.cellSize + 0.04);
        }
      }
    }

    // 2. Standing water puddles (deferred for future implementations per user request)
    // The pitch maintains clean, uniform grass rendering with dynamic rain and splashes
    /*
    const puddles = pitchSurface.getPuddles();
    for (let i = 0; i < puddles.length; i++) {
      const p = puddles[i];
      if (
        Math.abs(p.center.x - this.cameraPos.x) > visibleHalfW + p.radius ||
        Math.abs(p.center.y - this.cameraPos.y) > visibleHalfH + p.radius
      ) {
        continue;
      }

      ctx.save();
      const grad = ctx.createRadialGradient(
        p.center.x,
        p.center.y,
        p.radius * 0.15,
        p.center.x,
        p.center.y,
        p.radius
      );
      grad.addColorStop(0, 'rgba(28, 62, 82, 0.65)');
      grad.addColorStop(0.7, 'rgba(20, 48, 64, 0.40)');
      grad.addColorStop(1.0, 'rgba(15, 36, 48, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.center.x, p.center.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
      ctx.beginPath();
      ctx.ellipse(
        p.center.x - p.radius * 0.2,
        p.center.y - p.radius * 0.2,
        p.radius * 0.42,
        p.radius * 0.22,
        -0.35,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }
    */

    // 3. Draw cleat ruts (continuous furrow trenches & hydrodynamic water wakes)
    const ruts = pitchSurface.getRuts();
    for (let i = 0; i < ruts.length; i++) {
      const rut = ruts[i];
      const dx = rut.endPos.x - rut.startPos.x;
      const dy = rut.endPos.y - rut.startPos.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.08) continue;

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      const isWater = rut.isWaterlogged || pitchSurface.getMoistureAt(rut.startPos.x, rut.startPos.y) >= 0.70;

      ctx.save();
      ctx.lineCap = 'round';

      if (isWater) {
        // Hydrodynamic Water Wake in Puddles (fluid surface disturbance)
        // Soft water displacement depression
        ctx.strokeStyle = 'rgba(16, 40, 56, 0.38)';
        ctx.lineWidth = rut.width * 1.1;
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x, rut.startPos.y);
        ctx.lineTo(rut.endPos.x, rut.endPos.y);
        ctx.stroke();

        // Sky sheen highlight along center of wake
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.30)';
        ctx.lineWidth = rut.width * 0.45;
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x + ux * 0.05, rut.startPos.y + uy * 0.05);
        ctx.lineTo(rut.endPos.x - ux * 0.05, rut.endPos.y - uy * 0.05);
        ctx.stroke();

        // Subtle lateral wake ripple edges
        ctx.strokeStyle = 'rgba(215, 240, 255, 0.18)';
        ctx.lineWidth = 0.03;
        for (let s = 0.2; s <= 0.8; s += 0.3) {
          const mx = rut.startPos.x + dx * s;
          const my = rut.startPos.y + dy * s;
          ctx.beginPath();
          ctx.arc(mx, my, rut.width * 0.7, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // Authentic Cleat Furrow on Natural Turf
        // A. Outer displaced turf & soil halo (tapered)
        ctx.strokeStyle = 'rgba(48, 34, 18, 0.38)';
        ctx.lineWidth = rut.width * 1.15;
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x, rut.startPos.y);
        ctx.lineTo(rut.endPos.x, rut.endPos.y);
        ctx.stroke();

        // B. Deep central soil scrape (subsoil exposure)
        ctx.strokeStyle = 'rgba(26, 15, 6, 0.68)';
        ctx.lineWidth = rut.width * 0.52;
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x + ux * 0.08, rut.startPos.y + uy * 0.08);
        ctx.lineTo(rut.endPos.x - ux * 0.08, rut.endPos.y - uy * 0.08);
        ctx.stroke();

        // C. Dual cleat stud incisions (parallel lines gouged by left & right cleat studs)
        const studSpacing = 0.042; // ~8.4 cm stud span
        ctx.strokeStyle = 'rgba(18, 10, 4, 0.82)';
        ctx.lineWidth = 0.035;

        // Left stud groove
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x + nx * studSpacing + ux * 0.04, rut.startPos.y + ny * studSpacing + uy * 0.04);
        ctx.lineTo(rut.endPos.x + nx * studSpacing - ux * 0.04, rut.endPos.y + ny * studSpacing - uy * 0.04);
        ctx.stroke();

        // Right stud groove
        ctx.beginPath();
        ctx.moveTo(rut.startPos.x - nx * studSpacing + ux * 0.04, rut.startPos.y - ny * studSpacing + uy * 0.04);
        ctx.lineTo(rut.endPos.x - nx * studSpacing - ux * 0.04, rut.endPos.y - ny * studSpacing - uy * 0.04);
        ctx.stroke();

        // D. Displaced green-brown turf flecks along rut boundary
        ctx.fillStyle = 'rgba(22, 52, 20, 0.75)';
        for (let s = 0.15; s <= 0.85; s += 0.22) {
          const px = rut.startPos.x + dx * s + nx * (rut.width * 0.55);
          const py = rut.startPos.y + dy * s + ny * (rut.width * 0.55);
          ctx.beginPath();
          ctx.arc(px, py, 0.024, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    // 4. Draw divots (exposed soil scars & torn turf flecks)
    const divots = pitchSurface.getDivots();
    for (let i = 0; i < divots.length; i++) {
      const d = divots[i];
      if (
        Math.abs(d.position.x - this.cameraPos.x) > visibleHalfW ||
        Math.abs(d.position.y - this.cameraPos.y) > visibleHalfH
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(d.position.x, d.position.y);
      ctx.rotate(d.heading);

      // Dark moist soil core (elongated along shear vector)
      ctx.fillStyle = '#221406';
      ctx.beginPath();
      ctx.ellipse(0, 0, d.radius, d.radius * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Disturbed subsoil outer rim
      ctx.strokeStyle = 'rgba(78, 56, 30, 0.75)';
      ctx.lineWidth = 0.018;
      ctx.stroke();

      // Torn turf flecks along shear angle
      ctx.fillStyle = '#1c4a1f';
      ctx.beginPath();
      ctx.arc(d.radius * 0.85, -0.015, 0.018, 0, Math.PI * 2);
      ctx.arc(d.radius * 0.95, 0.015, 0.015, 0, Math.PI * 2);
      ctx.arc(-d.radius * 0.45, 0.02, 0.012, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private drawPlayer(
    prevState: PlayerState,
    currState: PlayerState,
    alpha: number,
    intent: Intent,
    pitchSurface?: PitchSurface
  ): void {
    const ctx = this.ctx;

    // Interpolated center of mass and facing angle
    const pos = prevState.position.lerp(currState.position, alpha);
    const interpFacing = this.interpolateAngle(prevState.facing, currState.facing, alpha);
    const interpVel = prevState.velocity.lerp(currState.velocity, alpha);

    // Use reachable ankle positions from the same articulated pose used for
    // collisions. Raw stride targets can temporarily exceed leg reach.
    const legPoses = poseAt(prevState, currState, alpha, SIM_CONFIG.LOOP.FIXED_DT);
    const leftFoot = new Vector2(legPoses.left.ankle.x, legPoses.left.ankle.y);
    const rightFoot = new Vector2(legPoses.right.ankle.x, legPoses.right.ankle.y);
    const bodyScale = Math.max(0.82, Math.min(1.18, currState.attributes.heightCm / 180));

    const isSliding =
      currState.slipStatus.type === 'controlled_slide' || currState.slipStatus.type === 'wipeout';
    const localMoisture = pitchSurface ? pitchSurface.getMoistureAt(pos.x, pos.y) : 0.25;
    const isWet = localMoisture > 0.40;
    const now = performance.now() / 1000;

    // 1. Draw Skid Marks on Turf if sliding, wiping out, or stumbling
    if (currState.slipStatus.type === 'controlled_slide') {
      ctx.save();
      const speed = currState.velocity.length();
      const skidDir =
        speed > 0.1
          ? currState.velocity.normalize()
          : Vector2.fromAngle(interpFacing);
      const skidNorm = new Vector2(-skidDir.y, skidDir.x);
      const isWaterlogged = localMoisture >= 0.70;
      const slideLen = Math.min(2.4, speed * 0.36);
      const slideStart = pos.sub(skidDir.scale(slideLen));

      if (isWaterlogged) {
        // Hydrodynamic Water Wake in Standing Water
        ctx.lineCap = 'round';
        // Water displacement furrow
        ctx.strokeStyle = 'rgba(16, 42, 60, 0.40)';
        ctx.lineWidth = 0.30;
        ctx.beginPath();
        ctx.moveTo(slideStart.x, slideStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        // Sky sheen highlight core
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.42)';
        ctx.lineWidth = 0.14;
        ctx.beginPath();
        ctx.moveTo(slideStart.x, slideStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else {
        // Natural Turf: Outer softened furrow + dual cleat stud scrape tracks
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(50, 34, 16, 0.38)';
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(slideStart.x, slideStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        // Dual cleat groove lines
        const studSpan = 0.04;
        ctx.strokeStyle = 'rgba(28, 16, 6, 0.75)';
        ctx.lineWidth = 0.032;

        ctx.beginPath();
        ctx.moveTo(slideStart.x + skidNorm.x * studSpan, slideStart.y + skidNorm.y * studSpan);
        ctx.lineTo(pos.x + skidNorm.x * studSpan, pos.y + skidNorm.y * studSpan);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(slideStart.x - skidNorm.x * studSpan, slideStart.y - skidNorm.y * studSpan);
        ctx.lineTo(pos.x - skidNorm.x * studSpan, pos.y - skidNorm.y * studSpan);
        ctx.stroke();
      }

      // Dynamic rooster-tail water / turf spray effect in wet conditions or standing water
      if ((isWet || isWaterlogged) && speed > 1.2) {
        const sprayBack = skidDir.scale(-1);
        const particleCount = Math.min(22, Math.floor(10 + speed * 1.8));

        ctx.fillStyle = isWaterlogged ? 'rgba(224, 242, 254, 0.78)' : 'rgba(215, 240, 255, 0.65)';
        for (let i = 0; i < particleCount; i++) {
          const spreadFactor = (Math.sin(now * 22 + i * 2.7) - 0.5) * 0.75;
          const dist = 0.25 + (i * 0.12) * (speed / 6.5);
          const dropPos = pos.add(sprayBack.scale(dist)).add(skidNorm.scale(spreadFactor));
          const dropR = (0.018 + 0.016 * Math.sin(now * 30 + i * 1.8)) * (isWaterlogged ? 1.3 : 1.0);
          ctx.beginPath();
          ctx.arc(dropPos.x, dropPos.y, Math.max(0.012, dropR), 0, Math.PI * 2);
          ctx.fill();
        }

        // Water foam crest around lead cleat in standing water
        if (isWaterlogged && speed > 2.5) {
          ctx.fillStyle = 'rgba(240, 249, 255, 0.45)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 0.24, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (currState.slipStatus.type === 'wipeout') {
      ctx.save();
      const speed = currState.velocity.length();
      const skidDir =
        speed > 0.1
          ? currState.velocity.normalize()
          : Vector2.fromAngle(interpFacing);
      const skidStart = pos.sub(skidDir.scale(0.85));
      ctx.strokeStyle = 'rgba(48, 30, 16, 0.65)';
      ctx.lineWidth = 0.26;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(skidStart.x, skidStart.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      if (isWet && speed > 1.0) {
        ctx.fillStyle = 'rgba(215, 240, 255, 0.60)';
        for (let i = 0; i < 10; i++) {
          const spread = (Math.sin(now * 16 + i * 3.1) - 0.5) * 0.65;
          const dist = 0.20 + i * 0.13;
          const dropPos = pos.sub(skidDir.scale(dist)).add(new Vector2(-skidDir.y, skidDir.x).scale(spread));
          ctx.beginPath();
          ctx.arc(dropPos.x, dropPos.y, 0.024, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (currState.slipStatus.type === 'micro_slip') {
      ctx.save();
      ctx.strokeStyle = 'rgba(48, 34, 16, 0.55)';
      ctx.lineWidth = 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const skidDir =
        currState.velocity.length() > 0.1
          ? currState.velocity.normalize()
          : Vector2.fromAngle(interpFacing);
      const skidStart = pos.sub(skidDir.scale(0.18));
      ctx.moveTo(skidStart.x, skidStart.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw Cleats on Turf (planted during stance or during walking double-support)
    const isLeftPlanted =
      (currState.stride.phase === 'stance' && currState.stride.currentFoot === 'left') ||
      currState.stride.isDoubleSupport ||
      isSliding;
    const isRightPlanted =
      (currState.stride.phase === 'stance' && currState.stride.currentFoot === 'right') ||
      currState.stride.isDoubleSupport ||
      isSliding;

    const isLeadLeft = currState.slipStatus.slipFoot === 'left' || currState.slipStatus.type === 'wipeout';
    const slideAngle = currState.velocity.length() > 0.1 ? currState.velocity.angle() : interpFacing;

    const leftCleatAngle = isSliding
      ? (isLeadLeft ? slideAngle : slideAngle + 1.25)
      : interpFacing;
    const rightCleatAngle = isSliding
      ? (!isLeadLeft ? slideAngle : slideAngle - 1.25)
      : interpFacing;

    this.drawCleat(
      leftFoot,
      isSliding ? leftCleatAngle : legPoses.left.bootYaw,
      legPoses.left.bootPitch,
      legPoses.left.ankle.z,
      isLeftPlanted,
      currState.studType,
      bodyScale
    );
    this.drawCleat(
      rightFoot,
      isSliding ? rightCleatAngle : legPoses.right.bootYaw,
      legPoses.right.bootPitch,
      legPoses.right.ankle.z,
      isRightPlanted,
      currState.studType,
      bodyScale
    );

    // 3. Draw Torso Body (with dynamic 3D body banking & pelvic yaw rotation)
    const interpHead = prevState.headOffset.lerp(currState.headOffset, alpha);
    const chestLean = interpHead.scale(0.55); // Chest & shoulders lean halfway between hips and head
    const visualHeading = isSliding
      ? (currState.velocity.length() > 0.2 ? currState.velocity.angle() : interpFacing) +
        (currState.slipStatus.slipFoot === 'left' ? 0.22 : -0.22)
      : interpFacing + currState.stride.pelvicAngle;

    // A. Hip shadow on turf (Item 2: Vertical Dynamics & Shadow Breathing)
    const interpBounce = prevState.verticalBounce * (1 - alpha) + currState.verticalBounce * alpha;
    // When airborne (bounce > 0), shadow softens and expands; when in deep stance impact, it shrinks and darkens
    const shadowAlpha = Math.max(0.18, Math.min(0.48, 0.35 - interpBounce * 2.2));
    const shadowRadiusScale = 1.0 + interpBounce * 1.4;
    // Slight shadow parallax lag during flight along opposite of velocity
    const shadowLag = interpVel.scale(-interpBounce * 0.05);
    const shadowPos = pos.add(shadowLag);

    ctx.save();
    ctx.translate(shadowPos.x, shadowPos.y);
    ctx.rotate(visualHeading);
    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(
      0.04,
      0.04,
      SIM_CONFIG.PLAYER_BODY.TORSO_RADIUS * shadowRadiusScale,
      SIM_CONFIG.PLAYER_BODY.TORSO_RADIUS * 0.8 * shadowRadiusScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // B. Upper Torso, Shoulders & Head (displaced by 3D lean)
    const chestPos = pos.add(chestLean);
    ctx.save();
    ctx.translate(chestPos.x, chestPos.y);
    ctx.rotate(visualHeading);
    ctx.scale(bodyScale, bodyScale);

    // Torso athletic trapezoid/V-taper:
    // Shoulder breadth comes from the player dimensions in config.
    const shoulderHalfWidth = SIM_CONFIG.PLAYER_BODY.SHOULDER_WIDTH / 2;
    ctx.fillStyle = '#1e3a8a'; // Deep blue athletic jersey
    ctx.strokeStyle = '#60a5fa'; // Light blue seam piping
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0.19, 0); // Front chest center
    ctx.bezierCurveTo(0.19, 0.12, 0.48 * shoulderHalfWidth, shoulderHalfWidth, -0.10, shoulderHalfWidth);
    ctx.bezierCurveTo(-0.14, shoulderHalfWidth, -shoulderHalfWidth, 0.12, -shoulderHalfWidth, 0);
    ctx.bezierCurveTo(-shoulderHalfWidth, -0.12, -0.14, -shoulderHalfWidth, -0.10, -shoulderHalfWidth);
    ctx.bezierCurveTo(0.48 * shoulderHalfWidth, -shoulderHalfWidth, 0.19, -0.12, 0.19, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Back yoke seam (posterior shoulder accent band)
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 0.015;
    ctx.beginPath();
    ctx.moveTo(-0.09, -0.76 * shoulderHalfWidth);
    ctx.quadraticCurveTo(-0.16, 0, -0.09, 0.76 * shoulderHalfWidth);
    ctx.stroke();

    // Squad Number 10 on the back (Posterior, -X) - readable across shoulders
    ctx.save();
    ctx.translate(-0.14, 0);
    ctx.rotate(Math.PI / 2); // Rotate across shoulders
    ctx.scale(0.01, 0.01);
    ctx.font = '900 20px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.strokeText('10', 0, 0);
    ctx.fillText('10', 0, 0);
    ctx.restore();

    // Front V-Neck Collar Trim (Anterior, +X)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0.07, -0.05);
    ctx.lineTo(0.12, 0); // Points forward into chest
    ctx.lineTo(0.07, 0.05);
    ctx.stroke();

    // Club Crest on Left Breast (+X, -Y)
    ctx.fillStyle = '#fbbf24'; // Golden badge
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.arc(0.09, -0.09, 0.020, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Arm / Shoulder Counter-Pumping (suppressed during sliding)
    const interpShoulder = isSliding
      ? 0
      : prevState.shoulderAngle * (1 - alpha) + currState.shoulderAngle * alpha;
    const armDisplacement = Math.sin(interpShoulder) * 0.12;

    ctx.fillStyle = '#1e40af'; // Athletic sleeve color
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 0.018;

    // Left shoulder sleeve (pumps opposite to right)
    ctx.beginPath();
    ctx.ellipse(
      -armDisplacement,
      -shoulderHalfWidth,
      0.085,
      0.055,
      interpShoulder,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Left Forearm & Hand (skin tone)
    ctx.fillStyle = '#f6d8ae';
    ctx.strokeStyle = '#dfaf7b';
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.ellipse(
      -armDisplacement * 1.3 + 0.04,
      -0.25,
      0.035,
      0.026,
      interpShoulder,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Right shoulder sleeve
    ctx.fillStyle = '#1e40af';
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.ellipse(
      armDisplacement,
      shoulderHalfWidth,
      0.085,
      0.055,
      -interpShoulder,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Right Forearm & Hand (skin tone)
    ctx.fillStyle = '#f6d8ae';
    ctx.strokeStyle = '#dfaf7b';
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.ellipse(
      armDisplacement * 1.3 + 0.04,
      0.25,
      0.035,
      0.026,
      -interpShoulder,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Head circle displaced at top of 3D lean + natural neck forward offset (+0.04m)
    const headRel = interpHead.sub(chestLean);
    const cosHeading = Math.cos(visualHeading);
    const sinHeading = Math.sin(visualHeading);
    const localHeadX = headRel.x * cosHeading + headRel.y * sinHeading + 0.04;
    const localHeadY = -headRel.x * sinHeading + headRel.y * cosHeading;
    const headR = SIM_CONFIG.PLAYER_BODY.HEAD_RADIUS;

    // Item 3: Axial Gaze Precedence (Head turns to look into intended direction ahead of torso)
    const interpHeadYaw = prevState.headYaw * (1 - alpha) + currState.headYaw * alpha;

    ctx.save();
    ctx.translate(localHeadX, localHeadY);
    ctx.rotate(interpHeadYaw);

    // A. Head Base Skin
    ctx.fillStyle = '#f6d8ae';
    ctx.strokeStyle = '#e2b887';
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // B. Athletic Hair (Posterior Arc: covers the back half of the skull, pointing -X)
    ctx.fillStyle = '#1c1917'; // Rich dark hair crop
    ctx.beginPath();
    ctx.arc(0, 0, headR, Math.PI * 0.5, Math.PI * 1.5, false);
    ctx.quadraticCurveTo(0.02, 0, 0, headR);
    ctx.fill();

    // Hair crown fade highlight
    ctx.fillStyle = '#292524';
    ctx.beginPath();
    ctx.arc(-0.035, 0, headR * 0.7, Math.PI * 0.5, Math.PI * 1.5, false);
    ctx.quadraticCurveTo(-0.01, 0, -0.035, headR * 0.7);
    ctx.fill();

    // C. Ears (Midline at Y = +/- headR * 0.95)
    ctx.fillStyle = '#f6d8ae';
    ctx.strokeStyle = '#dfaf7b';
    ctx.lineWidth = 0.008;
    // Left ear
    ctx.beginPath();
    ctx.ellipse(0, -headR * 0.95, 0.025, 0.015, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Right ear
    ctx.beginPath();
    ctx.ellipse(0, headR * 0.95, 0.025, 0.015, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // D. Athletic Rounded Nose (Protruding forward at +X)
    ctx.fillStyle = '#dfaf7b';
    ctx.beginPath();
    ctx.moveTo(headR * 0.75, -0.02);
    ctx.quadraticCurveTo(headR + 0.035, 0, headR * 0.75, 0.02);
    ctx.closePath();
    ctx.fill();

    // Subtle brow bridge highlight
    ctx.strokeStyle = '#e2b887';
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.arc(headR * 0.65, 0, 0.025, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.restore(); // Restore head transform

    ctx.restore(); // Restore upper torso transform

    // 3. Debug Vector Overlay
    this.drawDebugVectors(pos, interpFacing, interpVel, intent);
  }

  private drawCleat(
    pos: Vector2,
    facing: number,
    pitch: number,
    footHeight: number,
    isPlanted: boolean,
    studType: StudType = 'fg_plastic',
    scale: number = 1
  ): void {
    const ctx = this.ctx;

    // In the top-down view, pitch appears as foreshortening and a separated
    // ground shadow. Keep the true pose cues subtle so the boot stays sized
    // consistently with the physical 3D contact shape.
    const pitchClamped = Math.max(-0.55, Math.min(0.55, pitch));
    const pitchProjection = Math.cos(pitchClamped);
    const footLift = Math.max(0, footHeight - SIM_CONFIG.COLLISION.FOOT_STANCE_Z);
    const liftRatio = Math.min(1, footLift / SIM_CONFIG.COLLISION.FOOT_SWING_MAX_Z);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(facing);
    ctx.scale(scale, scale);

    // Soft ground shadow makes toe-up swing and foot clearance readable in
    // the flat field projection without drawing the shoe as an underside disk.
    ctx.fillStyle = `rgba(2, 6, 23, ${0.24 - liftRatio * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(-Math.sin(pitchClamped) * 0.035, 0.018, 0.125 + liftRatio * 0.025, 0.050 + liftRatio * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pitch rotates the foot out of the ground plane; its projected length
    // shortens, while ankle height and the shadow communicate the lift.
    ctx.scale(pitchProjection, 1);

    const cleatLength = SIM_CONFIG.PLAYER_BODY.CLEAT_LENGTH;
    const cleatW = SIM_CONFIG.PLAYER_BODY.CLEAT_WIDTH;
    const halfW = cleatW / 2;
    const heelBack = -0.34 * cleatLength;
    const heelFront = -0.22 * cleatLength;
    const toeBase = 0.40 * cleatLength;
    // Quadratic control point places the actual rounded toe tip at +0.66 L,
    // making the heel-to-toe extent match the configured 26 cm boot length.
    const toeTip = 0.92 * cleatLength;

    // Outsole / sidewall silhouette.
    ctx.fillStyle = isPlanted ? '#0f172a' : '#334155';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 0.010;
    ctx.beginPath();
    ctx.moveTo(heelFront, -halfW * 0.72);
    ctx.quadraticCurveTo(heelBack, 0, heelFront, halfW * 0.72);
    ctx.lineTo(toeBase, halfW);
    ctx.quadraticCurveTo(toeTip, 0, toeBase, -halfW);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Upper vamp panel sits inside the outsole. This gives the foot a shoe-top
    // surface, rather than making the entire object read as a flat sole.
    ctx.fillStyle = isPlanted ? '#475569' : '#64748b';
    ctx.beginPath();
    ctx.moveTo(-0.12 * cleatLength, -halfW * 0.47);
    ctx.quadraticCurveTo(0.08 * cleatLength, -halfW * 0.62, 0.31 * cleatLength, -halfW * 0.38);
    ctx.lineTo(0.39 * cleatLength, halfW * 0.38);
    ctx.quadraticCurveTo(0.08 * cleatLength, halfW * 0.62, -0.12 * cleatLength, halfW * 0.47);
    ctx.closePath();
    ctx.fill();

    // Heel counter and its rear edge provide a clear heel-to-toe orientation cue.
    ctx.fillStyle = isPlanted ? '#1e293b' : '#475569';
    ctx.beginPath();
    ctx.moveTo(-0.27 * cleatLength, -halfW * 0.46);
    ctx.quadraticCurveTo(-0.12 * cleatLength, -halfW * 0.56, -0.02 * cleatLength, -halfW * 0.42);
    ctx.lineTo(-0.02 * cleatLength, halfW * 0.42);
    ctx.quadraticCurveTo(-0.12 * cleatLength, halfW * 0.56, -0.27 * cleatLength, halfW * 0.46);
    ctx.closePath();
    ctx.fill();

    // White toe strike zone / toe cap (Anterior, +X)
    ctx.fillStyle = isPlanted ? '#f8fafc' : '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(toeBase * 0.55, -halfW * 0.9);
    ctx.quadraticCurveTo(toeTip * 0.94, 0, toeBase * 0.55, halfW * 0.9);
    ctx.closePath();
    ctx.fill();

    // Stud tips: Silver metallic for SG, dark azure for FG
    if (isPlanted) {
      ctx.fillStyle = studType === 'sg_metal' ? '#e2e8f0' : '#0284c7';
      ctx.beginPath();
      ctx.arc(-0.14 * cleatLength, -halfW * 0.5, 0.010, 0, Math.PI * 2);
      ctx.arc(-0.14 * cleatLength, halfW * 0.5, 0.010, 0, Math.PI * 2);
      ctx.arc(0.30 * cleatLength, -halfW * 0.5, 0.010, 0, Math.PI * 2);
      ctx.arc(0.30 * cleatLength, halfW * 0.5, 0.010, 0, Math.PI * 2);
      ctx.fill();
    }

    // Laces across the midfoot bridge
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.moveTo(0.04 * cleatLength, -halfW * 0.5);
    ctx.lineTo(0.04 * cleatLength, halfW * 0.5);
    ctx.moveTo(0.14 * cleatLength, -halfW * 0.5);
    ctx.lineTo(0.14 * cleatLength, halfW * 0.5);
    ctx.stroke();

    ctx.restore();
  }

  private drawDebugVectors(
    pos: Vector2,
    facing: number,
    velocity: Vector2,
    intent: Intent
  ): void {
    const ctx = this.ctx;

    // A. Facing Heading Vector (Red)
    const facingEnd = pos.add(Vector2.fromAngle(facing, 1.2));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(facingEnd.x, facingEnd.y);
    ctx.stroke();

    // B. Velocity Vector (Bright Blue)
    if (velocity.lengthSq() > 0.04) {
      const velEnd = pos.add(velocity.scale(0.3)); // 0.3s velocity vector projection
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(velEnd.x, velEnd.y);
      ctx.stroke();
    }

    // C. Desired Intent Vector (Dashed White)
    if (intent.moveDir.lengthSq() > 0.01) {
      const intentEnd = pos.add(intent.moveDir.scale(1.5));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 0.05;
      ctx.setLineDash([0.15, 0.15]);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(intentEnd.x, intentEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private interpolateAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  }

  private drawBallTrail(): void {
    if (this.ballTrail.length < 2) return;
    const ctx = this.ctx;
    const now = performance.now() / 1000;

    // A. Ground shadow turf trail
    ctx.beginPath();
    for (let i = 0; i < this.ballTrail.length; i++) {
      const pt = this.ballTrail[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 0.18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // B. Aerial flight trajectory ribbon
    ctx.beginPath();
    for (let i = 0; i < this.ballTrail.length; i++) {
      const pt = this.ballTrail[i];
      if (i === 0) ctx.moveTo(pt.x, pt.visualY);
      else ctx.lineTo(pt.x, pt.visualY);
    }
    const startPt = this.ballTrail[0];
    const endPt = this.ballTrail[this.ballTrail.length - 1];
    const grad = ctx.createLinearGradient(startPt.x, startPt.visualY, endPt.x, endPt.visualY);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.0)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.55)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.08;
    ctx.stroke();

    // C. Altitude drop-lines at key intervals
    for (let i = 0; i < this.ballTrail.length; i += 4) {
      const pt = this.ballTrail[i];
      const ptAlt = Math.max(0, pt.z - SIM_CONFIG.BALL.RADIUS);
      if (ptAlt > 0.15) {
        const age = now - pt.time;
        const alpha = Math.max(0, (1 - age / 1.2) * 0.4);
        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 0.02;
        ctx.setLineDash([0.06, 0.06]);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x, pt.visualY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawBallShadow(
    x: number,
    y: number,
    alt: number,
    radius: number = SIM_CONFIG.BALL.RADIUS
  ): void {
    const ctx = this.ctx;

    // Inversely scale opacity and size with altitude
    const opacity = Math.max(0.08, 0.42 / (1 + alt * 0.7));
    const radiusX = radius * Math.max(0.5, 1 - alt * 0.04);
    const radiusY = radiusX * 0.85;

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBall(
    visualX: number,
    visualY: number,
    alt: number,
    ballState: BallState
  ): void {
    const ctx = this.ctx;
    const model = BALL_PRESETS[ballState.modelId] ?? BALL_PRESETS.modern_match;
    const v = model.visual;
    const baseR = model.radius;
    const visualR = baseR * (1 + alt * 0.06);

    ctx.save();
    ctx.translate(visualX, visualY);

    // Ball Base Sphere with 3D spherical radial gradient
    const lightOffsetX = -visualR * 0.35;
    const lightOffsetY = -visualR * 0.35;
    const grad = ctx.createRadialGradient(
      lightOffsetX,
      lightOffsetY,
      visualR * 0.08,
      0,
      0,
      visualR
    );
    grad.addColorStop(0, v.baseColor);
    grad.addColorStop(0.55, v.baseColor === '#ffffff' ? '#f1f5f9' : v.baseColor);
    grad.addColorStop(0.85, v.baseColor === '#ffffff' ? '#cbd5e1' : '#1e1b18');
    grad.addColorStop(1.0, '#334155');

    ctx.beginPath();
    ctx.arc(0, 0, visualR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Clip internal patches & seams to the ball radius
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, visualR - 0.005, 0, Math.PI * 2);
    ctx.clip();

    // Rotate canvas around ball center by visual yaw
    ctx.rotate(this.ballVisualYaw);

    // Subtle pitch translation to simulate roll/spin across the ball face
    const pitchOffset = Math.sin(this.ballVisualPitch) * visualR * 0.22;
    ctx.translate(0, pitchOffset);

    if (v.patternType === 'jabulani_8') {
      // Adidas Jabulani: 8-Panel triangular aerodynamic curvature with gold and black accents
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);

        // Gold border
        ctx.fillStyle = v.accentColor;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(visualR * 0.5, visualR * 0.15, visualR * 0.85, visualR * 0.6);
        ctx.quadraticCurveTo(visualR * 0.4, visualR * 0.85, 0, visualR * 0.3);
        ctx.closePath();
        ctx.fill();

        // Inner black patch
        ctx.fillStyle = v.patchColor;
        ctx.beginPath();
        ctx.moveTo(0, visualR * 0.08);
        ctx.quadraticCurveTo(visualR * 0.42, visualR * 0.2, visualR * 0.72, visualR * 0.52);
        ctx.quadraticCurveTo(visualR * 0.35, visualR * 0.72, 0, visualR * 0.25);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
      // Central gold circle ring
      ctx.strokeStyle = v.accentColor;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.arc(0, 0, visualR * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (v.patternType === 'modern_speedshell') {
      // Modern Speedshell: Aerodynamic debossed speed streaks and cyan chevrons
      const numChevrons = 4;
      for (let i = 0; i < numChevrons; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / numChevrons);

        // Cyan speed streak
        ctx.fillStyle = v.accentColor;
        ctx.beginPath();
        ctx.moveTo(visualR * 0.15, -visualR * 0.1);
        ctx.lineTo(visualR * 0.75, -visualR * 0.04);
        ctx.lineTo(visualR * 0.65, visualR * 0.15);
        ctx.lineTo(visualR * 0.2, visualR * 0.08);
        ctx.closePath();
        ctx.fill();

        // Dark navy accent arrow
        ctx.fillStyle = v.patchColor;
        ctx.beginPath();
        ctx.moveTo(visualR * 0.3, -visualR * 0.06);
        ctx.lineTo(visualR * 0.7, -visualR * 0.02);
        ctx.lineTo(visualR * 0.55, visualR * 0.12);
        ctx.closePath();
        ctx.fill();

        // Thin aerodynamic seam groove
        ctx.strokeStyle = v.seamColor;
        ctx.lineWidth = 0.008;
        ctx.beginPath();
        ctx.arc(0, 0, visualR * 0.5, 0, Math.PI / 2);
        ctx.stroke();

        ctx.restore();
      }
    } else if (v.patternType === 'futsal_lowbounce') {
      // Futsal Pro: High-vis vibrant cross star
      ctx.fillStyle = v.patchColor;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? visualR * 0.68 : visualR * 0.26;
        const ang = (i * Math.PI) / 4;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = v.accentColor;
      ctx.lineWidth = 0.012;
      ctx.stroke();
    } else if (v.patternType === 'retro_leather') {
      // Retro 1966: Stitched curved leather vertical strips and laces
      ctx.strokeStyle = v.seamColor;
      ctx.lineWidth = 0.014;

      for (let s = -2; s <= 2; s++) {
        const xOffset = (s * visualR) / 2.8;
        ctx.beginPath();
        ctx.moveTo(xOffset, -visualR);
        ctx.quadraticCurveTo(xOffset * 1.25, 0, xOffset, visualR);
        ctx.stroke();
      }

      // Vintage white lace patch across center
      ctx.fillStyle = '#f8fafc';
      ctx.lineWidth = 0.008;
      ctx.strokeStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(-visualR * 0.18, 0);
      ctx.lineTo(visualR * 0.18, 0);
      ctx.moveTo(-visualR * 0.18, -visualR * 0.07);
      ctx.lineTo(visualR * 0.18, -visualR * 0.07);
      ctx.moveTo(-visualR * 0.18, visualR * 0.07);
      ctx.lineTo(visualR * 0.18, visualR * 0.07);
      ctx.stroke();
    } else {
      // Classic 32-Panel Telstar
      const pentagonR = visualR * 0.38;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const px = Math.cos(angle) * pentagonR;
        const py = Math.sin(angle) * pentagonR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = v.patchColor;
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.012;
      ctx.stroke();

      // 5 Radiating curved seam lines connecting pentagon vertices outward
      ctx.strokeStyle = v.seamColor;
      ctx.lineWidth = 0.01;
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const vx = Math.cos(angle) * pentagonR;
        const vy = Math.sin(angle) * pentagonR;
        const edgeAngle = angle + 0.15;
        const ex = Math.cos(edgeAngle) * visualR * 0.96;
        const ey = Math.sin(edgeAngle) * visualR * 0.96;

        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.quadraticCurveTo(vx * 1.3, vy * 1.3, ex, ey);
        ctx.stroke();

        // Outer satellite patches near rim
        ctx.fillStyle = v.patchColor;
        ctx.beginPath();
        ctx.arc(ex, ey, visualR * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Outer perimeter crisp boundary ring
    ctx.strokeStyle = v.seamColor;
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.arc(0, 0, visualR, 0, Math.PI * 2);
    ctx.stroke();

    // Specular glossy reflection highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.ellipse(
      -visualR * 0.32,
      -visualR * 0.32,
      visualR * 0.22,
      visualR * 0.12,
      -Math.PI / 4,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
  }

  private spawnFootstepSplash(footPos: Vector2, playerVel: Vector2, moisture: number): void {
    const intensity = Math.min(1.0, Math.max(0.1, (moisture - 0.35) / 0.45));

    // Concentric expanding ripple ring on wet turf
    if (this.groundRipples.length >= 35) this.groundRipples.shift();
    this.groundRipples.push({
      x: footPos.x,
      y: footPos.y,
      radius: 0.06,
      maxRadius: 0.20 + 0.16 * intensity,
      life: 0,
      maxLife: 0.35 + 0.25 * intensity,
      alpha: 0.40 + 0.35 * intensity,
    });

    // Directional water droplets fanning backward or radially
    const speed = playerVel.length();
    const baseAngle = speed > 0.3 ? playerVel.angle() + Math.PI : Math.random() * Math.PI * 2;
    const dropCount = Math.floor(4 + 10 * intensity);

    for (let i = 0; i < dropCount; i++) {
      if (this.groundSplashes.length >= 100) this.groundSplashes.shift();
      const spread = (Math.random() - 0.5) * 1.5;
      const angle = speed > 0.3 ? baseAngle + spread : Math.random() * Math.PI * 2;
      const dropSpeed = (0.8 + Math.random() * 2.2) * (0.8 + 0.5 * intensity);

      this.groundSplashes.push({
        x: footPos.x + (Math.random() - 0.5) * 0.06,
        y: footPos.y + (Math.random() - 0.5) * 0.06,
        vx: Math.cos(angle) * dropSpeed,
        vy: Math.sin(angle) * dropSpeed,
        radius: 0.014 + Math.random() * 0.014 * intensity,
        life: 0,
        maxLife: 0.22 + Math.random() * 0.20,
        color: 'rgba(215, 240, 255, 0.75)',
      });
    }
  }

  private spawnBallImpactSplash(ballPos: Vector3, ballVel: Vector3, moisture: number): void {
    const impactSpeed = Math.abs(ballVel.z);
    const intensity = Math.min(1.0, Math.max(0.1, (moisture - 0.35) / 0.45)) * Math.min(1.5, impactSpeed / 3.5);

    // Concentric ripple on wet pitch
    if (this.groundRipples.length >= 35) this.groundRipples.shift();
    this.groundRipples.push({
      x: ballPos.x,
      y: ballPos.y,
      radius: 0.08,
      maxRadius: 0.32 + 0.28 * intensity,
      life: 0,
      maxLife: 0.45 + 0.25 * intensity,
      alpha: 0.50 + 0.35 * intensity,
    });

    // Radial crown splash droplets
    const count = Math.floor(10 + 8 * Math.min(1.0, intensity));
    for (let i = 0; i < count; i++) {
      if (this.groundSplashes.length >= 100) this.groundSplashes.shift();
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const spraySpeed = (1.4 + Math.random() * 2.6) * Math.min(1.6, 0.7 + 0.5 * intensity);

      this.groundSplashes.push({
        x: ballPos.x,
        y: ballPos.y,
        vx: Math.cos(angle) * spraySpeed + ballVel.x * 0.15,
        vy: Math.sin(angle) * spraySpeed + ballVel.y * 0.15,
        radius: 0.016 + Math.random() * 0.018 * intensity,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.24,
        color: 'rgba(224, 242, 254, 0.82)',
      });
    }
  }

  private spawnBallRollWake(ballPos: Vector3, ballVel: Vector3, _moisture: number): void {
    if (Math.random() > 0.45) return; // Throttle to maintain high 60+ FPS performance

    const speed = Math.hypot(ballVel.x, ballVel.y);
    const heading = Math.atan2(ballVel.y, ballVel.x);
    const side = Math.random() < 0.5 ? 1 : -1;
    const sideAngle = heading + side * (Math.PI / 2 + (Math.random() - 0.5) * 0.4);

    if (this.groundSplashes.length >= 100) this.groundSplashes.shift();
    this.groundSplashes.push({
      x: ballPos.x,
      y: ballPos.y,
      vx: Math.cos(sideAngle) * (0.8 + speed * 0.15),
      vy: Math.sin(sideAngle) * (0.8 + speed * 0.15),
      radius: 0.012 + Math.random() * 0.012,
      life: 0,
      maxLife: 0.18 + Math.random() * 0.15,
      color: 'rgba(200, 230, 255, 0.65)',
    });
  }

  private updateAndDrawGroundEffects(dt: number): void {
    const ctx = this.ctx;

    // 1. Draw expanding concentric ripples on wet pitch
    for (let i = this.groundRipples.length - 1; i >= 0; i--) {
      const rip = this.groundRipples[i];
      rip.life += dt;
      if (rip.life >= rip.maxLife) {
        this.groundRipples.splice(i, 1);
        continue;
      }

      const progress = rip.life / rip.maxLife;
      const currentRadius = rip.radius + (rip.maxRadius - rip.radius) * progress;
      const currentAlpha = rip.alpha * (1 - progress);

      ctx.save();
      ctx.strokeStyle = `rgba(186, 230, 253, ${currentAlpha.toFixed(2)})`;
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, currentRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw ballistic water droplet splashes
    for (let i = this.groundSplashes.length - 1; i >= 0; i--) {
      const splash = this.groundSplashes[i];
      splash.life += dt;
      if (splash.life >= splash.maxLife) {
        this.groundSplashes.splice(i, 1);
        continue;
      }

      splash.x += splash.vx * dt;
      splash.y += splash.vy * dt;
      const drag = Math.pow(0.18, dt);
      splash.vx *= drag;
      splash.vy *= drag;

      const progress = splash.life / splash.maxLife;
      const alpha = Math.max(0, 1 - progress);

      ctx.save();
      ctx.fillStyle = `rgba(215, 240, 255, ${(alpha * 0.75).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(splash.x, splash.y, splash.radius * (1 - progress * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private updateAndDrawRain(
    dt: number,
    pitchSurface?: PitchSurface,
    currBall?: BallState
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const precipMmH = pitchSurface ? pitchSurface.getPrecipitation() : 0;
    if (precipMmH <= 0.1 && this.rainDrops.length === 0) {
      return;
    }

    // Target droplet count scaled with precipitation intensity
    // 0 mm/h -> 0; 15 mm/h -> ~150; 35 mm/h -> ~350 drops
    const targetCount = precipMmH > 0.1
      ? Math.min(400, Math.max(35, Math.floor((precipMmH / 35) * 350)))
      : 0;

    // Wind vector coupling
    let windSpeed = 2.0;
    let windHeading = Math.PI * 0.35; // Gentle default breeze
    if (currBall?.wind) {
      windSpeed = currBall.wind.speed;
      windHeading = currBall.wind.heading;
    }

    // Convert wind to screen velocity
    const windScreenX = Math.cos(windHeading) * windSpeed * this.pixelsPerMeter;
    const windScreenY = Math.sin(windHeading) * windSpeed * this.pixelsPerMeter;

    // Adjust population
    while (this.rainDrops.length < targetCount) {
      const layer: 0 | 1 = Math.random() < 0.65 ? 0 : 1;
      this.rainDrops.push({
        x: Math.random() * (w + 200) - 100,
        y: Math.random() * (h + 100) - 50,
        speed: layer === 0 ? 850 + Math.random() * 200 : 1300 + Math.random() * 300,
        length: layer === 0 ? 14 + Math.random() * 8 : 24 + Math.random() * 12,
        layer,
      });
    }

    if (this.rainDrops.length > targetCount) {
      this.rainDrops.splice(targetCount);
    }

    // Separate batch passes for layer 0 (background / distant) and layer 1 (foreground)
    ctx.save();
    ctx.lineCap = 'round';

    // Layer 0: Background fine drizzle / lighter streaks
    ctx.strokeStyle = 'rgba(190, 220, 245, 0.28)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const drop = this.rainDrops[i];
      if (drop.layer !== 0) continue;

      const vx = windScreenX * 0.85;
      const vy = Math.max(450, drop.speed + windScreenY * 0.25);

      drop.x += vx * dt;
      drop.y += vy * dt;

      // Viewport wrap
      if (drop.y > h + 50 || drop.x < -120 || drop.x > w + 120) {
        drop.y = -40 - Math.random() * 40;
        drop.x = Math.random() * (w + 240) - 120;
      }

      const totalVel = Math.hypot(vx, vy);
      const streakDx = (vx / totalVel) * drop.length;
      const streakDy = (vy / totalVel) * drop.length;

      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - streakDx, drop.y - streakDy);
    }
    ctx.stroke();

    // Layer 1: Foreground heavy droplets / brighter streaks
    ctx.strokeStyle = 'rgba(215, 238, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const drop = this.rainDrops[i];
      if (drop.layer !== 1) continue;

      const vx = windScreenX * 1.25;
      const vy = Math.max(650, drop.speed + windScreenY * 0.35);

      drop.x += vx * dt;
      drop.y += vy * dt;

      // Viewport wrap
      if (drop.y > h + 50 || drop.x < -120 || drop.x > w + 120) {
        drop.y = -40 - Math.random() * 40;
        drop.x = Math.random() * (w + 240) - 120;
      }

      const totalVel = Math.hypot(vx, vy);
      const streakDx = (vx / totalVel) * drop.length;
      const streakDy = (vy / totalVel) * drop.length;

      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - streakDx, drop.y - streakDy);
    }
    ctx.stroke();

    ctx.restore();
  }

  // --- Particle Inspection Helpers for Unit & Edge-Case Testing ---
  getRainDropCount(): number {
    return this.rainDrops.length;
  }

  getGroundSplashCount(): number {
    return this.groundSplashes.length;
  }

  getGroundRippleCount(): number {
    return this.groundRipples.length;
  }

  clearParticles(): void {
    this.rainDrops.length = 0;
    this.groundSplashes.length = 0;
    this.groundRipples.length = 0;
    this.lastPlantedFoot = null;
    this.lastBallBounceTime = 0;
  }

  private drawColliders(
    bodies: readonly ContactBody[],
    lastContactMarker?: { point: Vector3; normal: Vector3; zone: string; impulse: Vector3; time: number } | null
  ): void {
    const ctx = this.ctx;
    ctx.save();

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const isLoaded = b.loaded;

      if (b.id === 'torso') {
        // Torso capsule outline in orange
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.50)';
        ctx.lineWidth = 0.02;
        ctx.setLineDash([0.08, 0.08]);
        ctx.beginPath();
        ctx.arc(b.currPos.x, b.currPos.y, b.shape.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (b.shape.type === 'capsule') {
        const p1 = b.shape.p1;
        const p2 = b.shape.p2;
        const rad = b.shape.radius;

        // Color coding: Cyan for loaded stance, Emerald/Violet for swing
        if (b.id.includes('thigh')) {
          ctx.strokeStyle = isLoaded ? 'rgba(6, 182, 212, 0.55)' : 'rgba(168, 85, 247, 0.65)';
        } else if (b.id.includes('shin')) {
          ctx.strokeStyle = isLoaded ? 'rgba(6, 182, 212, 0.65)' : 'rgba(59, 130, 246, 0.70)';
        } else {
          // Boot
          ctx.strokeStyle = isLoaded ? 'rgba(6, 182, 212, 0.85)' : 'rgba(34, 197, 94, 0.90)';
        }

        ctx.lineWidth = 0.02;

        // Draw capsule spine
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Draw endpoint cap circles
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, rad, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p2.x, p2.y, rad, 0, Math.PI * 2);
        ctx.stroke();

        // If boot, draw longitudinal and lateral axes
        if (b.id.includes('boot')) {
          const yaw = b.bootYaw ?? 0;
          const uFwd = new Vector2(Math.cos(yaw), Math.sin(yaw));
          const uLat = new Vector2(Math.sin(yaw), -Math.cos(yaw));

          ctx.lineWidth = 0.015;
          // Longitudinal forward axis (Cyan/Green)
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p1.x + uFwd.x * 0.28, p1.y + uFwd.y * 0.28);
          ctx.stroke();

          // Lateral outside axis
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
          ctx.beginPath();
          ctx.moveTo(b.currPos.x, b.currPos.y);
          ctx.lineTo(b.currPos.x + uLat.x * 0.08, b.currPos.y + uLat.y * 0.08);
          ctx.stroke();
        }

        // Swing segment velocity vector
        if (!isLoaded && b.velocity.lengthSq() > 0.05) {
          const vEnd = b.currPos.add(b.velocity.scale(0.12));
          ctx.strokeStyle = 'rgba(34, 197, 94, 0.80)';
          ctx.lineWidth = 0.02;
          ctx.beginPath();
          ctx.moveTo(b.currPos.x, b.currPos.y);
          ctx.lineTo(vEnd.x, vEnd.y);
          ctx.stroke();
        }
      }
    }

    // Last-contact marker visualization
    if (lastContactMarker) {
      const pt = lastContactMarker.point;
      const imp = lastContactMarker.impulse;
      const zone = lastContactMarker.zone;
      const impMag = imp.length();

      // Contact point reticle
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 0.06, 0, Math.PI * 2);
      ctx.stroke();

      // Impulse vector arrow
      if (impMag > 0.1) {
        const arrowScale = 0.04;
        const arrowEnd = pt.add(imp.scale(arrowScale));
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(arrowEnd.x, arrowEnd.y);
        ctx.stroke();
      }

      // Zone label text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 0.18px monospace';
      ctx.fillText(`[${zone.toUpperCase()}] J=${impMag.toFixed(1)} N·s`, pt.x + 0.10, pt.y - 0.10);
    }

    ctx.restore();
  }

  toggleColliders(): boolean {
    this.showColliders = !this.showColliders;
    return this.showColliders;
  }

  setShowColliders(show: boolean): void {
    this.showColliders = show;
  }

  getShowColliders(): boolean {
    return this.showColliders;
  }
}
