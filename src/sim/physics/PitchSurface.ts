import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { SIM_CONFIG } from '../config';
import {
  PITCH_TIER_PRESETS,
  PitchDivot,
  PitchRut,
  PitchSurfaceState,
  PitchTierId,
  PitchTierProfile,
  StudType,
} from '../types';

export interface PuddleZone {
  readonly id: number;
  readonly center: Vector2;
  readonly radius: number;
  intensity: number; // 0.0 to 1.0 (water depth/saturation ratio)
}

/**
 * Headless Turf Pitch Surface and Biomechanical Wear/Divot Subsystem.
 * Models:
 * - Regulation grass cutting height (18 mm to 36 mm, UEFA standard 24 mm)
 * - Pitch Tier Profiles (Tier 1 Elite Hybrid to Tier 4 Grassroots Clay)
 * - Realistic Hydraulic Drainage: Darcy soil percolation + SubAir active vacuum drainage
 * - Dynamic Precipitation Inflow (Rainfall mm/h) & Natural Puddle Formation/Drying
 * - Dynamic agronomic rolling friction scaling: mu_roll(h) = mu_base * (1 + 0.035 * (h - 24))
 * - Cleat penetration and root shearing traction modulation
 * - Discrete spatial wear density grid (0.5m resolution across 115m x 78m pitch envelope)
 * - Dynamic 2D surface moisture & standing water puddle grid (hydroplaning & fluid drag)
 * - Persistent ground divots (circular sod tears) & cleat ruts (linear skid trenches)
 * - Rolling ball micro-bob deflection & hops when crossing surface divots and ruts
 */
export class PitchSurface {
  private grassHeightMm: number = 24.0; // Standard 24 mm regulation cut
  private tier: PitchTierProfile = PITCH_TIER_PRESETS.tier1_elite_hybrid;
  private precipitationMmH: number = 0.0; // Current rainfall rate in mm/h
  private activeDrainageRateMmH: number = 0.0; // Live drainage extraction rate in mm/h

  private readonly divots: PitchDivot[] = [];
  private readonly maxDivots: number = 300;
  private nextDivotId: number = 1;

  // Cleat Ruts (Directional trenches left by sliding tackles and skids)
  private readonly ruts: PitchRut[] = [];
  private readonly maxRuts: number = 150;
  private nextRutId: number = 1;
  private readonly rutCooldowns: Map<number, number> = new Map();

  // Dynamic Surface Moisture & Water Puddle System
  private baseMoisture: number = 0.22; // Default to Tier 1 equilibrium moisture
  private readonly moistureGrid: Float32Array;
  private readonly puddles: PuddleZone[] = [];
  private nextPuddleId: number = 1;
  private simulatedMatchMinutes: number = 0;

  // Spatial Wear Grid Setup
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minY: number;
  private readonly maxY: number;
  private readonly cellSize: number = 0.5; // 0.5 meter per cell
  private readonly cols: number;
  private readonly rows: number;
  private readonly wearGrid: Float32Array;
  private readonly topographyGrid: Float32Array;

  // Cooldown map to prevent multi-triggering ball micro-bobs across consecutive ticks
  private readonly divotCooldowns: Map<number, number> = new Map();

  constructor(
    initialGrassHeightMm: number = 24.0,
    initialTier: PitchTierId | PitchTierProfile = 'tier1_elite_hybrid'
  ) {
    this.grassHeightMm = Math.max(18.0, Math.min(36.0, initialGrassHeightMm));
    this.setPitchTier(initialTier);
    this.baseMoisture = this.tier.equilibriumMoisture;

    const halfL = SIM_CONFIG.PITCH.LENGTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;
    const halfW = SIM_CONFIG.PITCH.WIDTH / 2 + SIM_CONFIG.PITCH.BOUNDARY_MARGIN;

    this.minX = -halfL;
    this.maxX = halfL;
    this.minY = -halfW;
    this.maxY = halfW;

    this.cols = Math.ceil((this.maxX - this.minX) / this.cellSize);
    this.rows = Math.ceil((this.maxY - this.minY) / this.cellSize);
    this.wearGrid = new Float32Array(this.cols * this.rows);
    this.topographyGrid = new Float32Array(this.cols * this.rows);
    this.moistureGrid = new Float32Array(this.cols * this.rows);
    this.moistureGrid.fill(this.baseMoisture);
    this.generateTopographyGrid();
  }

  getGrassHeight(): number {
    return this.grassHeightMm;
  }

  setGrassHeight(heightMm: number): void {
    this.grassHeightMm = Math.max(18.0, Math.min(36.0, heightMm));
  }

  changeGrassHeight(deltaMm: number): number {
    this.setGrassHeight(this.grassHeightMm + deltaMm);
    return this.grassHeightMm;
  }

