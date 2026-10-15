import {
  BALL_PRESETS,
  BallState,
  PITCH_TIER_PRESETS,
  PitchSurfaceState,
  PlayerState,
  TURF_PRESETS,
} from '../sim/types';

/**
 * Telemetry HUD and Real-Time Rolling Speed Graph.
 */
export class TelemetryHUD {
  private readonly speedEl: HTMLElement | null;
  private readonly gaitEl: HTMLElement | null;
  private readonly cadenceEl: HTMLElement | null;
  private readonly strideEl: HTMLElement | null;
  private readonly phaseEl: HTMLElement | null;
  private readonly footEl: HTMLElement | null;
  private readonly facingEl: HTMLElement | null;
  private readonly posEl: HTMLElement | null;
  private readonly footednessEl: HTMLElement | null;
  private readonly cutPlantEl: HTMLElement | null;
  private readonly archetypeEl: HTMLElement | null;
  private readonly curveEl: HTMLElement | null;
  private readonly attrsEl: HTMLElement | null;
  private readonly ballModelEl: HTMLElement | null;
  private readonly turfCondEl: HTMLElement | null;
  private readonly windEl: HTMLElement | null;
  private readonly aeroRegimeEl: HTMLElement | null;
  private readonly ballFlightEl: HTMLElement | null;
  private readonly ballSpeedEl: HTMLElement | null;
  private readonly ballAltEl: HTMLElement | null;
  private readonly ballSpinEl: HTMLElement | null;
  private readonly pitchTierEl: HTMLElement | null;
  private readonly rainEl: HTMLElement | null;
  private readonly grassHeightEl: HTMLElement | null;
  private readonly studsEl: HTMLElement | null;
  private readonly tractionEl: HTMLElement | null;
  private readonly pitchDamageEl: HTMLElement | null;
  private readonly moistureEl: HTMLElement | null;
  private readonly staminaEl: HTMLElement | null;
  private readonly miniSpeedEl: HTMLElement | null;
  private readonly miniGaitEl: HTMLElement | null;
  private readonly miniBallEl: HTMLElement | null;
  private readonly miniPitchEl: HTMLElement | null;
  private readonly hudOverlay: HTMLElement | null;
  private readonly controlsLegend: HTMLElement | null;
  private readonly graphContainer: HTMLElement | null;
  private readonly graphCanvas: HTMLCanvasElement | null;
  private readonly graphCtx: CanvasRenderingContext2D | null;

  private readonly speedHistory: number[] = [];
  private readonly maxHistoryLength: number = 240; // ~2 seconds at 120 Hz

  constructor() {
    this.speedEl = document.getElementById('hud-speed');
    this.gaitEl = document.getElementById('hud-gait');
    this.cadenceEl = document.getElementById('hud-cadence');
    this.strideEl = document.getElementById('hud-stride');
    this.phaseEl = document.getElementById('hud-phase');
    this.footEl = document.getElementById('hud-foot');
    this.facingEl = document.getElementById('hud-facing');
    this.posEl = document.getElementById('hud-pos');
    this.footednessEl = document.getElementById('hud-footedness');
    this.cutPlantEl = document.getElementById('hud-cut-plant');
    this.archetypeEl = document.getElementById('hud-archetype');
    this.curveEl = document.getElementById('hud-curve');
    this.attrsEl = document.getElementById('hud-attrs');
    this.ballModelEl = document.getElementById('hud-ball-model');
    this.turfCondEl = document.getElementById('hud-turf-cond');
    this.windEl = document.getElementById('hud-wind');
    this.aeroRegimeEl = document.getElementById('hud-aero-regime');
    this.ballFlightEl = document.getElementById('hud-ball-flight');
    this.ballSpeedEl = document.getElementById('hud-ball-speed');
    this.ballAltEl = document.getElementById('hud-ball-alt');
    this.ballSpinEl = document.getElementById('hud-ball-spin');
    this.pitchTierEl = document.getElementById('hud-pitch-tier');
    this.rainEl = document.getElementById('hud-rain');
    this.grassHeightEl = document.getElementById('hud-grass-height');
    this.studsEl = document.getElementById('hud-studs');
    this.tractionEl = document.getElementById('hud-traction');
    this.pitchDamageEl = document.getElementById('hud-pitch-damage');
    this.moistureEl = document.getElementById('hud-moisture');
    this.staminaEl = document.getElementById('hud-stamina');
    this.miniSpeedEl = document.getElementById('hud-mini-speed');
    this.miniGaitEl = document.getElementById('hud-mini-gait');
    this.miniBallEl = document.getElementById('hud-mini-ball');
    this.miniPitchEl = document.getElementById('hud-mini-pitch');
    this.hudOverlay = document.getElementById('hud-overlay');
    this.controlsLegend = document.getElementById('controls-legend');
    this.graphContainer = document.getElementById('graph-container');

    this.graphCanvas = document.getElementById('graph-canvas') as HTMLCanvasElement | null;
    this.graphCtx = this.graphCanvas ? this.graphCanvas.getContext('2d') : null;

    this.initUIControls();
  }

