import { Pitch } from './physics/Pitch.js';
import { Environment } from './physics/Environment.js';
import { Ball } from './physics/Ball.js';
import { PlayerEntity } from './entities/PlayerEntity.js';
import { PlayerAttributes } from './physics/PlayerAttributes.js';
import { TrainingCourse } from './physics/TrainingCourse.js';
import { Camera } from './renderer/Camera.js';
import { CanvasRenderer } from './renderer/CanvasRenderer.js';
import { InputManager } from './input/InputManager.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';
import { Vector2 } from './math/Vector2.js';

/**
 * Main Movement Simulation Sandbox:
 * - 1-Player Focused Kinematic & Locomotion Playground
 * - Obstacle Slalom & Agility Cone Drills (Toggleable via G / UI)
 * - FM24 Physical Attributes & Height/Weight Customization Sliders
 * - Camera Controls: Horizontal/Vertical, Height Zoom
 */
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Initialize Core Systems
  const pitch = new Pitch();
  const environment = new Environment({ turfType: 'DRY', windSpeed: 2.5, windAngle: 0.4 });
  const ball = new Ball(pitch.halfLength - 2.8, pitch.halfWidth);
  const trainingCourse = new TrainingCourse();

  // Active Player: Lionel Messi preset by default
  const player = new PlayerEntity({
    x: pitch.halfLength - 4.0,
    y: pitch.halfWidth,
    name: 'Lionel Messi',
    number: 10,
    kitColor: '#3b82f6',
    secondaryKitColor: '#1d4ed8',
    archetype: 'MESSI',
    isControlled: true
  });

  const camera = new Camera(canvas, pitch);
  const renderer = new CanvasRenderer(canvas);
  const input = new InputManager();
  const hud = new TelemetryHUD(environment, camera);

  // -------------------------------------------------------------
  // Training Obstacle & Slalom Cone Drill System
  // -------------------------------------------------------------
  function updateDrillUI(active) {
    const btnToggle = document.getElementById('btn-toggle-drill');
    const statusEl = document.getElementById('tel-drill-status');
    if (btnToggle) {
      btnToggle.classList.toggle('active', active);
      btnToggle.textContent = active ? '🚩 Exit Slalom [G]' : '🚩 Toggle Slalom [G]';
    }
    if (statusEl) {
      statusEl.textContent = active ? `ACTIVE (${trainingCourse.mode})` : 'OFF (Free Pitch)';
      statusEl.style.color = active ? '#10b981' : '#64748b';
    }
  }

  function toggleTrainingDrill() {
    const active = trainingCourse.toggle();
    updateDrillUI(active);
    if (active) {
      trainingCourse.resetDrill(player, ball);
      player.notifyAction(`🚩 DRILL ACTIVE (${trainingCourse.mode})`, '#10b981', 1.2);
    } else {
      player.notifyAction('⚽ FREE MOVEMENT SANDBOX', '#38bdf8', 1.0);
    }
  }

  input.onToggleDrill = toggleTrainingDrill;
  const btnToggleDrill = document.getElementById('btn-toggle-drill');
  if (btnToggleDrill) btnToggleDrill.addEventListener('click', toggleTrainingDrill);

  const btnResetDrill = document.getElementById('btn-reset-drill');
  if (btnResetDrill) {
    btnResetDrill.addEventListener('click', () => {
      if (!trainingCourse.active) {
        trainingCourse.active = true;
        updateDrillUI(true);
      }
      trainingCourse.resetDrill(player, ball);
    });
  }

  function setCourseMode(mode) {
    trainingCourse.setMode(mode);
    ['slalom', 'zigzag', 'box'].forEach(m => {
      const btn = document.getElementById(`btn-course-${m}`);
      if (btn) btn.classList.toggle('active', m === mode.toLowerCase());
    });
    if (trainingCourse.active) {
      trainingCourse.resetDrill(player, ball);
    }
    updateDrillUI(trainingCourse.active);
  }

  const btnSlalom = document.getElementById('btn-course-slalom');
  const btnZigzag = document.getElementById('btn-course-zigzag');
  const btnBox = document.getElementById('btn-course-box');
  if (btnSlalom) btnSlalom.addEventListener('click', () => setCourseMode('SLALOM'));
  if (btnZigzag) btnZigzag.addEventListener('click', () => setCourseMode('ZIGZAG'));
  if (btnBox) btnBox.addEventListener('click', () => setCourseMode('BOX'));

  // -------------------------------------------------------------
  // FM24 Physical Attributes Sliders & Presets
  // -------------------------------------------------------------
  function syncSlidersFromPlayer(p) {
    if (!p.attributes) return;
    const a = p.attributes;

    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setVal = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setSlider('slider-height', p.height);
    setSlider('slider-weight', p.weight);
    setSlider('slider-pace', a.pace);
    setSlider('slider-accel', a.acceleration);
    setSlider('slider-agility', a.agility);
    setSlider('slider-balance', a.balance);
    setSlider('slider-jumping', a.jumping);
    setSlider('slider-stamina', a.stamina);
    setSlider('slider-strength', a.strength);

    setVal('val-height', `${p.height.toFixed(2)} m`);
    setVal('val-weight', `${p.weight.toFixed(1)} kg`);
    setVal('val-pace', a.pace);
    setVal('val-accel', a.acceleration);
    setVal('val-agility', a.agility);
    setVal('val-balance', a.balance);
    setVal('val-jumping', a.jumping);
    setVal('val-stamina', a.stamina);
    setVal('val-strength', a.strength);
  }

  function highlightArchetypeButton(archetypeName) {
    ['messi', 'haaland', 'mbappe', 'modric', 'vandijk', 'amateur'].forEach(name => {
      const btn = document.getElementById(`btn-arch-${name}`);
      if (btn) btn.classList.toggle('active', archetypeName && name.toUpperCase() === archetypeName.toUpperCase());
    });
  }

  function applyArchetype(name) {
    player.setArchetype(name);
    syncSlidersFromPlayer(player);
    highlightArchetypeButton(name);
  }

  const archetypes = ['messi', 'haaland', 'mbappe', 'modric', 'vandijk', 'amateur'];
  archetypes.forEach(name => {
    const btn = document.getElementById(`btn-arch-${name}`);
    if (btn) btn.addEventListener('click', () => applyArchetype(name));
  });

  function readSlidersAndApply() {
    const height = parseFloat(document.getElementById('slider-height')?.value || 1.70);
    const weight = parseFloat(document.getElementById('slider-weight')?.value || 72.0);
    const pace = parseInt(document.getElementById('slider-pace')?.value || 14);
    const acceleration = parseInt(document.getElementById('slider-accel')?.value || 14);
    const agility = parseInt(document.getElementById('slider-agility')?.value || 14);
    const balance = parseInt(document.getElementById('slider-balance')?.value || 14);
    const jumping = parseInt(document.getElementById('slider-jumping')?.value || 14);
    const stamina = parseInt(document.getElementById('slider-stamina')?.value || 14);
    const strength = parseInt(document.getElementById('slider-strength')?.value || 14);

    document.getElementById('val-height').textContent = `${height.toFixed(2)} m`;
    document.getElementById('val-weight').textContent = `${weight.toFixed(1)} kg`;
    document.getElementById('val-pace').textContent = pace;
    document.getElementById('val-accel').textContent = acceleration;
    document.getElementById('val-agility').textContent = agility;
    document.getElementById('val-balance').textContent = balance;
    document.getElementById('val-jumping').textContent = jumping;
    document.getElementById('val-stamina').textContent = stamina;
    document.getElementById('val-strength').textContent = strength;

    const newAttrs = new PlayerAttributes({
      height,
      weight,
      attributes: { pace, acceleration, agility, balance, jumping, stamina, strength }
    });
    player.setAttributes(newAttrs);
    highlightArchetypeButton(null);
  }

  const sliderIds = [
    'slider-height', 'slider-weight',
    'slider-pace', 'slider-accel', 'slider-agility',
    'slider-balance', 'slider-jumping', 'slider-stamina', 'slider-strength'
  ];
  sliderIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', readSlidersAndApply);
  });

  // -------------------------------------------------------------
  // Camera Controls
  // -------------------------------------------------------------
  function updateCameraUI() {
    const orientEl = document.getElementById('tel-cam-orient');
    if (orientEl) {
      orientEl.textContent = camera.orientation === 'VERTICAL'
        ? 'Vertical (Goal-to-Goal)'
        : 'Horizontal (Side-on East-West)';
    }

    const btnHoriz = document.getElementById('btn-cam-orient-horiz');
    const btnVert = document.getElementById('btn-cam-orient-vert');
    if (btnHoriz) btnHoriz.classList.toggle('active', camera.orientation === 'HORIZONTAL');
    if (btnVert) btnVert.classList.toggle('active', camera.orientation === 'VERTICAL');

    const heightValEl = document.getElementById('tel-cam-height-val');
    const heightSlider = document.getElementById('slider-cam-height');
    const valHeightLabel = document.getElementById('val-cam-height');

    if (heightValEl) {
      let desc = 'Custom';
      if (Math.abs(camera.heightScale - 1.0) < 0.05) desc = 'Broadcast';
      else if (Math.abs(camera.heightScale - 1.35) < 0.05) desc = 'Tele';
      else if (Math.abs(camera.heightScale - 1.85) < 0.05) desc = 'Close';
      heightValEl.textContent = `${desc} (${camera.heightScale.toFixed(1)}x)`;
    }
    if (heightSlider) heightSlider.value = camera.heightScale.toFixed(1);
    if (valHeightLabel) valHeightLabel.textContent = `${camera.heightScale.toFixed(1)}x`;

    const btnBroadcast = document.getElementById('btn-cam-zoom-broadcast');
    const btnTele = document.getElementById('btn-cam-zoom-tele');
    const btnClose = document.getElementById('btn-cam-zoom-close');
    if (btnBroadcast) btnBroadcast.classList.toggle('active', Math.abs(camera.heightScale - 1.0) < 0.05);
    if (btnTele) btnTele.classList.toggle('active', Math.abs(camera.heightScale - 1.35) < 0.05);
    if (btnClose) btnClose.classList.toggle('active', Math.abs(camera.heightScale - 1.85) < 0.05);
  }

  function setCameraOrientation(orient) {
    camera.setOrientation(orient);
    updateCameraUI();
    player.notifyAction(orient === 'VERTICAL' ? '↕️ VERTICAL CAM (GOAL-TO-GOAL)' : '↔️ HORIZONTAL CAM', '#38bdf8', 1.0);
  }

  function toggleCamOrientation() {
    setCameraOrientation(camera.orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL');
  }

  input.onToggleCamOrientation = toggleCamOrientation;
  const btnCamHoriz = document.getElementById('btn-cam-orient-horiz');
  const btnCamVert = document.getElementById('btn-cam-orient-vert');
  if (btnCamHoriz) btnCamHoriz.addEventListener('click', () => setCameraOrientation('HORIZONTAL'));
  if (btnCamVert) btnCamVert.addEventListener('click', () => setCameraOrientation('VERTICAL'));

  function setCameraHeight(scale) {
    camera.setHeightScale(scale);
    updateCameraUI();
  }

  const btnZoomBroadcast = document.getElementById('btn-cam-zoom-broadcast');
  const btnZoomTele = document.getElementById('btn-cam-zoom-tele');
  const btnZoomClose = document.getElementById('btn-cam-zoom-close');
  if (btnZoomBroadcast) btnZoomBroadcast.addEventListener('click', () => setCameraHeight(1.0));
  if (btnZoomTele) btnZoomTele.addEventListener('click', () => setCameraHeight(1.35));
  if (btnZoomClose) btnZoomClose.addEventListener('click', () => setCameraHeight(1.85));

  const sliderCamHeight = document.getElementById('slider-cam-height');
  if (sliderCamHeight) {
    sliderCamHeight.addEventListener('input', (e) => {
      setCameraHeight(parseFloat(e.target.value));
    });
  }

  input.onZoomIn = () => setCameraHeight(camera.heightScale + 0.15);
  input.onZoomOut = () => setCameraHeight(camera.heightScale - 0.15);

  input.onToggleCamera = () => {
    camera.mode = camera.mode === 'FOLLOW' ? 'FULL_PITCH' : 'FOLLOW';
    player.notifyAction(camera.mode === 'FOLLOW' ? '🎥 FOLLOW CAM' : '🎥 FULL PITCH CAM', '#38bdf8', 0.8);
  };
  const btnCam = document.getElementById('btn-toggle-cam');
  if (btnCam) btnCam.addEventListener('click', input.onToggleCamera);

  input.onToggleTurf = () => {
    environment.toggleTurf();
    player.notifyAction(`🌱 TURF: ${environment.turfType}`, '#10b981', 0.8);
  };
  const turfBtn = document.getElementById('btn-toggle-turf');
  if (turfBtn) turfBtn.addEventListener('click', input.onToggleTurf);

  input.onResetBall = () => {
    ball.reset(player.pos.x + 0.5, player.pos.y);
    player.notifyAction('⚽ BALL RESET', '#38bdf8', 0.8);
  };
  const resetBtn = document.getElementById('btn-reset-ball');
  if (resetBtn) resetBtn.addEventListener('click', input.onResetBall);

  // Initialize UI
  syncSlidersFromPlayer(player);
  highlightArchetypeButton('MESSI');
  trainingCourse.active = true;
  trainingCourse.resetDrill(player, ball);
  updateDrillUI(true);
  updateCameraUI();

  // Wind Slider
  const windSlider = document.getElementById('wind-slider');
  if (windSlider) {
    windSlider.addEventListener('input', (e) => {
      environment.setWind(parseFloat(e.target.value), environment.windAngle);
    });
  }

  // Right-click or Shift-click on pitch to relocate ball
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.shiftKey) {
      const rect = canvas.getBoundingClientRect();
      const worldPos = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      ball.reset(worldPos.x, worldPos.y);
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Simulation Loop
  let lastTime = performance.now();

  function loop(currentTime) {
    const dt = Math.min(0.04, (currentTime - lastTime) / 1000);
    lastTime = currentTime;

    // 1. Process Input
    input.update(player, ball, dt, environment);

    // 2. Update Environment (wind)
    environment.updateWind(dt);

    // 3. Update Player Locomotion
    player.update(dt, ball, pitch, environment, input.moveDir, input.activeGait);

    // 4. Update Obstacles / Cone Drill
    if (trainingCourse.active) {
      trainingCourse.update(dt, player, ball);
    }

    // 5. Update Ball Physics
    ball.update(dt, environment, pitch);

    // 6. Update Camera
    camera.update(player, ball);

    // 7. Render
    renderer.render([player], ball, environment, pitch, camera, input, trainingCourse);

    // 8. Update Telemetry
    hud.update(player, ball);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  window.simulation = {
    pitch,
    environment,
    ball,
    player,
    trainingCourse,
    camera,
    toggleTrainingDrill
  };
  console.log('🏃 Clean Player Movement Engine Sandbox Active.');
});
