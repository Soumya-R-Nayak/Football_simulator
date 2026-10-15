/**
 * Real-time Telemetry and Calibration HUD.
 * Renders live sports science metrics: speeds, accelerations, roll distances,
 * turning radii, stamina, and physical attributes.
 */
export class TelemetryHUD {
  constructor(environment, camera) {
    this.environment = environment;
    this.camera = camera;
  }

  update(player, ball) {
    // 1. Player Telemetry
    const playerSpeed = player.vel.magnitude();
    const playerSpeedKmh = playerSpeed * 3.6;

    const pSpeedEl = document.getElementById('tel-p-speed');
    if (pSpeedEl) {
      pSpeedEl.textContent = `${playerSpeed.toFixed(2)} m/s (${playerSpeedKmh.toFixed(1)} km/h)`;
    }

    const pAccelEl = document.getElementById('tel-p-accel');
    if (pAccelEl) {
      const sign = player.currentAcceleration >= 0 ? '+' : '';
      pAccelEl.textContent = `${sign}${player.currentAcceleration.toFixed(2)} m/s²`;
    }

    const pTurnEl = document.getElementById('tel-p-turn');
    if (pTurnEl) {
      pTurnEl.textContent = `${player.turningRadius.toFixed(1)} m`;
    }

    const pStaminaEl = document.getElementById('tel-p-stamina');
    if (pStaminaEl) {
      const stam = Math.round(player.locomotion.stamina);
      const jogCap = player.locomotion.getEffectiveRunSpeed().toFixed(1);
      pStaminaEl.textContent = `${stam}% (Jog: ${jogCap} m/s)`;
      pStaminaEl.style.color = stam < 30 ? '#ef4444' : (stam < 60 ? '#f59e0b' : '#ffffff');
    }

    const pStaminaBarEl = document.getElementById('tel-stamina-bar');
    if (pStaminaBarEl) {
      const stam = player.locomotion.stamina;
      pStaminaBarEl.style.width = `${stam}%`;
      pStaminaBarEl.style.backgroundColor = stam < 30 ? '#ef4444' : (stam < 60 ? '#f59e0b' : '#10b981');
    }

    const activePlayerEl = document.getElementById('tel-active-player');
    if (activePlayerEl) {
      activePlayerEl.textContent = `#${player.number || 10} ${player.name}`;
      activePlayerEl.style.color = '#38bdf8';
    }

    // Physical Profile & Attributes Telemetry
    const pProfileEl = document.getElementById('tel-p-profile');
    if (pProfileEl && player.attributes) {
      const a = player.attributes;
      pProfileEl.textContent = `${player.height.toFixed(2)}m | ${player.weight.toFixed(1)}kg (Reach: ${a.aerialReach.toFixed(2)}m)`;
    }

    const pAttrsEl = document.getElementById('tel-p-attrs');
    if (pAttrsEl && player.attributes) {
      const a = player.attributes;
      pAttrsEl.textContent = `PAC ${a.pace} | ACC ${a.acceleration} | AGI ${a.agility} | BAL ${a.balance} | STR ${a.strength} | JMP ${a.jumping} | STA ${a.stamina}`;
    }

    // 2. Ball Dynamics Telemetry
    if (ball) {
      const ballSpeed = ball.vel.magnitude();
      const ballSpeedKmh = ballSpeed * 3.6;

      const bSpeedEl = document.getElementById('tel-b-speed');
      if (bSpeedEl) {
        bSpeedEl.textContent = `${ballSpeed.toFixed(2)} m/s (${ballSpeedKmh.toFixed(1)} km/h)`;
      }

      const bElevEl = document.getElementById('tel-b-elev');
      if (bElevEl) {
        bElevEl.textContent = ball.z > 0.05
          ? `${ball.z.toFixed(2)} m (Airborne)`
          : '0.00 m (Turf)';
        bElevEl.style.color = ball.z > 0.05 ? '#38bdf8' : '#10b981';
      }

      const bDistEl = document.getElementById('tel-b-dist');
      if (bDistEl) {
        bDistEl.textContent = `${ball.distanceSinceKick.toFixed(2)} m`;
      }
    }

    // 3. Environment Telemetry
    const turfEl = document.getElementById('tel-turf');
    if (turfEl && this.environment) {
      const e = this.environment;
      turfEl.textContent = `${e.turfType} (${e.grassLengthMm}mm, μr = ${e.rollingFrictionCoeff.toFixed(3)})`;
    }

    const windEl = document.getElementById('tel-wind');
    if (windEl && this.environment) {
      const e = this.environment;
      const deg = Math.round(e.windAngle * 180 / Math.PI);
      windEl.textContent = `${e.windSpeed.toFixed(1)} m/s @ ${deg}°`;
    }

    const camEl = document.getElementById('tel-cam');
    if (camEl && this.camera) {
      camEl.textContent = this.camera.mode === 'FOLLOW' ? 'Follow Cam' : 'Full Pitch Cam';
    }
  }
}