  update(
    state: PlayerState,
    ballState?: BallState,
    pitchSurfaceState?: PitchSurfaceState
  ): void {
    const speed = state.velocity.length();
    const speedKmh = speed * 3.6;

    if (this.speedEl) {
      this.speedEl.textContent = `${speed.toFixed(2)} m/s (${speedKmh.toFixed(1)} km/h)`;
    }
    if (this.gaitEl) {
      this.gaitEl.textContent = speed < 0.05 ? 'REST / STAND' : state.gait.toUpperCase();
    }
    if (this.miniSpeedEl) {
      this.miniSpeedEl.textContent = `${speed.toFixed(1)} m/s`;
    }
    if (this.miniGaitEl) {
      this.miniGaitEl.textContent = speed < 0.05 ? 'STAND' : state.gait.toUpperCase();
    }
    if (this.miniBallEl) {
      const bSpeed = ballState ? ballState.velocity.length() : 0;
      this.miniBallEl.textContent = `${bSpeed.toFixed(1)} m/s`;
    }
    if (this.miniPitchEl && pitchSurfaceState) {
      const tierShort = pitchSurfaceState.tierId
        .replace('tier', 'T')
        .replace('_elite_hybrid', ' Hybrid')
        .replace('_pro_sand', ' Sand')
        .replace('_semipro_loam', ' Loam')
        .replace('_grassroots_clay', ' Clay');
      this.miniPitchEl.textContent = tierShort;
    }
    if (this.cadenceEl) {
      this.cadenceEl.textContent = `${state.stride.cadence.toFixed(1)} Hz`;
    }
    if (this.strideEl) {
      this.strideEl.textContent = `${state.stride.strideLength.toFixed(2)} m`;
    }
    if (this.phaseEl) {
      if (speed < 0.05) {
        this.phaseEl.textContent = 'REST (100%)';
      } else {
        const pct = Math.round(state.stride.phaseProgress * 100);
        this.phaseEl.textContent = `${state.stride.phase.toUpperCase()} (${pct}%)`;
      }
    }
    if (this.footEl) {
      if (speed < 0.05 || state.stride.isDoubleSupport) {
        this.footEl.textContent = 'BOTH FEET (DOUBLE SUPPORT)';
        this.footEl.style.color = '#94a3b8';
      } else if (state.stride.phase === 'stance') {
        const brakingTag = state.stride.isBraking ? ' [BRAKING PLANT]' : '';
        this.footEl.textContent = `${state.stride.currentFoot.toUpperCase()} planted${brakingTag}`;
        this.footEl.style.color = state.stride.isBraking ? '#f87171' : '#4ade80';
      } else {
        this.footEl.textContent = 'AIRBORNE (FLIGHT)';
        this.footEl.style.color = '#38bdf8';
      }
    }
    if (this.facingEl) {
      const deg = Math.round((state.facing * 180) / Math.PI);
      this.facingEl.textContent = `${deg}°`;
    }
    if (this.posEl) {
      this.posEl.textContent = `(${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}) m`;
    }
    if (this.footednessEl) {
      if (state.footedness.dominantFoot === 'right') {
        this.footednessEl.textContent = 'Right [F] (Weak L: 1★)';
        this.footednessEl.style.color = '#38bdf8';
      } else if (state.footedness.dominantFoot === 'left') {
        this.footednessEl.textContent = 'Left [F] (Weak R: 1★)';
        this.footednessEl.style.color = '#c084fc';
      } else {
        this.footednessEl.textContent = 'Ambipedal [F] (Both: 5★)';
        this.footednessEl.style.color = '#4ade80';
      }
    }
    if (this.cutPlantEl) {
      if (state.cutStatus.isCutting && state.cutStatus.plantFoot) {
        const foot = state.cutStatus.plantFoot.toUpperCase();
        if (state.cutStatus.isOutsideFoot) {
          const domStr = state.cutStatus.isDominantPlant ? 'DOMINANT 100%' : 'WEAK 84%';
          this.cutPlantEl.textContent = `⚡ ${foot} (OUTSIDE ${domStr})`;
          this.cutPlantEl.style.color = state.cutStatus.isDominantPlant ? '#4ade80' : '#f59e0b';
        } else {
          this.cutPlantEl.textContent = `👟 ${foot} (INSIDE CHECK 35%)`;
          this.cutPlantEl.style.color = '#38bdf8';
        }
      } else {
        this.cutPlantEl.textContent = 'Neutral';
        this.cutPlantEl.style.color = '#94a3b8';
      }
    }
    if (this.archetypeEl) {
      this.archetypeEl.textContent = `${state.attributes.name} [P]`;
    }
    if (this.curveEl) {
      const kappa = state.curveIndex;
      const sign = kappa >= 0 ? '+' : '';
      let styleTag = 'Controlled (0.00)';
      let color = '#a3e635';
      if (kappa > 0.08) {
        styleTag = 'Explosive Burst';
        color = '#38bdf8';
      } else if (kappa < -0.08) {
        styleTag = 'Sustained Lengthy';
        color = '#f59e0b';
      }
      this.curveEl.textContent = `${sign}${kappa.toFixed(2)} (${styleTag})`;
      this.curveEl.style.color = color;
    }
    if (this.attrsEl) {
      const a = state.attributes;
      this.attrsEl.textContent = `SPD ${a.topSpeed} | ACC ${a.acceleration} | AGI ${a.agility} | STR ${a.strength} | BAL ${a.balance}`;
    }

    if (ballState) {
      if (this.ballModelEl) {
        const model = BALL_PRESETS[ballState.modelId];
        this.ballModelEl.textContent = model ? `${model.name} [B]` : `${ballState.modelId} [B]`;
      }
      if (this.turfCondEl) {
        const turf = TURF_PRESETS[ballState.turfCondition];
        this.turfCondEl.textContent = turf ? `${turf.name} [T]` : `${ballState.turfCondition} [T]`;
      }
      if (this.windEl) {
        const w = ballState.wind;
        if (!w || w.speed < 0.5) {
          this.windEl.textContent = '0.0 m/s (Calm) [V]';
          this.windEl.style.color = '#94a3b8';
        } else {
          const dirDeg = Math.round((w.heading * 180) / Math.PI);
          this.windEl.textContent = `${w.speed.toFixed(1)} m/s @ ${dirDeg}° (Gust ${(w.gustIntensity * 100).toFixed(0)}%) [V]`;
          this.windEl.style.color = '#38bdf8';
        }
      }
      if (this.aeroRegimeEl) {
        if (ballState.isKnuckling) {
          this.aeroRegimeEl.textContent = '⚡ KNUCKLEBALL WOBBLE';
          this.aeroRegimeEl.style.color = '#f59e0b';
        } else if (ballState.dragRegime === 'supercritical') {
          this.aeroRegimeEl.textContent = 'SUPERCRITICAL (Low Drag)';
          this.aeroRegimeEl.style.color = '#38bdf8';
        } else if (ballState.dragRegime === 'transitional') {
          this.aeroRegimeEl.textContent = 'DRAG CRISIS TRANSITION';
          this.aeroRegimeEl.style.color = '#eab308';
        } else {
          this.aeroRegimeEl.textContent = 'SUBCRITICAL (Standard)';
          this.aeroRegimeEl.style.color = '#94a3b8';
        }
      }
      if (this.ballFlightEl) {
        this.ballFlightEl.textContent = ballState.flightState.toUpperCase();
        if (ballState.flightState === 'flight') {
          this.ballFlightEl.style.color = '#38bdf8';
        } else if (ballState.flightState === 'rolling') {
          this.ballFlightEl.style.color = '#f59e0b';
        } else {
          this.ballFlightEl.style.color = '#4ade80';
        }
      }
      if (this.ballSpeedEl) {
        const bSpeed = ballState.velocity.length();
        const bSpeedKmh = bSpeed * 3.6;
        this.ballSpeedEl.textContent = `${bSpeed.toFixed(2)} m/s (${bSpeedKmh.toFixed(1)} km/h)`;
      }
      if (this.ballAltEl) {
        this.ballAltEl.textContent = `${ballState.position.z.toFixed(2)} m`;
      }
      if (this.ballSpinEl) {
        const sidespinRps = ballState.spin.z / (2 * Math.PI);
        const backspinRps = Math.hypot(ballState.spin.x, ballState.spin.y) / (2 * Math.PI);
        const curlSign =
          Math.abs(sidespinRps) < 0.1
            ? 'None'
            : sidespinRps > 0
              ? 'Inside (+)'
              : 'Outside (-)';
        this.ballSpinEl.textContent = `${Math.abs(sidespinRps).toFixed(1)} rps (${curlSign}) | ${backspinRps.toFixed(1)} rps spin`;
      }
    }

    if (this.studsEl) {
      if (state.studType === 'sg_metal') {
        this.studsEl.textContent = 'SG Metal Studs [Y] (Wet Grip +35%)';
        this.studsEl.style.color = '#38bdf8';
      } else {
        this.studsEl.textContent = 'FG Molded Plastic [Y]';
        this.studsEl.style.color = '#e2e8f0';
      }
    }

    if (this.staminaEl) {
      const stamPct = Math.round(state.stamina * 100);
      const mult = state.pitchFatigueMultiplier;
      let col = '#4ade80';
      if (stamPct < 35) col = '#ef4444';
      else if (stamPct < 65) col = '#f59e0b';
      this.staminaEl.textContent = `${stamPct}% (Drain: ${mult.toFixed(2)}x)`;
      this.staminaEl.style.color = col;
    }

    if (this.tractionEl) {
      const demand = state.slipStatus.tractionDemand;
      const avail = state.slipStatus.availableTraction;

      if (state.slipStatus.type === 'controlled_slide') {
        this.tractionEl.textContent = `⚡ CONTROLLED SLIDE (${state.slipStatus.timer.toFixed(2)}s) [E]`;
        this.tractionEl.style.color = '#38bdf8';
      } else if (state.slipStatus.type === 'wipeout') {
        this.tractionEl.textContent = `💥 WIPEOUT / FULL SLIP (${state.slipStatus.timer.toFixed(2)}s)`;
        this.tractionEl.style.color = '#ef4444';
      } else if (state.slipStatus.type === 'micro_slip') {
        this.tractionEl.textContent = `⚠️ MICRO-SLIP (STUMBLE) (${state.slipStatus.timer.toFixed(2)}s)`;
        this.tractionEl.style.color = '#f59e0b';
      } else {
        const ratio = demand / Math.max(0.01, avail);
        let tag = 'SAFE';
        let color = '#4ade80';
        if (ratio > 0.85) {
          tag = 'HIGH DEMAND';
          color = '#eab308';
        }
        this.tractionEl.textContent = `Demand: ${demand.toFixed(2)} / ${avail.toFixed(2)} [${tag}]`;
        this.tractionEl.style.color = color;
      }
    }

    if (pitchSurfaceState) {
      if (this.pitchTierEl) {
        const tier = PITCH_TIER_PRESETS[pitchSurfaceState.tierId];
        this.pitchTierEl.textContent = tier ? `${tier.name.split(' (')[0]} [G]` : `${pitchSurfaceState.tierId} [G]`;
      }

      if (this.rainEl) {
        const rain = pitchSurfaceState.precipitationMmH;
        const drain = pitchSurfaceState.drainageRateMmH;
        let rainTag = 'Dry';
        if (rain >= 30) rainTag = 'Downpour';
        else if (rain >= 10) rainTag = 'Rain';
        this.rainEl.textContent = `${rain.toFixed(0)} mm/h (${rainTag}) | Drain: ${drain.toFixed(0)} mm/h [N]`;
        this.rainEl.style.color = rain > 0 ? '#38bdf8' : '#94a3b8';
      }

      if (this.moistureEl) {
        const mPct = Math.round(pitchSurfaceState.baseMoisture * 100);
        let mTag = 'Damp Reg';
        let mCol = '#60a5fa';
        const civ = Math.round(pitchSurfaceState.cleggHardness);
        let civTag = 'Standard';
        if (civ > 105) civTag = 'Hardpan';
        else if (civ < 50) civTag = 'Soft Mud';
        this.moistureEl.textContent = `${mPct}% (${mTag}) | ${civ} CIV (${civTag}) [M]`;
        this.moistureEl.style.color = mCol;
      }

      if (this.grassHeightEl) {
        const h = pitchSurfaceState.grassHeightMm;
        let regTag = 'Regulation';
        if (h < 22) regTag = 'Short Cut (Fast Glide)';
        else if (h > 26) regTag = 'Tall Heavy (High Drag)';
        this.grassHeightEl.textContent = `${h} mm (${regTag}) [[]]`;
      }

      if (this.pitchDamageEl) {
        const wearPct = Math.round(pitchSurfaceState.averageWear * 100);
        const ruts = pitchSurfaceState.rutsCount ?? 0;
        const matchMin = pitchSurfaceState.simulatedMatchMinutes ?? 0;
        const trafficLabel = matchMin > 0 ? `${matchMin}m match` : '0m';
        this.pitchDamageEl.textContent = `${trafficLabel} | ${pitchSurfaceState.divotsCount} divots, ${ruts} ruts (${wearPct}% wear) [J/C]`;
      }
    }

    // Update rolling speed graph
    this.speedHistory.push(speed);
    if (this.speedHistory.length > this.maxHistoryLength) {
      this.speedHistory.shift();
    }

    this.drawGraph();
  }

