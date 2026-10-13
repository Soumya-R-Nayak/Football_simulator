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
 * Main Simulation Loop:
 * - Match Sandbox (2 Players: Passing, Lead Trajectories, Attentive Teammate AI)
 * - 1-Player Training Mode (Toggleable via G / UI with Slalom/Zigzag/Box obstacle cones)
 * - FM24 Physical Attributes & Dynamic Height/Weight Slider Tuning
 */
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Initialize Core Physics Systems
  const pitch = new Pitch();
  const environment = new Environment({ turfType: 'DRY', windSpeed: 2.5, windAngle: 0.4 });
  const ball = new Ball(pitch.halfLength - 2.8, pitch.halfWidth);
  const trainingCourse = new TrainingCourse();

  // Two Players: Agile Playmaker (#10 Messi) and Physical Target (#9 Haaland)
  const player1 = new PlayerEntity({
    x: pitch.halfLength - 4.0,
    y: pitch.halfWidth,
    name: 'Lionel Messi',
    number: 10,
    kitColor: '#3b82f6',
    secondaryKitColor: '#1d4ed8',
    archetype: 'MESSI',
    isControlled: true
  });

  const player2 = new PlayerEntity({
    x: pitch.halfLength + 10.0,
    y: pitch.halfWidth - 5.0,
    name: 'Erling Haaland',
    number: 9,
    kitColor: '#0ea5e9',
    secondaryKitColor: '#0369a1',
    archetype: 'HAALAND',
    isControlled: false
  });

  let activePlayer = player1;
  const players = [player1, player2];

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
      statusEl.textContent = active ? `ACTIVE (${trainingCourse.mode})` : 'OFF (Match Sandbox)';
      statusEl.style.color = active ? '#10b981' : '#64748b';
    }
  }

  function toggleTrainingDrill() {
    const active = trainingCourse.toggle();
    updateDrillUI(active);

    if (active) {
      // Isolate to 1-player testing: park player2 off pitch
      player2.pos.set(pitch.halfLength, pitch.halfWidth + 22.0);
      player2.vel.set(0, 0);
      trainingCourse.resetDrill(activePlayer, ball);
      activePlayer.notifyAction(`🚩 1-PLAYER DRILL (${trainingCourse.mode})`, '#10b981', 1.2);
    } else {
      // Restore 2-player match sandbox
      player2.pos.set(activePlayer.pos.x + 12.0, activePlayer.pos.y - 2.0);
      player2.vel.set(0, 0);
      activePlayer.notifyAction('⚽ 2-PLAYER MATCH SANDBOX', '#38bdf8', 1.0);
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
        player2.pos.set(pitch.halfLength, pitch.halfWidth + 22.0);
        player2.vel.set(0, 0);
      }
      trainingCourse.resetDrill(activePlayer, ball);
    });
  }

  function setCourseMode(mode) {
    trainingCourse.setMode(mode);
    ['slalom', 'zigzag', 'box'].forEach(m => {
      const btn = document.getElementById(`btn-course-${m}`);
      if (btn) btn.classList.toggle('active', m.toUpperCase() === mode);
    });
    if (!trainingCourse.active) {
      trainingCourse.active = true;
      player2.pos.set(pitch.halfLength, pitch.halfWidth + 25.0);
      player2.vel.set(0, 0);
    }
    updateDrillUI(true);
    trainingCourse.resetDrill(activePlayer, ball);
    activePlayer.notifyAction(`🚩 COURSE: ${mode}`, '#facc15', 1.0);
  }

  const btnSlalom = document.getElementById('btn-course-slalom');
  if (btnSlalom) btnSlalom.addEventListener('click', () => setCourseMode('SLALOM'));
  const btnZigzag = document.getElementById('btn-course-zigzag');
  if (btnZigzag) btnZigzag.addEventListener('click', () => setCourseMode('ZIGZAG'));
  const btnBox = document.getElementById('btn-course-box');
  if (btnBox) btnBox.addEventListener('click', () => setCourseMode('BOX'));

  // -------------------------------------------------------------
  // FM24 Physical Attributes & Build Sliders
  // -------------------------------------------------------------
  const archetypeMap = {
    'MESSI': 'btn-arch-messi',
    'HAALAND': 'btn-arch-haaland',
    'MBAPPE': 'btn-arch-mbappe',
    'MODRIC': 'btn-arch-modric',
    'VAN_DIJK': 'btn-arch-vandijk',
    'AMATEUR': 'btn-arch-amateur'
  };

  function highlightArchetypeButton(selectedName) {
    for (const [name, btnId] of Object.entries(archetypeMap)) {
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', name === selectedName);
    }
  }

  function syncSlidersFromPlayer(player) {
    const h = player.height;
    const w = player.weight;
    const a = player.attributes;

    const hSlider = document.getElementById('slider-height');
    const hVal = document.getElementById('val-height');
    if (hSlider) hSlider.value = h.toFixed(2);
    if (hVal) hVal.textContent = `${h.toFixed(2)} m`;

    const wSlider = document.getElementById('slider-weight');
    const wVal = document.getElementById('val-weight');
    if (wSlider) wSlider.value = w.toFixed(1);
    if (wVal) wVal.textContent = `${w.toFixed(1)} kg`;

    const attrPairs = [
      { id: 'pace', key: 'pace' },
      { id: 'accel', key: 'acceleration' },
      { id: 'agility', key: 'agility' },
      { id: 'balance', key: 'balance' },
      { id: 'jumping', key: 'jumping' },
      { id: 'stamina', key: 'stamina' },
      { id: 'strength', key: 'strength' },
      { id: 'first-touch', key: 'firstTouch' },
      { id: 'technique', key: 'technique' },
      { id: 'dribbling', key: 'dribbling' }
    ];

    for (const p of attrPairs) {
      const sl = document.getElementById(`slider-${p.id}`);
      const vl = document.getElementById(`val-${p.id}`);
      if (sl) sl.value = a[p.key];
      if (vl) vl.textContent = a[p.key];
    }
  }

  function readSlidersAndApply() {
    const height = parseFloat(document.getElementById('slider-height').value);
    const weight = parseFloat(document.getElementById('slider-weight').value);
    const pace = parseInt(document.getElementById('slider-pace').value, 10);
    const acceleration = parseInt(document.getElementById('slider-accel').value, 10);
    const agility = parseInt(document.getElementById('slider-agility').value, 10);
    const balance = parseInt(document.getElementById('slider-balance').value, 10);
    const jumping = parseInt(document.getElementById('slider-jumping').value, 10);
    const stamina = parseInt(document.getElementById('slider-stamina').value, 10);
    const strength = parseInt(document.getElementById('slider-strength').value, 10);
    const firstTouch = parseInt(document.getElementById('slider-first-touch').value, 10);
    const technique = parseInt(document.getElementById('slider-technique').value, 10);
    const dribbling = parseInt(document.getElementById('slider-dribbling').value, 10);

    document.getElementById('val-height').textContent = `${height.toFixed(2)} m`;
    document.getElementById('val-weight').textContent = `${weight.toFixed(1)} kg`;
    document.getElementById('val-pace').textContent = pace;
    document.getElementById('val-accel').textContent = acceleration;
    document.getElementById('val-agility').textContent = agility;
    document.getElementById('val-balance').textContent = balance;
    document.getElementById('val-jumping').textContent = jumping;
    document.getElementById('val-stamina').textContent = stamina;
    document.getElementById('val-strength').textContent = strength;
    document.getElementById('val-first-touch').textContent = firstTouch;
    document.getElementById('val-technique').textContent = technique;
    document.getElementById('val-dribbling').textContent = dribbling;

    const newAttrs = new PlayerAttributes({
      height,
      weight,
      attributes: { pace, acceleration, agility, balance, jumping, stamina, strength, firstTouch, technique, dribbling }
    });
    activePlayer.setAttributes(newAttrs);
    highlightArchetypeButton(null); // Custom values
  }

  const sliderIds = [
    'slider-height', 'slider-weight',
    'slider-pace', 'slider-accel', 'slider-agility',
    'slider-balance', 'slider-jumping', 'slider-stamina', 'slider-strength',
    'slider-first-touch', 'slider-technique', 'slider-dribbling'
  ];
  sliderIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', readSlidersAndApply);
  });

  // -------------------------------------------------------------
  // Camera Angle, Orientation & Height Zoom Controls
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
    activePlayer.notifyAction(`🎥 ORIENTATION: ${orient}`, '#38bdf8', 1.0);
  }

  const btnCamHoriz = document.getElementById('btn-cam-orient-horiz');
  if (btnCamHoriz) btnCamHoriz.addEventListener('click', () => setCameraOrientation('HORIZONTAL'));
  const btnCamVert = document.getElementById('btn-cam-orient-vert');
  if (btnCamVert) btnCamVert.addEventListener('click', () => setCameraOrientation('VERTICAL'));

  const btnCamBroadcast = document.getElementById('btn-cam-zoom-broadcast');
  if (btnCamBroadcast) btnCamBroadcast.addEventListener('click', () => {
    camera.setZoomLevel('BROADCAST');
    updateCameraUI();
  });
  const btnCamTele = document.getElementById('btn-cam-zoom-tele');
  if (btnCamTele) btnCamTele.addEventListener('click', () => {
    camera.setZoomLevel('TELE');
    updateCameraUI();
  });
  const btnCamClose = document.getElementById('btn-cam-zoom-close');
  if (btnCamClose) btnCamClose.addEventListener('click', () => {
    camera.setZoomLevel('CLOSE');
    updateCameraUI();
  });

  const sliderCamHeight = document.getElementById('slider-cam-height');
  if (sliderCamHeight) {
    sliderCamHeight.addEventListener('input', (e) => {
      camera.setHeightScale(parseFloat(e.target.value));
      updateCameraUI();
    });
  }

  // Hook hotkeys into input manager
  input.onToggleOrientation = () => {
    camera.toggleOrientation();
    updateCameraUI();
    activePlayer.notifyAction(`🎥 ORIENTATION: ${camera.orientation}`, '#38bdf8', 1.0);
  };
  input.onZoomIn = () => {
    camera.setHeightScale(camera.heightScale + 0.2);
    updateCameraUI();
  };
  input.onZoomOut = () => {
    camera.setHeightScale(camera.heightScale - 0.2);
    updateCameraUI();
  };
  updateCameraUI();

  function applyArchetype(name) {
    activePlayer.setArchetype(name);
    syncSlidersFromPlayer(activePlayer);
    highlightArchetypeButton(name);
  }

  for (const [name, btnId] of Object.entries(archetypeMap)) {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener('click', () => applyArchetype(name));
  }

  // Switch Active Controlled Player
  function switchPlayer(target = null) {
    const nextPlayer = target || (activePlayer === player1 ? player2 : player1);
    if (nextPlayer === activePlayer) return;

    activePlayer.isControlled = false;
    activePlayer = nextPlayer;
    activePlayer.isControlled = true;

    syncSlidersFromPlayer(activePlayer);
    highlightArchetypeButton(activePlayer === player1 ? 'MESSI' : 'HAALAND');

    if (skillSlider) skillSlider.value = activePlayer.dribble.skillRating;
    updatePresetButtons(activePlayer.dribble.skillRating);

    if (trainingCourse.active) {
      trainingCourse.resetDrill(activePlayer, ball);
    }

    activePlayer.notifyAction(`🎮 #${activePlayer.number} ${activePlayer.name}`, '#38bdf8', 0.85);
  }

  // Bind input callbacks
  input.onSwitchPlayer = () => switchPlayer();
  input.onAutoSwitchOnPass = (receiver) => switchPlayer(receiver);

  input.onToggleTurf = () => {
    environment.toggleTurf();
  };

  input.onToggleCamera = () => {
    camera.toggleMode();
  };

  input.onResetBall = () => {
    if (trainingCourse.active) {
      trainingCourse.resetDrill(activePlayer, ball);
      return;
    }
    // Place ball 0.65m in front of active player
    const offset = Vector2.fromAngle(activePlayer.heading, 0.65);
    ball.reset(activePlayer.pos.x + offset.x, activePlayer.pos.y + offset.y);
  };

  // Bind UI buttons
  const switchBtn = document.getElementById('btn-switch-player');
  if (switchBtn) switchBtn.addEventListener('click', () => switchPlayer());

  const drillShortBtn = document.getElementById('btn-drill-short');
  if (drillShortBtn) {
    drillShortBtn.addEventListener('click', () => {
      if (trainingCourse.active) toggleTrainingDrill(); // switch back to match
      player2.pos.set(player1.pos.x + 12.0, player1.pos.y - 2.0);
      player2.vel.set(0, 0);
      player2.heading = Math.PI;
      player1.heading = 0.0;
      const offset = Vector2.fromAngle(player1.heading, 0.65);
      ball.reset(player1.pos.x + offset.x, player1.pos.y + offset.y);
      player1.notifyAction('🎯 12M SHORT PASS DRILL', '#10b981', 1.0);
    });
  }

  const drillLongBtn = document.getElementById('btn-drill-long');
  if (drillLongBtn) {
    drillLongBtn.addEventListener('click', () => {
      if (trainingCourse.active) toggleTrainingDrill();
      player2.pos.set(player1.pos.x + 25.0, player1.pos.y - 6.0);
      player2.vel.set(0, 0);
      player2.heading = Math.PI;
      player1.heading = 0.0;
      const offset = Vector2.fromAngle(player1.heading, 0.65);
      ball.reset(player1.pos.x + offset.x, player1.pos.y + offset.y);
      player1.notifyAction('🚀 25M THROUGH PASS DRILL', '#38bdf8', 1.0);
    });
  }

  const turfBtn = document.getElementById('btn-toggle-turf');
  if (turfBtn) turfBtn.addEventListener('click', input.onToggleTurf);

  const camBtn = document.getElementById('btn-toggle-cam');
  if (camBtn) camBtn.addEventListener('click', input.onToggleCamera);

  const resetBtn = document.getElementById('btn-reset-ball');
  if (resetBtn) resetBtn.addEventListener('click', input.onResetBall);

  // Dribble Skill Slider & Archetype Presets
  const skillSlider = document.getElementById('skill-slider');
  const btnMessi = document.getElementById('btn-preset-messi');
  const btnPro = document.getElementById('btn-preset-pro');
  const btnAmateur = document.getElementById('btn-preset-amateur');

  function updatePresetButtons(rating) {
    if (btnMessi) btnMessi.classList.toggle('active', rating >= 95);
    if (btnPro) btnPro.classList.toggle('active', rating >= 75 && rating < 95);
    if (btnAmateur) btnAmateur.classList.toggle('active', rating < 75);
  }

  function applySkillRating(rating) {
    activePlayer.dribble.setSkill(rating);
    if (skillSlider) skillSlider.value = rating;
    updatePresetButtons(rating);
  }

  if (skillSlider) {
    skillSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      activePlayer.dribble.setSkill(val);
      updatePresetButtons(val);
    });
  }

  if (btnMessi) btnMessi.addEventListener('click', () => applySkillRating(99));
  if (btnPro) btnPro.addEventListener('click', () => applySkillRating(82));
  if (btnAmateur) btnAmateur.addEventListener('click', () => applySkillRating(50));

  updatePresetButtons(activePlayer.dribble.skillRating);
  syncSlidersFromPlayer(activePlayer);
  highlightArchetypeButton('MESSI');

  // Start in 1-Player Obstacle & Cone Training Mode by default
  trainingCourse.active = true;
  player2.pos.set(pitch.halfLength, pitch.halfWidth + 25.0);
  player2.vel.set(0, 0);
  trainingCourse.resetDrill(activePlayer, ball);
  updateDrillUI(true);

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

  // Fixed/dynamic timestep loop
  let lastTime = performance.now();

  function loop(currentTime) {
    const dt = Math.min(0.04, (currentTime - lastTime) / 1000);
    lastTime = currentTime;

    // 1. Process Input for Active Player (targeting off-ball teammates only in match mode)
    const offBallPlayers = trainingCourse.active ? [] : players.filter(p => p !== activePlayer);
    input.update(activePlayer, ball, dt, offBallPlayers, environment);

    // 2. Update Environment (wind gusts)
    environment.updateWind(dt);

    // 3. Update Off-Ball Teammates (attentive orientation, automated reception in match mode)
    if (!trainingCourse.active) {
      for (const mate of offBallPlayers) {
        const res = mate.updateTeammateAI(dt, ball, pitch, environment);
        if (res && res.receivedPass) {
          switchPlayer(mate);
        }
      }
    }

    // 4. Update Active Player Locomotion & Discrete Micro-Touch Dribbling
    activePlayer.update(dt, ball, pitch, environment, input.moveDir, input.activeGait);

    // 4.5 Update Training Course Obstacles & Cone Deflections
    if (trainingCourse.active) {
      trainingCourse.update(dt, activePlayer, ball);
    }

    // 5. Update Ball Aerodynamics & Ground Rolling Resistance
    ball.update(dt, environment, pitch);

    // 6. Update Camera
    camera.update(activePlayer, ball);

    // 7. Render Canvas (1 player when drill is active, or both players in match mode)
    const renderPlayers = trainingCourse.active ? [activePlayer] : players;
    renderer.render(renderPlayers, ball, environment, pitch, camera, input, trainingCourse);

    // 8. Update Real-time Telemetry Readout
    hud.update(activePlayer, ball);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  window.simulation = {
    pitch,
    environment,
    ball,
    player1,
    player2,
    players,
    trainingCourse,
    get activePlayer() { return activePlayer; },
    camera,
    switchPlayer,
    toggleTrainingDrill
  };
  console.log('⚽ 1-Player Training Obstacles & FM24 Telemetry Sandbox Active.');
});
