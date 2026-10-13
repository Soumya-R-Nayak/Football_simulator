/**
 * Real-time Telemetry and Calibration HUD.
 * Renders live sports science metrics: speeds, accelerations, roll distances,
 * turning radii, dribbling cadences, and skill variance parameters.
 */
export class TelemetryHUD {
  constructor(environment, camera, onTurfChange) {
    this.environment = environment;
    this.camera = camera;
    this.onTurfChange = onTurfChange;
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

    const pStanceEl = document.getElementById('tel-p-stance');
    if (pStanceEl) {
      const stance = player.lastStanceQuality || { powerFactor: 1.0, isOffBalance: false };
      const pct = Math.round(stance.powerFactor * 100);
      if (stance.isOffBalance || stance.powerFactor < 0.70) {
        pStanceEl.textContent = `${pct}% (Off-Balance / Scuff Risk)`;
        pStanceEl.style.color = '#ef4444';
      } else if (stance.powerFactor < 0.88) {
        pStanceEl.textContent = `${pct}% (Half-Turn Stance)`;
        pStanceEl.style.color = '#f59e0b';
      } else {
        pStanceEl.textContent = `${pct}% (Optimal Balance)`;
        pStanceEl.style.color = '#10b981';
      }
    }

    const activePlayerEl = document.getElementById('tel-active-player');
    if (activePlayerEl) {
      activePlayerEl.textContent = `#${player.number || 10} ${player.name} [Tab to Switch]`;
      activePlayerEl.style.color = '#38bdf8';
    }

    const passTargetEl = document.getElementById('tel-pass-target');
    if (passTargetEl) {
      if (player.targetedTeammate && player.targetedTeammate.receiver) {
        const tgt = player.targetedTeammate;
        const deg = Math.round(tgt.angle * 180 / Math.PI);
        passTargetEl.textContent = `🎯 #${tgt.receiver.number} ${tgt.receiver.name} (${tgt.distance.toFixed(1)}m @ ${deg}°)`;
        passTargetEl.style.color = '#10b981';
      } else {
        passTargetEl.textContent = 'None (Aim towards teammate)';
        passTargetEl.style.color = '#64748b';
      }
    }

    const pBufferEl = document.getElementById('tel-p-buffer');
    if (pBufferEl) {
      if (player.firstTimeBuffer) {
        const remaining = player.firstTimeBuffer.expires.toFixed(2);
        pBufferEl.textContent = `⚡ 1-TOUCH ${player.firstTimeBuffer.kickType.replace(/_/g, ' ')} (${remaining}s)`;
        pBufferEl.style.color = '#38bdf8';
      } else if (player.dummyCooldown > 0) {
        pBufferEl.textContent = `👟 DUMMY BALL-RUN (${player.dummyCooldown.toFixed(2)}s)`;
        pBufferEl.style.color = '#a855f7';
      } else {
        pBufferEl.textContent = 'None';
        pBufferEl.style.color = '#64748b';
      }
    }

    // Physical Profile & FM24 Attributes Telemetry
    const pProfileEl = document.getElementById('tel-p-profile');
    if (pProfileEl && player.attributes) {
      const a = player.attributes;
      pProfileEl.textContent = `${player.height.toFixed(2)}m | ${player.weight.toFixed(1)}kg (Reach: ${a.aerialReach.toFixed(2)}m)`;
    }

    const pAttrsEl = document.getElementById('tel-p-attrs');
    if (pAttrsEl && player.attributes) {
      const a = player.attributes;
      pAttrsEl.textContent = `PAC ${a.pace} | ACC ${a.acceleration} | AGI ${a.agility} | BAL ${a.balance} | STR ${a.strength} | FT ${a.firstTouch} | TEC ${a.technique} | DRI ${a.dribbling}`;
    }

    // 2. Dribble & Ball Control Telemetry
    const dribbleModeEl = document.getElementById('tel-dribble-mode');
    if (dribbleModeEl) {
      if (player.isHoldingTrap) {
        const side = player.trapLateralOffset > 0.15 ? 'RIGHT' : (player.trapLateralOffset < -0.15 ? 'LEFT' : 'CENTER');
        const hopCadence = `${player.hopFrequency.toFixed(1)}Hz`;
        const hopZ = `${(player.hopBounceZ * 100).toFixed(1)}cm`;
        dribbleModeEl.textContent = `⚡ PES HOP & ROLL (${side} | ${hopCadence} | ΔZ:${hopZ})`;
        dribbleModeEl.style.color = '#a855f7';
      } else if (player.isHopping) {
        dribbleModeEl.textContent = `⚡ CLOSE CONTROL HOP (${player.hopFrequency.toFixed(1)}Hz)`;
        dribbleModeEl.style.color = '#38bdf8';
      } else if (player.knockOnSurgeTimer > 0) {
        dribbleModeEl.textContent = '⚡ PES BURST SURGE';
        dribbleModeEl.style.color = '#f59e0b';
      } else {
        const cadence = (player.dribble && player.dribble.currentCadence) ? `${player.dribble.currentCadence.toFixed(1)}Hz` : '3.3Hz';
        dribbleModeEl.textContent = `${player.dribble.mode.replace('_', ' ')} (${cadence})`;
        dribbleModeEl.style.color = '#38bdf8';
      }
    }

    const ballStateEl = document.getElementById('tel-ball-state');
    if (ballStateEl) {
      if (player.isHoldingTrap) {
        ballStateEl.textContent = `🟢 SOLE TRAP (+0.65m | ${player.soleActiveFoot} Foot | Shift: Burst)`;
        ballStateEl.style.color = '#10b981';
      } else if (player.dribble.isBallFreeRolling) {
        ballStateEl.textContent = `🟡 FREE ROLLING (+${player.dribble.timeSinceLastTouch.toFixed(2)}s)`;
        ballStateEl.style.color = '#facc15';
      } else {
        const foot = player.dribble.lastTouchFoot;
        const surf = player.dribble.lastTouchSurface || 'OUTSIDE';
        const imp = player.dribble.lastImpulse ? ` | ${player.dribble.lastImpulse.toFixed(1)} m/s impulse` : '';
        ballStateEl.textContent = `🟢 CLEAT CONTACT (${foot} ${surf}${imp})`;
        ballStateEl.style.color = '#38bdf8';
      }
    }

    const skillLabelEl = document.getElementById('dribble-skill-val');
    if (skillLabelEl) {
      const rating = player.dribble.skillRating;
      let title = 'Pro';
      if (rating >= 92) title = 'Elite (Messi)';
      else if (rating >= 80) title = 'Good Pro';
      else if (rating >= 65) title = 'Average';
      else title = 'Clunky (Heavy Touch)';
      skillLabelEl.textContent = `${rating} - ${title}`;
    }

    // 3. Ball Dynamics Telemetry
    const ballSpeed = ball.vel.magnitude();
    const ballSpeedKmh = ballSpeed * 3.6;

    const bSpeedEl = document.getElementById('tel-b-speed');
    if (bSpeedEl) {
      bSpeedEl.textContent = `${ballSpeed.toFixed(2)} m/s (${ballSpeedKmh.toFixed(1)} km/h)`;
    }

    const bElevEl = document.getElementById('tel-b-elev');
    if (bElevEl) {
      if (ball.z > 0.02) {
        const vzStr = ball.vz >= 0 ? `+${ball.vz.toFixed(1)}` : ball.vz.toFixed(1);
        bElevEl.textContent = `${ball.z.toFixed(2)} m (Airborne: ${vzStr} m/s)`;
        bElevEl.style.color = '#38bdf8';
      } else {
        bElevEl.textContent = '0.00 m (Turf)';
        bElevEl.style.color = '#10b981';
      }
    }

    const bDistEl = document.getElementById('tel-b-dist');
    if (bDistEl) {
      bDistEl.textContent = `${ball.distanceSinceKick.toFixed(2)} m`;
    }

    const bLastKickEl = document.getElementById('tel-b-last-kick');
    if (bLastKickEl) {
      if (ball.lastKickType !== 'NONE') {
        const kickKmh = (ball.lastKickSpeed * 3.6).toFixed(1);
        bLastKickEl.textContent = `${ball.lastKickType.replace(/_/g, ' ')}: ${ball.lastKickSpeed.toFixed(1)} m/s (${kickKmh} km/h)`;
      } else {
        bLastKickEl.textContent = 'None';
      }
    }

    // 4. Environmental Telemetry
    const turfEl = document.getElementById('tel-turf');
    if (turfEl) {
      turfEl.textContent = `${this.environment.turfType} (${this.environment.cutLengthMm}mm, μr = ${this.environment.rollingResistance.toFixed(3)})`;
    }

    const windEl = document.getElementById('tel-wind');
    if (windEl) {
      const wSpeed = this.environment.windVector.magnitude();
      const deg = Math.round((this.environment.windAngle * 180) / Math.PI);
      windEl.textContent = `${wSpeed.toFixed(1)} m/s (${(wSpeed * 3.6).toFixed(1)} km/h) @ ${deg}°`;
    }

    const camEl = document.getElementById('tel-cam');
    if (camEl) {
      camEl.textContent = this.camera.mode === 'FOLLOW' ? 'Follow Cam (22 px/m)' : 'Full Pitch View';
    }
  }
}
