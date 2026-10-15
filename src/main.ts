import { CanvasRenderer } from './render/CanvasRenderer';
import { TelemetryHUD } from './render/TelemetryHUD';
import { SIM_CONFIG } from './sim/config';
import { KeyboardInputManager } from './sim/input/keybindings';
import { SimulationCore } from './sim/SimulationCore';
import { Intent, TURF_PRESETS } from './sim/types';

function showToast(text: string, color: string = '#38bdf8'): void {
  const toast = document.getElementById('sim-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.style.borderColor = color;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  clearTimeout((window as any)._toastTimeout);
  (window as any)._toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.style.opacity === '0') toast.style.display = 'none';
    }, 300);
  }, 1700);
}

function bootstrap(): void {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Canvas element #sim-canvas not found');
  }

  const sim = new SimulationCore();
  const input = new KeyboardInputManager();
  const renderer = new CanvasRenderer(canvas);
  const hud = new TelemetryHUD();

  input.attachListeners(window);

  // Footedness and Archetype Toggle Controls
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (e.code === 'KeyF') {
      sim.toggleFootedness();
    } else if (e.code === 'KeyP') {
      sim.cyclePreset();
    } else if (e.code === 'KeyB') {
      sim.cycleBallModel();
    } else if (e.code === 'KeyT') {
      const cond = sim.cycleTurfCondition();
      showToast(`🌿 Turf: ${TURF_PRESETS[cond]?.name ?? cond}`);
    } else if (e.code === 'Digit1') {
      const res = sim.requestKickPreset(1);
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
      else showToast('👟 Ground Pass Swing (Medial / Inside)');
    } else if (e.code === 'Digit2') {
      const res = sim.requestKickPreset(2);
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
      else showToast('👟 Curving Free-Kick Swing (+Sidespin)');
    } else if (e.code === 'Digit3') {
      const res = sim.requestKickPreset(3);
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
      else showToast('👟 Chipped Lob Scoop (+Backspin)');
    } else if (e.code === 'Digit4') {
      const res = sim.requestKickPreset(4);
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
      else showToast('👟 Trivela Curve Swing (Lateral / Outside)');
    } else if (e.code === 'Digit5') {
      const res = sim.requestKickPreset(5);
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
      else showToast('👟 Knuckleball Strike (Laces / Locked Ankle)');
    } else if (e.code === 'KeyR') {
      // R: Reset ball directly to player's feet
      sim.resetBall();
    } else if (e.code === 'BracketLeft') {
      // [: Lower grass cutting height (-2mm)
      const h = sim.changeGrassHeight(-2);
      showToast(`✂️ Grass Height: ${h} mm`);
    } else if (e.code === 'BracketRight') {
      // ]: Raise grass cutting height (+2mm)
      const h = sim.changeGrassHeight(2);
      showToast(`✂️ Grass Height: ${h} mm`);
    } else if (e.code === 'KeyY') {
      // Y: Toggle footwear studs (FG plastic vs SG metal)
      const st = sim.toggleStudType();
      showToast(`👟 Studs: ${st === 'fg_plastic' ? 'FG Firm Ground' : 'SG Soft Ground'}`);
    } else if (e.code === 'KeyC') {
      // C: Clear pitch damage and divots
      sim.clearPitchDamage();
      showToast('🧹 Cleared all pitch damage, divots & wear');
    } else if (e.code === 'KeyM') {
      // M: Cycle pitch surface moisture and waterlogging
      const m = sim.cycleMoisture();
      showToast(`💧 Surface Moisture: ${Math.round(m * 100)}%`);
    } else if (e.code === 'KeyG') {
      // G: Cycle pitch tier (Elite Hybrid -> Pro Sand -> Semi-Pro Loam -> Grassroots Clay)
      const tier = sim.cyclePitchTier();
      showToast(`🏟️ Pitch Tier: ${tier.name.split(' (')[0]}`);
    } else if (e.code === 'KeyN') {
      // N: Cycle rainfall & drainage (0 -> 15 -> 35 mm/h)
      const r = sim.cyclePrecipitation();
      showToast(`🌧️ Precipitation: ${r} mm/h`);
    } else if (e.code === 'KeyV') {
      // V: Cycle atmospheric wind vector and gusting
      const w = sim.cycleWind();
      showToast(`💨 Wind: ${w.speed.toFixed(0)} m/s @ ${Math.round((w.heading * 180) / Math.PI)}°`);
    } else if (e.code === 'KeyJ') {
      // J: Simulate +30 minutes of progressive match traffic wear
      sim.simulateMatchTraffic(30);
      const totalMin = sim.getSimulatedMatchMinutes();
      showToast(`⏱️ Simulated +30 min Match Traffic (Total: ${totalMin}m)`);
    } else if (e.code === 'Backquote' || e.code === 'F3') {
      // ` or F3: Toggle physical 3D colliders debug overlay
      const enabled = renderer.toggleColliders();
      showToast(enabled ? '🎯 Collider Debug Overlay: ON' : '🎯 Collider Debug Overlay: OFF');
    }
  });

  // Click on Pitch to Kick Ball toward Target
  canvas.addEventListener('click', (e: MouseEvent) => {
    const targetWorld = renderer.screenToWorld(e.clientX, e.clientY);
    const ballState = sim.getBallState();
    const dx = targetWorld.x - ballState.position.x;
    const dy = targetWorld.y - ballState.position.y;
    const dist = Math.hypot(dx, dy);
    const heading = Math.atan2(dy, dx);

    if (e.shiftKey) {
      // Shift+Click: Curving Inside-Foot Strike
      const res = sim.requestKick({
        desiredSpeed: 22,
        elevationDeg: 12,
        headingRad: heading,
        sidespinRps: 6.5,
        backspinRps: 2.0,
        contactZone: 'medial',
        ankleStiffness: 0.95,
      });
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
    } else if (e.altKey) {
      // Alt+Click: Chipped Lob
      const res = sim.requestKick({
        desiredSpeed: 17,
        elevationDeg: 26,
        headingRad: heading,
        backspinRps: 5.0,
        contactZone: 'toe',
        ankleStiffness: 0.75,
      });
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
    } else {
      // Click: Dynamic Driven Pass / Shot
      const speed = Math.min(26, Math.max(12, dist * 1.4));
      const elevation = dist > 14 ? 8 : 0;
      const res = sim.requestKick({
        desiredSpeed: speed,
        elevationDeg: elevation,
        headingRad: heading,
        contactZone: elevation > 0 ? 'instep' : 'medial',
        ankleStiffness: 0.88,
      });
      if (!res.success) showToast(`⚠️ ${res.reason}`, '#f87171');
    }
  });

  const footednessEl = document.getElementById('hud-footedness');
  if (footednessEl) {
    footednessEl.addEventListener('click', () => {
      sim.toggleFootedness();
    });
  }

  const archetypeEl = document.getElementById('hud-archetype');
  if (archetypeEl) {
    archetypeEl.addEventListener('click', () => {
      sim.cyclePreset();
    });
  }

  const ballModelEl = document.getElementById('hud-ball-model');
  if (ballModelEl) {
    ballModelEl.addEventListener('click', () => {
      sim.cycleBallModel();
    });
  }

  const turfCondEl = document.getElementById('hud-turf-cond');
  if (turfCondEl) {
    turfCondEl.addEventListener('click', () => {
      const cond = sim.cycleTurfCondition();
      showToast(`🌿 Turf: ${TURF_PRESETS[cond]?.name ?? cond}`);
    });
  }

  const grassHeightEl = document.getElementById('hud-grass-height');
  if (grassHeightEl) {
    grassHeightEl.addEventListener('click', () => {
      const currentH = sim.getGrassHeight();
      const nextH = currentH >= 34 ? 20 : currentH + 4;
      sim.setGrassHeight(nextH);
      showToast(`✂️ Grass Height: ${nextH} mm`);
    });
  }

  const studsEl = document.getElementById('hud-studs');
  if (studsEl) {
    studsEl.addEventListener('click', () => {
      const st = sim.toggleStudType();
      showToast(`👟 Studs: ${st === 'fg_plastic' ? 'FG Firm Ground' : 'SG Soft Ground'}`);
    });
  }

  const pitchDamageEl = document.getElementById('hud-pitch-damage');
  if (pitchDamageEl) {
    pitchDamageEl.addEventListener('click', (e: MouseEvent) => {
      if (e.shiftKey) {
        sim.clearPitchDamage();
        showToast('🧹 Cleared all pitch damage, divots & wear');
      } else {
        sim.simulateMatchTraffic(30);
        const totalMin = sim.getSimulatedMatchMinutes();
        showToast(`⏱️ Simulated +30 min Match Traffic (Total: ${totalMin}m)`);
      }
    });
  }

  const moistureEl = document.getElementById('hud-moisture');
  if (moistureEl) {
    moistureEl.addEventListener('click', () => {
      sim.cycleMoisture();
    });
  }

  const pitchTierEl = document.getElementById('hud-pitch-tier');
  if (pitchTierEl) {
    pitchTierEl.addEventListener('click', () => {
      sim.cyclePitchTier();
    });
  }

  const rainEl = document.getElementById('hud-rain');
  if (rainEl) {
    rainEl.addEventListener('click', () => {
      sim.cyclePrecipitation();
    });
  }

  const windEl = document.getElementById('hud-wind');
  if (windEl) {
    windEl.addEventListener('click', () => {
      sim.cycleWind();
    });
  }

  let lastTime = performance.now() / 1000;
  let accumulator = 0;
  let lastIntent: Intent = input.sampleIntent(SIM_CONFIG.LOOP.FIXED_DT);

  function loop(currentTimeMs: number): void {
    const currentTime = currentTimeMs / 1000;
    let frameDt = currentTime - lastTime;
    lastTime = currentTime;

    // Clamp frame time to prevent spiral of death on tab unfocus
    if (frameDt > 0.1) frameDt = 0.1;

    accumulator += frameDt;
    let catchupSteps = 0;

    while (
      accumulator >= SIM_CONFIG.LOOP.FIXED_DT &&
      catchupSteps < SIM_CONFIG.LOOP.MAX_CATCHUP_STEPS
    ) {
      lastIntent = input.sampleIntent(SIM_CONFIG.LOOP.FIXED_DT);
      sim.step(lastIntent, SIM_CONFIG.LOOP.FIXED_DT);
      accumulator -= SIM_CONFIG.LOOP.FIXED_DT;
      catchupSteps++;
    }

    const alpha = Math.min(1.0, accumulator / SIM_CONFIG.LOOP.FIXED_DT);
    const prevState = sim.getPreviousState();
    const currState = sim.getCurrentState();
    const prevBall = sim.getPreviousBallState();
    const currBall = sim.getBallState();
    const pitchSurface = sim.getPitchSurface();

    renderer.render(
      prevState,
      currState,
      alpha,
      lastIntent,
      prevBall,
      currBall,
      pitchSurface,
      sim.getContactBodies(),
      sim.getKickController().getLastContactMarker()
    );
    hud.update(currState, currBall, sim.getPitchSurfaceState());

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', bootstrap);