  /**
   * Agronomic Rolling Resistance Multiplier:
   * Short 20 mm grass: -14% rolling resistance (fast glide)
   * Standard 24 mm grass: 1.00x baseline
   * Tall 36 mm uncut grass: +42% rolling resistance (heavy drag)
   */
  getRollingFrictionMultiplier(): number {
    return 1.0 + 0.035 * (this.grassHeightMm - 24.0);
  }

  /**
   * Grass Cleat Traction Factor:
   * Peak root shear grip at 22-24 mm.
   * Decreases in very short grass (less subsoil thatch) and tall unmanaged grass (blades lay flat).
   */
  getGrassTractionFactor(): number {
    const diff = this.grassHeightMm - 24.0;
    return Math.max(0.85, 1.0 - 0.0008 * diff * diff);
  }

  /**
   * Maps world coordinates (x, y) to wear grid indices.
   */
  private worldToGrid(x: number, y: number): { col: number; row: number } | null {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) {
      return null;
    }
    const col = Math.floor((x - this.minX) / this.cellSize);
    const row = Math.floor((y - this.minY) / this.cellSize);
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      return { col, row };
    }
    return null;
  }

  /**
   * Retrieves wear value in [0.0, 1.0] at world position (x, y).
   */
  getWearAt(x: number, y: number): number {
    const cell = this.worldToGrid(x, y);
    if (!cell) return 0.0;
    return this.wearGrid[cell.row * this.cols + cell.col];
  }

  /**
   * Adds wear to turf cells within a given radius.
   */
  addWear(x: number, y: number, radius: number, amount: number): void {
    const centerCell = this.worldToGrid(x, y);
    if (centerCell) {
      const centerIdx = centerCell.row * this.cols + centerCell.col;
      this.wearGrid[centerIdx] = Math.min(1.0, this.wearGrid[centerIdx] + amount);
    }

    const effectiveRadius = Math.max(radius, this.cellSize);
    const minGridX = Math.max(0, Math.floor((x - effectiveRadius - this.minX) / this.cellSize));
    const maxGridX = Math.min(this.cols - 1, Math.floor((x + effectiveRadius - this.minX) / this.cellSize));
    const minGridY = Math.max(0, Math.floor((y - effectiveRadius - this.minY) / this.cellSize));
    const maxGridY = Math.min(this.rows - 1, Math.floor((y + effectiveRadius - this.minY) / this.cellSize));

    const rSq = effectiveRadius * effectiveRadius;

    for (let r = minGridY; r <= maxGridY; r++) {
      const cellY = this.minY + (r + 0.5) * this.cellSize;
      const dy = cellY - y;
      const dySq = dy * dy;

      for (let c = minGridX; c <= maxGridX; c++) {
        // Skip center cell as it was already incremented
        if (centerCell && r === centerCell.row && c === centerCell.col) continue;

        const cellX = this.minX + (c + 0.5) * this.cellSize;
        const dx = cellX - x;
        const distSq = dx * dx + dySq;

        if (distSq <= rSq) {
          const falloff = 1.0 - Math.sqrt(distSq) / effectiveRadius;
          const idx = r * this.cols + c;
          this.wearGrid[idx] = Math.min(1.0, this.wearGrid[idx] + amount * falloff * 0.6);
        }
      }
    }
  }

  /**
   * Creates a persistent divot at the given location with orientation along shear stress.
   */
  /**
   * Creates a persistent divot at the given location with orientation along shear stress.
   * Scaled by pitch tier rootzone shear resistance and maximum divot radius.
   * Hybrid pitches (Tier 1) feature synthetic fiber stitching that restricts sod tears
   * to minimal scuffs, while native grassroots clay (Tier 4) rips large sod craters.
   */
  createDivot(
    pos: Vector2,
    heading: number,
    severity: number = 0.5,
    simTime: number = 0
  ): PitchDivot {
    const clampedSev = Math.max(0.1, Math.min(1.0, severity));
    // Scale divot radius by tier's maxDivotRadius (0.045m on Tier 1 vs 0.13m on Tier 4)
    const radius = (0.50 + 0.50 * clampedSev) * this.tier.maxDivotRadius;
    const depthMult = this.tier.rutDepthMultiplier ?? 1.0;
    const depth = (0.008 + 0.012 * clampedSev) * depthMult;

    const divot: PitchDivot = {
      id: this.nextDivotId++,
      position: pos.clone(),
      radius,
      depth,
      heading,
      turfTornPct: clampedSev,
      createdAt: simTime,
    };

    this.divots.push(divot);
    if (this.divots.length > this.maxDivots) {
      const removed = this.divots.shift();
      if (removed) {
        this.divotCooldowns.delete(removed.id);
      }
    }

    return divot;
  }

  getDivots(): readonly PitchDivot[] {
    return this.divots;
  }

  getDivotsNear(
    pos: Vector2,
    radius: number,
    minAgeSeconds: number = 0,
    simTime: number = 0
  ): PitchDivot[] {
    const rSq = radius * radius;
    const res: PitchDivot[] = [];
    for (let i = 0; i < this.divots.length; i++) {
      const d = this.divots[i];
      if (minAgeSeconds > 0 && simTime - d.createdAt < minAgeSeconds) {
        continue;
      }
      const dx = d.position.x - pos.x;
      const dy = d.position.y - pos.y;
      if (dx * dx + dy * dy <= rSq) {
        res.push(d);
      }
    }
    return res;
  }

  /**
   * Evaluates rolling ball interaction with turf divots.
   * Generates micro-bob vertical kick, lateral angular twitch, and instantaneous rolling resistance.
   */
  checkBallDivotCollision(
    ballPos: Vector3,
    ballRadius: number,
    simTime: number
  ): { verticalKick: number; lateralJitter: number; resistanceMult: number } | null {
    // Only applies if ball is rolling or skimming turf level
    if (ballPos.z > ballRadius + 0.04) {
      return null;
    }

    for (let i = 0; i < this.divots.length; i++) {
      const divot = this.divots[i];
      const thresh = divot.radius + ballRadius * 0.5;
      const dx = ballPos.x - divot.position.x;
      const dy = ballPos.y - divot.position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < thresh * thresh) {
        // Check cooldown for this divot to avoid firing on every 8ms sub-tick
        const lastHit = this.divotCooldowns.get(divot.id) ?? -1;
        if (simTime - lastHit < 0.20) {
          continue;
        }

        this.divotCooldowns.set(divot.id, simTime);

        // Calculate perturbation based on divot severity and impact offset
        const dist = Math.sqrt(distSq);
        const impactRatio = 1.0 - dist / (divot.radius + ballRadius);
        const verticalKick = 0.20 + 0.25 * divot.turfTornPct * impactRatio; // 0.20 - 0.45 m/s hop
        // Deterministic pseudo-random jitter based on divot id and creation time
        const lateralJitter = Math.sin(divot.id * 127.1 + divot.createdAt) * 0.25 * divot.turfTornPct;
        const resistanceMult = 1.0 + 0.8 * divot.turfTornPct;

        return { verticalKick, lateralJitter, resistanceMult };
      }
    }

    return null;
  }

  /**
   * Creates a persistent cleat rut track from startPos to endPos.
   * Typically generated by sliding tackles, uncontrolled slides, or heavy deceleration ruts.
   */
  createRut(
    startPos: Vector2,
    endPos: Vector2,
    severity: number = 0.6,
    simTime: number = 0
  ): PitchRut {
    const clampedSev = Math.max(0.1, Math.min(1.0, severity));
    const depthMult = this.tier.rutDepthMultiplier ?? 1.0;
    const width = 0.12 + 0.08 * clampedSev; // 0.12 - 0.20 m width
    const depth = (0.012 + 0.02 * clampedSev) * depthMult;

    const localMoisture = this.getMoistureAt(startPos.x, startPos.y);
    const isWaterlogged = localMoisture >= 0.70;

    const rut: PitchRut = {
      id: this.nextRutId++,
      startPos: startPos.clone(),
      endPos: endPos.clone(),
      width,
      depth: isWaterlogged ? depth * 0.30 : depth, // Standing water cushions rootzone penetration
      severity: clampedSev,
      createdAt: simTime,
      moisture: localMoisture,
      isWaterlogged,
    };

    this.ruts.push(rut);
    if (this.ruts.length > this.maxRuts) {
      const removed = this.ruts.shift();
      if (removed) {
        this.rutCooldowns.delete(removed.id);
      }
    }

    // Decoupled from wearGrid: ruts render cleanly as authentic turf furrow vector trenches
    // without corrupting the background wear grid into blocky 0.5m square tile artifacts.

    return rut;
  }

  getRuts(): readonly PitchRut[] {
    return this.ruts;
  }

  /**
   * Checks if a rolling ball crosses a cleat rut furrow.
   */
  checkBallRutCollision(
    ballPos: Vector3,
    ballRadius: number,
    simTime: number
  ): { verticalKick: number; lateralJitter: number; resistanceMult: number } | null {
    if (ballPos.z > ballRadius + 0.04) {
      return null;
    }

    const px = ballPos.x;
    const py = ballPos.y;

    for (let i = 0; i < this.ruts.length; i++) {
      const rut = this.ruts[i];
      const thresh = rut.width + ballRadius * 0.5;

      // Fast AABB rejection
      const minX = Math.min(rut.startPos.x, rut.endPos.x) - thresh;
      const maxX = Math.max(rut.startPos.x, rut.endPos.x) + thresh;
      if (px < minX || px > maxX) continue;

      const minY = Math.min(rut.startPos.y, rut.endPos.y) - thresh;
      const maxY = Math.max(rut.startPos.y, rut.endPos.y) + thresh;
      if (py < minY || py > maxY) continue;

      const abX = rut.endPos.x - rut.startPos.x;
      const abY = rut.endPos.y - rut.startPos.y;
      const abLenSq = abX * abX + abY * abY;
      if (abLenSq < 1e-4) continue;

      const apX = px - rut.startPos.x;
      const apY = py - rut.startPos.y;
      const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / abLenSq));
      const closeX = rut.startPos.x + abX * t;
      const closeY = rut.startPos.y + abY * t;

      const dx = px - closeX;
      const dy = py - closeY;
      const distSq = dx * dx + dy * dy;

      if (distSq < thresh * thresh) {
        const lastHit = this.rutCooldowns.get(rut.id) ?? -1;
        if (simTime - lastHit < 0.20) {
          continue;
        }
        this.rutCooldowns.set(rut.id, simTime);

        const dist = Math.sqrt(distSq);
        const impactRatio = 1.0 - dist / (rut.width + ballRadius);
        const waterloggedDamp = rut.isWaterlogged ? 0.35 : 1.0;
        const verticalKick = (0.16 + 0.20 * rut.severity * impactRatio) * waterloggedDamp;
        const lateralJitter = Math.cos(rut.id * 83.3 + rut.createdAt) * 0.20 * rut.severity * waterloggedDamp;
        const resistanceMult = 1.0 + 0.60 * rut.severity * waterloggedDamp;

        return { verticalKick, lateralJitter, resistanceMult };
      }
    }
    return null;
  }

  /**
   * Checks if a position is near an existing rut furrow (traction hazard).
   */
  isNearRut(pos: Vector2, radius: number = 0.35): boolean {
    const rSq = radius * radius;
    const px = pos.x;
    const py = pos.y;

    for (let i = 0; i < this.ruts.length; i++) {
      const rut = this.ruts[i];
      // Fast AABB rejection
      const minX = Math.min(rut.startPos.x, rut.endPos.x) - radius;
      const maxX = Math.max(rut.startPos.x, rut.endPos.x) + radius;
      if (px < minX || px > maxX) continue;

      const minY = Math.min(rut.startPos.y, rut.endPos.y) - radius;
      const maxY = Math.max(rut.startPos.y, rut.endPos.y) + radius;
      if (py < minY || py > maxY) continue;

      const abX = rut.endPos.x - rut.startPos.x;
      const abY = rut.endPos.y - rut.startPos.y;
      const abLenSq = abX * abX + abY * abY;
      if (abLenSq < 1e-4) continue;

      const apX = px - rut.startPos.x;
      const apY = py - rut.startPos.y;
      const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / abLenSq));
      const closeX = rut.startPos.x + abX * t;
      const closeY = rut.startPos.y + abY * t;

      const dx = px - closeX;
      const dy = py - closeY;
      if (dx * dx + dy * dy < rSq) {
        return true;
      }
    }
    return false;
  }

  // --- Dynamic Surface Moisture & Waterlogging ---

  getBaseMoisture(): number {
    return this.baseMoisture;
  }

  setBaseMoisture(moisture: number): void {
    this.baseMoisture = Math.max(0.0, Math.min(1.0, moisture));
    // Standing water puddles cannot physically exist on dry/damp turf (< 0.60)
    if (this.baseMoisture < 0.60 && this.puddles.length > 0) {
      this.puddles.length = 0;
    }
    this.recomputeMoistureGrid();
  }

  cycleMoisture(): number {
    // Cycles: 0.10 (Dry) -> 0.30 (Damp Regulation) -> 0.65 (Wet Slick) -> 0.90 (Waterlogged Puddles)
    if (this.baseMoisture < 0.20) {
      this.clearPuddles();
      this.setBaseMoisture(0.30);
    } else if (this.baseMoisture < 0.50) {
      this.clearPuddles();
      this.setBaseMoisture(0.65);
    } else if (this.baseMoisture < 0.80) {
      this.setBaseMoisture(0.90);
      this.spawnNaturalPuddles();
    } else {
      this.clearPuddles();
      this.setBaseMoisture(0.10);
    }
    return this.baseMoisture;
  }

  addPuddle(center: Vector2, radius: number, intensity: number = 0.90): void {
    this.puddles.push({
      id: this.nextPuddleId++,
      center: center.clone(),
      radius,
      intensity: Math.max(0.1, Math.min(1.0, intensity)),
    });
    this.stampPuddleOnGrid(center, radius, intensity);
  }

  getPuddles(): readonly PuddleZone[] {
    return this.puddles;
  }

  private stampPuddleOnGrid(center: Vector2, radius: number, intensity: number): void {
    const minX = Math.max(0, Math.floor((center.x - radius - this.minX) / this.cellSize));
    const maxX = Math.min(this.cols - 1, Math.floor((center.x + radius - this.minX) / this.cellSize));
    const minY = Math.max(0, Math.floor((center.y - radius - this.minY) / this.cellSize));
    const maxY = Math.min(this.rows - 1, Math.floor((center.y + radius - this.minY) / this.cellSize));

    const rSq = radius * radius;
    for (let r = minY; r <= maxY; r++) {
      const cellY = this.minY + (r + 0.5) * this.cellSize;
      const dy = cellY - center.y;
      for (let c = minX; c <= maxX; c++) {
        const cellX = this.minX + (c + 0.5) * this.cellSize;
        const dx = cellX - center.x;
        const dSq = dx * dx + dy * dy;
        if (dSq <= rSq) {
          const falloff = 1.0 - Math.sqrt(dSq) / radius;
          const puddleVal = this.baseMoisture + (intensity - this.baseMoisture) * falloff;
          const idx = r * this.cols + c;
          this.moistureGrid[idx] = Math.max(this.moistureGrid[idx], Math.min(1.0, puddleVal));
        }
      }
    }
  }

  private recomputeMoistureGrid(): void {
    this.moistureGrid.fill(this.baseMoisture);
    for (const p of this.puddles) {
      this.stampPuddleOnGrid(p.center, p.radius, p.intensity);
    }
  }

  spawnNaturalPuddles(): void {
    this.puddles.length = 0;
    // Characteristic water collection in goalmouths, center circle, and touchlines
    this.addPuddle(new Vector2(-51.5, 0), 5.0, 0.95);
    this.addPuddle(new Vector2(51.5, 0), 5.0, 0.95);
    this.addPuddle(new Vector2(0, 0), 6.5, 0.88);
    this.addPuddle(new Vector2(-18, 16), 4.2, 0.85);
    this.addPuddle(new Vector2(18, -16), 4.2, 0.85);
  }

  getMoistureAt(x: number, y: number): number {
    const cell = this.worldToGrid(x, y);
    if (!cell) return this.baseMoisture;
    return this.moistureGrid[cell.row * this.cols + cell.col];
  }

  getMoistureGrid(): Float32Array {
    return this.moistureGrid;
  }

  /**
   * Clears all standing water puddles and restores moisture grid to base level.
   */
  clearPuddles(): void {
    this.puddles.length = 0;
    this.recomputeMoistureGrid();
  }

  /**
   * Resets all pitch wear to pristine condition, removes all divots and ruts.
   */
  clearDamage(): void {
    this.divots.length = 0;
    this.ruts.length = 0;
    this.divotCooldowns.clear();
    this.rutCooldowns.clear();
    this.wearGrid.fill(0);
    this.puddles.length = 0;
    this.simulatedMatchMinutes = 0;
    this.recomputeMoistureGrid();
  }

  /**
   * Computes average wear over the pitch central active area.
   */
  getAverageWear(): number {
    let sum = 0;
    const len = this.wearGrid.length;
    for (let i = 0; i < len; i++) {
      sum += this.wearGrid[i];
    }
    return sum / len;
  }

  /**
   * Simulates progressive match traffic wear over playing time (e.g. 45 or 90 minutes).
   * Models authentic spatial wear patterns:
   * - Central midfield corridor (high traffic): x in [-35, 35], y in [-15, 15]
   * - Goalmouths & 6-yard boxes (extreme localized stamping): x near +-51.5, y near 0
   * - Penalty box spots
   * High moisture dramatically accelerates turf degradation:
   * - Tier 1 (hybrid sand): synthetic fibers hold sand matrix; after 90 mins in rain, wear remains low (< 12%), no mudbaths.
   * - Tier 4 (native clay): heavy rain + 90 mins turns goalmouths and center into bare slick mudbath (> 75% wear) and puddles.
   */
  /**
   * Relative turf wear susceptibility factor based on rootzone reinforcement tier.
   * - Tier 1 (SISGrass hybrid carpet): 0.08x (synthetic fibers prevent turf thinning)
   * - Tier 2 (Pro sand carpet): 0.22x
   * - Tier 3 (Semi-pro sandy loam): 0.55x
   * - Tier 4 (Grassroots native clay): 1.15x
   */
  getTierWearMultiplier(): number {
    const tier = this.tier;
    return tier.tier === 1 ? 0.08 : tier.tier === 2 ? 0.22 : tier.tier === 3 ? 0.55 : 1.15;
  }

  /**
   * Multiplier on turf wear susceptibility caused by moisture plasticizing the rootzone.
   */
  getMoistureWearMultiplier(x?: number, y?: number): number {
    const moisture = x !== undefined && y !== undefined ? this.getMoistureAt(x, y) : this.baseMoisture;
    const tier = this.tier;
    return 1.0 + 2.0 * Math.max(0, (moisture - tier.equilibriumMoisture) / 0.5);
  }

  getSimulatedMatchMinutes(): number {
    return this.simulatedMatchMinutes;
  }

  simulateMatchTraffic(minutesOfPlay: number, matchIntensity: number = 1.0): void {
    const hours = Math.max(0, minutesOfPlay) / 60.0;
    const tier = this.tier;
    const moisture = this.baseMoisture;

    this.simulatedMatchMinutes += Math.max(0, minutesOfPlay);

    // Wet turf softens root anchoring: wear rate scales significantly with moisture
    const wetWearMultiplier = this.getMoistureWearMultiplier();
    const tierWearRate = this.getTierWearMultiplier();

    const baseRate = hours * matchIntensity * tierWearRate * wetWearMultiplier;

    // 1. Goalmouth wear (both ends): +/- 51.5m, y near 0
    const goalmouthWear = Math.min(1.0, baseRate * 0.40);
    this.addWear(-51.5, 0, 5.0, goalmouthWear);
    this.addWear(51.5, 0, 5.0, goalmouthWear);

    // 2. Penalty box / spot wear
    this.addWear(-41.5, 0, 3.8, baseRate * 0.22);
    this.addWear(41.5, 0, 3.8, baseRate * 0.22);

    // 3. Central spine / midfield corridor & Center Circle
    const centerCircleWear = Math.min(1.0, baseRate * 0.20);
    this.addWear(0, 0, 9.15, centerCircleWear);

    for (let x = -30; x <= 30; x += 10) {
      const centralWear = Math.min(1.0, baseRate * (0.14 + 0.06 * Math.cos(x * 0.05)));
      this.addWear(x, 0, 7.5, centralWear);
    }

    // 4. In severe wet degradation on clay (Tier 4, moisture >= 0.60, goalmouth wear >= 0.40),
    // exposed subsoil churns into mud puddles
    if (tier.tier >= 3 && moisture >= 0.60 && this.getWearAt(-51.5, 0) > 0.40) {
      if (this.puddles.length === 0) {
        this.addPuddle(new Vector2(-51.5, 0), 4.5, 0.92);
        this.addPuddle(new Vector2(51.5, 0), 4.5, 0.92);
      }
    }

    // 5. Spawn realistic match divots from tackles, studs sliding, and high-traction pivot cuts
    const divotsToSpawn = Math.max(1, Math.round(hours * 2 * (1 + tier.tier * 1.2)));
    const actionPoints = [
      { x: 0, y: 0 },
      { x: 12.5, y: -4.2 },
      { x: -14.0, y: 5.5 },
      { x: -28.0, y: -2.0 },
      { x: 26.5, y: 3.8 },
      { x: -40.0, y: 0.5 },
      { x: 40.5, y: -1.2 },
      { x: -50.0, y: 1.0 },
      { x: 50.0, y: -0.8 },
      { x: 8.0, y: 12.0 },
      { x: -9.5, y: -13.5 },
      { x: 2.0, y: 6.0 },
    ];
    for (let i = 0; i < divotsToSpawn && i < actionPoints.length; i++) {
      const pt = actionPoints[(this.divots.length + i) % actionPoints.length];
      const jitterX = Math.sin((i + 1) * 7.3) * 3.5;
      const jitterY = Math.cos((i + 1) * 4.9) * 2.8;
      const pos = new Vector2(pt.x + jitterX, pt.y + jitterY);
      const heading = (i * 1.45) % (Math.PI * 2);
      const severity = 0.35 + 0.12 * tier.tier;
      this.createDivot(pos, heading, severity, this.simulatedMatchMinutes * 60);
    }
  }

  /**
   * Advances pitch hydrology (precipitation inflow, hydraulic percolation, SubAir vacuum drainage, puddle drainage).
   */
  step(dt: number): void {
    const tier = this.tier;
    const maxCapacity =
      tier.gravityDrainageMmH +
      (this.baseMoisture > tier.equilibriumMoisture ? tier.vacuumDrainageMmH : 0);

    // Active drainage occurs when moisture exceeds equilibrium
    let currentDrainRate = 0;
    if (this.baseMoisture > tier.equilibriumMoisture) {
      // SubAir vacuum and gravity percolation scale swiftly with standing surface water
      const excessRatio = Math.min(
        1.0,
        (this.baseMoisture - tier.equilibriumMoisture) / 0.12
      );
      currentDrainRate = maxCapacity * excessRatio;
    }
    this.activeDrainageRateMmH = currentDrainRate;

    // 1.0 moisture corresponds to ~25 mm of standing surface water saturation
    const netWaterChangeMmH = this.precipitationMmH - currentDrainRate;
    const dm = (netWaterChangeMmH / (3600 * 25.0)) * dt;

    if (Math.abs(dm) > 1e-7) {
      const targetMoisture = Math.max(0.05, Math.min(1.0, this.baseMoisture + dm));
      if (Math.abs(targetMoisture - this.baseMoisture) > 0.001) {
        this.baseMoisture = targetMoisture;
        // Spawn natural puddles if heavy rain overwhelms drainage and pitch is waterlogged
        if (
          this.baseMoisture >= 0.85 &&
          this.puddles.length === 0 &&
          this.precipitationMmH > maxCapacity
        ) {
          this.spawnNaturalPuddles();
        }
        this.recomputeMoistureGrid();
      } else {
        this.baseMoisture = targetMoisture;
      }
    }

    // Drain existing puddles if drainage capacity exceeds precipitation
    if (this.puddles.length > 0 && maxCapacity > this.precipitationMmH) {
      let puddlesChanged = false;
      for (let i = this.puddles.length - 1; i >= 0; i--) {
        const p = this.puddles[i];
        const puddleExcessRatio = Math.min(
          1.0,
          Math.max(0, (p.intensity - tier.equilibriumMoisture) / 0.12)
        );
        const puddleDrainRate = maxCapacity * puddleExcessRatio;
        const puddleDrainDelta =
          ((puddleDrainRate - this.precipitationMmH) / (3600 * 25.0)) * dt;

        const newIntensity = p.intensity - puddleDrainDelta;
        p.intensity = newIntensity;
        if (newIntensity <= 0.65) {
          // Puddle dissipated below standing water threshold
          this.puddles.splice(i, 1);
          puddlesChanged = true;
        } else {
          puddlesChanged = true;
        }
      }
      if (puddlesChanged) {
        this.recomputeMoistureGrid();
      }
    }
  }

  getPitchTier(): PitchTierProfile {
    return this.tier;
  }

  setPitchTier(tier: PitchTierId | PitchTierProfile): void {
    if (typeof tier === 'string') {
      this.tier = PITCH_TIER_PRESETS[tier] ?? PITCH_TIER_PRESETS.tier1_elite_hybrid;
    } else {
      this.tier = tier;
    }
    if (this.topographyGrid) {
      this.generateTopographyGrid();
    }
  }

  private generateTopographyGrid(): void {
    const roughnessM = this.tier.topographyRoughnessMm / 1000.0;
    for (let r = 0; r < this.rows; r++) {
      const y = this.minY + (r + 0.5) * this.cellSize;
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * this.cellSize;
        // 3 octaves of deterministic spatial pseudo-noise
        const macro = Math.sin(x * 0.14 + y * 0.11) * Math.cos(x * 0.09 - y * 0.13); // ~10-15m
        const meso = Math.sin(x * 0.43 - y * 0.37) * Math.cos(x * 0.31 + y * 0.47);  // ~3-4m
        const micro = Math.sin(x * 1.37 + y * 1.51) * Math.cos(x * 1.73 - y * 1.29); // ~0.8-1.2m
        const rawNoise = macro * 0.50 + meso * 0.35 + micro * 0.15;
        this.topographyGrid[r * this.cols + c] = rawNoise * roughnessM;
      }
    }
  }

  getTopographyHeight(x: number, y: number): number {
    const cell = this.worldToGrid(x, y);
    if (!cell) return 0.0;
    return this.topographyGrid[cell.row * this.cols + cell.col];
  }

  getTopographyAt(x: number, y: number): { height: number; normal: Vector3 } {
    const cell = this.worldToGrid(x, y);
    if (!cell) {
      return { height: 0, normal: new Vector3(0, 0, 1) };
    }
    const height = this.topographyGrid[cell.row * this.cols + cell.col];

    // Compute surface normal via central finite difference across neighbor cells
    const eps = this.cellSize;
    const hL = this.getTopographyHeight(x - eps, y);
    const hR = this.getTopographyHeight(x + eps, y);
    const hD = this.getTopographyHeight(x, y - eps);
    const hU = this.getTopographyHeight(x, y + eps);

    const dzdx = (hR - hL) / (2 * eps);
    const dzdy = (hU - hD) / (2 * eps);

    const normal = new Vector3(-dzdx, -dzdy, 1.0).normalize();
    return { height, normal };
  }

  getTopographyGrid(): Float32Array {
    return this.topographyGrid;
  }

  getPrecipitation(): number {
    return this.precipitationMmH;
  }

  setPrecipitation(mmH: number): void {
    this.precipitationMmH = Math.max(0, mmH);
  }

  /**
   * Computes Clegg Impact Value (CIV) at world position (x, y) or pitch average.
   * Based on Sports Turf Research Institute (STRI) and FIFA Quality Programme standards.
   * Target range for elite natural football pitches: 70 - 90 CIV.
   * Baked dry clay (moisture < 0.15): CIV climbs to 110 - 130+ (rock hard).
   * Saturated spongy mud (moisture > 0.65): CIV drops to 30 - 45 (soft mud).
   * Hybrid sand pitches (Tier 1) maintain tight stability (72 - 88 CIV).
   */
  getCleggHardness(x?: number, y?: number): number {
    const moisture = x !== undefined && y !== undefined ? this.getMoistureAt(x, y) : this.baseMoisture;
    const wear = x !== undefined && y !== undefined ? this.getWearAt(x, y) : this.getAverageWear();
    const tier = this.tier;
    const baseCiv = tier.baseCleggHardness;

    // Clay vs Sand sensitivity to moisture:
    // Tier 1 (sand carpet) has minimal moisture-hardness variation (0.15)
    // Tier 4 (native clay) has extreme moisture-hardness variation (0.85)
    const claySensitivity =
      tier.tier === 1 ? 0.15 : tier.tier === 2 ? 0.35 : tier.tier === 3 ? 0.60 : 0.85;

    let deltaCiv = 0;
    if (moisture < tier.equilibriumMoisture) {
      // Dry conditions: soil dehydrates into a hardened crust
      const dryDeficit = (tier.equilibriumMoisture - moisture) / Math.max(0.1, tier.equilibriumMoisture);
      deltaCiv = claySensitivity * 75.0 * Math.pow(Math.min(1.0, dryDeficit), 1.2);
    } else {
      // Wet conditions: water plasticizes and softens the soil matrix
      const excess = (moisture - tier.equilibriumMoisture) / Math.max(0.1, 1.0 - tier.equilibriumMoisture);
      deltaCiv = -claySensitivity * 45.0 * Math.min(1.0, excess);
    }

    // Traffic compaction: wear from boots compacts subsoil (+0 to +12 CIV)
    const compaction = wear * 12.0;

    return Math.max(25.0, Math.min(145.0, baseCiv + deltaCiv + compaction));
  }

  /**
   * Restitution multiplier from soil compaction (Clegg Impact Value - CIV).
   * Reference: STRI vertical ball rebound vs Clegg hardness.
   * Standard 75 CIV: 1.00x multiplier.
   * Hard baked ground (CIV > 110): up to +18% rebound.
   * Soft waterlogged mud (CIV < 45): -15% to -25% rebound damping.
   */
  getSoilRestitutionMultiplier(x: number, y: number): number {
    const civ = this.getCleggHardness(x, y);
    return Math.max(0.70, Math.min(1.22, 1.0 + (civ - 75.0) / 220.0));
  }

  /**
   * Rolling resistance multiplier from soil compaction / sinkage.
   * High CIV (firm/hard): minimal ball sinkage, faster glide (0.85x).
   * Low CIV (soft/mud): ball sinks into deformable soil, heavy drag (1.20x).
   */
  getSoilRollingFrictionMultiplier(x: number, y: number): number {
    const civ = this.getCleggHardness(x, y);
    return Math.max(0.85, Math.min(1.25, 1.0 - (civ - 75.0) / 250.0));
  }

  /**
   * Stud penetration and grip factor based on soil hardness.
   * Molded FG plastic studs cannot bite into rock-hard baked clay (CIV > 100),
   * and clog/slide in deep soft mud (CIV < 50).
   * SG metal studs pierce hard soil crust and bite into deep subsoil in mud.
   */
  getStudHardnessTractionFactor(x: number, y: number, studType: StudType): number {
    const civ = this.getCleggHardness(x, y);
    if (civ > 95.0) {
      const hardExcess = (civ - 95.0) / 40.0;
      const penalty = studType === 'fg_plastic' ? 0.22 : 0.10;
      return Math.max(0.75, 1.0 - penalty * hardExcess);
    } else if (civ < 55.0) {
      const softDeficit = (55.0 - civ) / 30.0;
      const penalty = studType === 'fg_plastic' ? 0.28 : 0.08;
      return Math.max(0.68, 1.0 - penalty * softDeficit);
    }
    return 1.0;
  }

  getActiveDrainageRate(): number {
    return this.activeDrainageRateMmH;
  }

  getState(): PitchSurfaceState {
    return {
      grassHeightMm: this.grassHeightMm,
      divotsCount: this.divots.length,
      rutsCount: this.ruts.length,
      averageWear: this.getAverageWear(),
      baseMoisture: this.baseMoisture,
      rollingFrictionMult: this.getRollingFrictionMultiplier(),
      puddlesCount: this.puddles.length,
      tierId: this.tier.id,
      precipitationMmH: this.precipitationMmH,
      drainageRateMmH: this.activeDrainageRateMmH,
      cleggHardness: this.getCleggHardness(),
      simulatedMatchMinutes: this.simulatedMatchMinutes,
    };
  }

  getWearGrid(): Float32Array {
    return this.wearGrid;
  }

  getGridDimensions(): {
    cols: number;
    rows: number;
    cellSize: number;
    minX: number;
    minY: number;
  } {
    return {
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      minX: this.minX,
      minY: this.minY,
    };
  }
}