  private drawGraph(): void {
    if (!this.graphCanvas || !this.graphCtx) return;
    const ctx = this.graphCtx;
    const w = this.graphCanvas.width;
    const h = this.graphCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background grid & speed threshold reference lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    const maxGraphSpeed = 10.0; // m/s
    const speeds = [2.2, 4.8, 9.4];
    const labels = ['walk', 'jog', 'sprint'];

    for (let i = 0; i < speeds.length; i++) {
      const y = h - (speeds[i] / maxGraphSpeed) * h;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.font = '9px monospace';
      ctx.fillText(`${labels[i]} (${speeds[i]}m/s)`, 4, y - 2);
    }

    ctx.setLineDash([]);

    if (this.speedHistory.length < 2) return;

    // Draw speed trace
    ctx.strokeStyle = '#a3e635';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const stepX = w / (this.maxHistoryLength - 1);
    for (let i = 0; i < this.speedHistory.length; i++) {
      const x = i * stepX;
      const y = h - (this.speedHistory[i] / maxGraphSpeed) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private initUIControls(): void {
    if (!this.hudOverlay) return;

    const collapseBtn = document.getElementById('hud-collapse-btn');
    const compactBtn = document.getElementById('hud-compact-btn');
    const header = document.getElementById('hud-header');
    const opacitySlider = document.getElementById('hud-opacity-slider') as HTMLInputElement | null;
    const resetPosBtn = document.getElementById('hud-reset-pos');

    // 1. Collapse / Expand Entire HUD
    const toggleCollapse = () => {
      if (!this.hudOverlay) return;
      const isCollapsed = this.hudOverlay.classList.toggle('hud-collapsed');
      if (collapseBtn) {
        collapseBtn.textContent = isCollapsed ? '+' : '−';
        collapseBtn.title = isCollapsed ? 'Expand HUD (H)' : 'Collapse HUD (H)';
      }
    };

    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse();
      });
    }

    // 2. Compact vs Detailed Mode
    const toggleCompact = () => {
      if (!this.hudOverlay) return;
      const isCompact = this.hudOverlay.classList.toggle('hud-compact');
      if (compactBtn) {
        compactBtn.textContent = isCompact ? 'Full' : 'Compact';
        compactBtn.title = isCompact ? 'Show Full Telemetry (U)' : 'Compact View (U)';
      }
    };

    if (compactBtn) {
      compactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCompact();
      });
    }

    // 3. Section Accordions
    const sectionHeaders = document.querySelectorAll('.hud-section-header');
    sectionHeaders.forEach((secHeader) => {
      secHeader.addEventListener('click', () => {
        const parentSection = secHeader.closest('.hud-section');
        if (parentSection) {
          parentSection.classList.toggle('collapsed');
        }
      });
    });

    // 4. Draggable Header
    if (header) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      header.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.hudOverlay!.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
      });

      window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging || !this.hudOverlay) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxL = window.innerWidth - this.hudOverlay.offsetWidth - 10;
        const maxT = window.innerHeight - this.hudOverlay.offsetHeight - 10;
        const newL = Math.max(8, Math.min(maxL, initialLeft + dx));
        const newT = Math.max(8, Math.min(maxT, initialTop + dy));
        this.hudOverlay.style.left = `${newL}px`;
        this.hudOverlay.style.top = `${newT}px`;
        this.hudOverlay.style.right = 'auto';
        this.hudOverlay.style.bottom = 'auto';
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
        }
      });

      // Double-click header resets position
      header.addEventListener('dblclick', () => {
        this.resetHUDPosition();
      });
    }

    if (resetPosBtn) {
      resetPosBtn.addEventListener('click', () => {
        this.resetHUDPosition();
      });
    }

    // 5. Opacity Slider
    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        if (this.hudOverlay) {
          this.hudOverlay.style.background = `rgba(10, 20, 12, ${opacitySlider.value})`;
        }
      });
    }

    // 6. Sub-panels: Graph & Controls Legend Toggles
    const graphToggleBtn = document.getElementById('graph-toggle-btn');
    if (graphToggleBtn && this.graphContainer) {
      graphToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCol = this.graphContainer!.classList.toggle('collapsed');
        graphToggleBtn.textContent = isCol ? '+' : '−';
      });
    }

    const controlsToggleBtn = document.getElementById('controls-toggle-btn');
    if (controlsToggleBtn && this.controlsLegend) {
      controlsToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCol = this.controlsLegend!.classList.toggle('collapsed');
        controlsToggleBtn.textContent = isCol ? 'Controls (?)' : 'Hide (?)';
      });
    }

    // 7. Keyboard Shortcuts: 'H' for HUD, 'U' for Compact, 'Slash' or '?' for Controls
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyH') {
        toggleCollapse();
      } else if (e.code === 'KeyU') {
        toggleCompact();
      } else if (e.code === 'Slash' || e.key === '?') {
        if (this.controlsLegend) {
          const isCol = this.controlsLegend.classList.toggle('collapsed');
          if (controlsToggleBtn) {
            controlsToggleBtn.textContent = isCol ? 'Controls (?)' : 'Hide (?)';
          }
        }
      }
    });
  }

  private resetHUDPosition(): void {
    if (!this.hudOverlay) return;
    this.hudOverlay.style.left = '16px';
    this.hudOverlay.style.top = '16px';
    this.hudOverlay.style.right = 'auto';
    this.hudOverlay.style.bottom = 'auto';
  }
}
