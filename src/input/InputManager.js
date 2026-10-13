import { Vector2 } from '../math/Vector2.js';
import { PassingController } from '../physics/PassingController.js';

/**
 * Handles keyboard input, gait selection (Jockey, Run, Sprint),
 * robust shot powering with run-up execution, and ground passing.
 */
export class InputManager {
  constructor() {
    this.keys = {};
    this.moveDir = new Vector2(0, 0);
    this.activeGait = 'RUN';
    this.dribbleMode = 'CRUISE';

    this.passing = new PassingController();
    this.passTargetCandidate = null;
    this.targetedTeammate = null;
    this.onSwitchPlayer = null;
    this.onAutoSwitchOnPass = null;

    this.isChargingShot = false;
    this.shotChargeTime = 0.0;
    this.pendingShot = null;
    this.isFinesseShot = false;

    // Variable strength pass charging states
    this.isChargingPass = false;
    this.passChargeTime = 0.0;
    this.pendingPass = null;
    this.isDrivenPass = false;

    // Variable strength through ball charging states
    this.isChargingThrough = false;
    this.throughChargeTime = 0.0;
    this.pendingThrough = null;
    this.isLoftedThrough = false;

    // Variable strength lofted pass / clearance charging states
    this.isChargingLoft = false;
    this.loftChargeTime = 0.0;
    this.pendingLoft = null;
    this.isClearance = false;

    // Callbacks for toggles
    this.onToggleTurf = null;
    this.onToggleCamera = null;
    this.onResetBall = null;
    this.onToggleDrill = null;

    this.lastShiftPressTime = 0;
    this.pendingKnockOn = false;

    this.setupListeners();
  }

  setupListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }

      // Tab Key Player Switching
      if (e.code === 'Tab' || e.key === 'Tab') {
        if (this.onSwitchPlayer) {
          this.onSwitchPlayer();
        }
        return;
      }

      // PES Double-Tap Sprint Knock-On Detection (Shift-Shift)
      if (['ShiftLeft', 'ShiftRight', 'Shift'].includes(e.code) || e.key === 'Shift') {
        const now = performance.now();
        if (now - this.lastShiftPressTime < 320) {
          this.pendingKnockOn = true;
        }
        this.lastShiftPressTime = now;
      }

      this.keys[e.code] = true;
      if (e.key) {
        this.keys[e.key.toLowerCase()] = true;
      }

      // Hotkey triggers (V for Camera Mode, T for Turf, R for Reset Ball, G for Slalom Drill, Y for Orientation)
      if ((e.code === 'KeyT' || e.key === 't') && this.onToggleTurf) {
        this.onToggleTurf();
      }
      if ((e.code === 'KeyV' || e.key === 'v') && this.onToggleCamera) {
        this.onToggleCamera();
      }
      if ((e.code === 'KeyY' || e.key === 'y') && this.onToggleOrientation) {
        this.onToggleOrientation();
      }
      if ((e.code === 'Equal' || e.key === '=' || e.key === '+') && this.onZoomIn) {
        this.onZoomIn();
      }
      if ((e.code === 'Minus' || e.key === '-') && this.onZoomOut) {
        this.onZoomOut();
      }
      if ((e.code === 'KeyR' || e.key === 'r') && this.onResetBall) {
        this.onResetBall();
      }
      if ((e.code === 'KeyG' || e.key === 'g' || e.key === 'G') && this.onToggleDrill) {
        this.onToggleDrill();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.key) {
        this.keys[e.key.toLowerCase()] = false;
      }
    });

    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  isKeyActive(...keyCodes) {
    for (const k of keyCodes) {
      if (this.keys[k]) return true;
    }
    return false;
  }

  clearKey(...keyCodes) {
    for (const k of keyCodes) {
      this.keys[k] = false;
    }
  }

  update(player, ball, dt, teammates = [], environment = null) {
    // 1. Calculate desired movement direction (WACD Ergonomic Layout)
    // Pointer at D, Middle at W, Ring at A, Thumb at C / X (S and Arrows retained as fallback)
    const dir = new Vector2(0, 0);
    if (this.isKeyActive('KeyW', 'w', 'ArrowUp')) dir.y -= 1;                                      // Middle (Up)
    if (this.isKeyActive('KeyC', 'c', 'KeyX', 'x', 'KeyS', 's', 'ArrowDown')) dir.y += 1;          // Thumb (Down)
    if (this.isKeyActive('KeyA', 'a', 'ArrowLeft')) dir.x -= 1;                                    // Ring (Left)
    if (this.isKeyActive('KeyD', 'd', 'ArrowRight')) dir.x += 1;                                   // Index (Right)

    if (dir.magnitudeSq() > 0) {
      dir.normalize();
    }
    this.moveDir = dir.clone();

    // 2. PES Super Cancel Check (Shift + Space / R1 + R2)
    // Instantly breaks out of any queued shot, buffer, lock-in, or stance
    const isShiftHeld = this.isKeyActive('ShiftLeft', 'ShiftRight', 'Shift');
    const isSpaceHeld = this.isKeyActive('Space', ' ', 'ControlLeft', 'ControlRight', 'Control');
    const isSuperCancel = isShiftHeld && isSpaceHeld;

    if (isSuperCancel) {
      if (this.isChargingShot || this.pendingShot ||
          this.isChargingPass || this.pendingPass ||
          this.isChargingThrough || this.pendingThrough ||
          this.isChargingLoft || this.pendingLoft ||
          player.firstTimeBuffer || player.isHoldingTrap || player.dummyCooldown > 0) {
        this.isChargingShot = false;
        this.shotChargeTime = 0.0;
        this.pendingShot = null;
        this.isFinesseShot = false;

        this.isChargingPass = false;
        this.passChargeTime = 0.0;
        this.pendingPass = null;
        this.isDrivenPass = false;

        this.isChargingThrough = false;
        this.throughChargeTime = 0.0;
        this.pendingThrough = null;
        this.isLoftedThrough = false;

        this.isChargingLoft = false;
        this.loftChargeTime = 0.0;
        this.pendingLoft = null;
        this.isClearance = false;

        player.executeSuperCancel(ball);
      }
    }

    // 3. Determine Gait & Dribble Mode
    let gait = 'RUN';
    let dribbleMode = 'CRUISE';

    const isTrapKeyHeld = this.isKeyActive('KeyM', 'm');

    if (isSuperCancel) {
      // Super cancel gives 100% unconstrained manual locomotion
      gait = dir.magnitudeSq() > 0 ? 'SPRINT' : 'RUN';
      dribbleMode = 'CRUISE';
    } else if (isTrapKeyHeld || player.isHoldingTrap) {
      // Trap & Close Control takes priority over sprint/run locomotion
      gait = 'TRAP_HOLD';
      dribbleMode = 'CLOSE';
    } else if (isShiftHeld) {
      // Sprint (up to 8.8 m/s, plant-and-cut skids, fatigue drain)
      gait = 'SPRINT';
      dribbleMode = 'CRUISE';
    } else if (isSpaceHeld) {
      // Agile Jockey / Shield stance (3.0 m/s, nimble 180° snap, close control)
      gait = 'JOCKEY';
      dribbleMode = 'CLOSE';
    } else if (this.isKeyActive('AltLeft', 'AltRight', 'Alt')) {
      // Casual stroll (1.8 m/s)
      gait = 'WALK';
      dribbleMode = 'CLOSE';
    }

    // Knock-on burst trigger into open grass (Double-Tap Sprint or Key E)
    if (this.pendingKnockOn || this.isKeyActive('KeyE', 'e')) {
      if (player.isBallKickable(ball, 0.45)) {
        player.executeKnockOnBurst(ball, dir);
        this.pendingKnockOn = false;
        this.clearKey('KeyE', 'e');
      } else {
        dribbleMode = 'KNOCK_ON';
        this.clearKey('KeyE', 'e');
      }
    }

    this.activeGait = gait;
    this.dribbleMode = dribbleMode;

    player.dribble.setMode(dribbleMode);
    player.move(dir, gait, dt, ball);

    // 4. Distance & Biomechanical Vectors
    const distToBall = player.pos.dist(ball.pos);
    const inRunUpRange = distToBall < 3.5 && ball.z < 1.0;
    const inStrikingReach = player.isBallKickable(ball, 0.40); // within ~1.35m

    const aimDir = Vector2.fromAngle(player.heading);
    const targetDir = dir.magnitudeSq() > 0.1 ? dir.clone().normalize() : aimDir;

    // Evaluate Pass Targeting with Teammates in directional cone
    const mateList = Array.isArray(teammates) ? teammates : (teammates ? [teammates] : []);
    const targetCandidate = (mateList.length > 0)
      ? this.passing.findTarget(player, mateList, targetDir)
      : null;
    this.passTargetCandidate = targetCandidate;
    player.targetedTeammate = targetCandidate;

    let spin = 0.0;
    if (this.keys['KeyQ']) spin = -48.0; // Curl right
    if (this.keys['KeyO']) spin = 48.0;  // Curl left

    // 5. PES Dummy Reception (Shift held with NO movement, or Key N)
    const toPlayer = Vector2.subtract(player.pos, ball.pos);
    const isBallIncoming = distToBall < 1.9 && ball.vel.magnitude() > 2.0 && ball.vel.dot(toPlayer) > 0.5 && ball.z < 0.85;
    if (isBallIncoming) {
      if ((isShiftHeld && dir.magnitudeSq() === 0 && !isSuperCancel) || this.isKeyActive('KeyN', 'n')) {
        player.executeFirstTouch(ball, 'DUMMY');
        this.clearKey('KeyN', 'n');
      }
    }

    // 6. Trap & Hold (Hold M): cushions into forward pocket (0.65m), plants body into PES hopping pace.
    if (isTrapKeyHeld && !isSuperCancel) {
      if (!player.isHoldingTrap) {
        if (player.isBallTrappable(ball, 0.50)) {
          player.startTrapHold(ball);
        }
      } else {
        // While holding trap: lateral rolls and facing adjustments (do NOT burst while M is held!)
        if (this.isKeyActive('KeyL', 'l')) {
          // L key toggles lateral roll side
          const nextSide = player.trapTargetLateral <= 0 ? 1 : -1;
          player.rollTrapLateral(nextSide);
          this.clearKey('KeyL', 'l');
        } else if (this.isKeyActive('KeyA', 'a', 'ArrowLeft')) {
          player.rollTrapLateral(-1);
        } else if (this.isKeyActive('KeyD', 'd', 'ArrowRight')) {
          player.rollTrapLateral(1);
        }
      }
    } else if (player.isHoldingTrap) {
      // Releasing M key: if Sprint (Shift) is held, explode into PES burst! Otherwise release smoothly.
      if (isShiftHeld) {
        player.executeTrapBurst(ball, dir);
      } else {
        player.releaseTrap(ball);
      }
    }

    // 7. Micro-Flick (U): lifts ball ~0.73m off turf to clear tackles or set up volleys
    if (this.isKeyActive('KeyU', 'u')) {
      if (player.isBallKickable(ball, 0.40)) {
        player.executeMicroFlick(ball);
        this.clearKey('KeyU', 'u');
      }
    }

    // 8. PES Lofted Pass / Clearance with Variable Strength Charging (Hold I)
    if (this.isKeyActive('KeyI', 'i') && !isSuperCancel) {
      if (inRunUpRange || this.isChargingLoft) {
        this.isChargingLoft = true;
        this.loftChargeTime = Math.min(1.0, this.loftChargeTime + dt * 2.0);
        if (isShiftHeld) {
          this.isClearance = true;
        }
      } else if (distToBall <= 3.5 && ball.z < 1.4 && !this.isChargingLoft) {
        // Buffer one-touch first-time lofted pass or clearance!
        const isClearance = isShiftHeld;
        player.firstTimeBuffer = {
          kickType: isClearance ? 'CLEARANCE' : 'LOFT_CHIP',
          targetDir,
          power: 0.85,
          spin,
          expires: 0.70
        };
        player.notifyAction(isClearance ? '⏳ BUFFER: CLEARANCE' : '⏳ BUFFER: LOFTED PASS', '#a855f7', 0.65);
        this.clearKey('KeyI', 'i');
      }
    } else if (this.isChargingLoft) {
      // Key I released! Lock in pending lofted kick power
      const isClearance = this.isClearance || isShiftHeld;
      this.pendingLoft = {
        power: Math.max(0.18, this.loftChargeTime),
        isClearance,
        kickType: isClearance ? 'CLEARANCE' : 'LOFT_CHIP'
      };
      this.isChargingLoft = false;
      this.loftChargeTime = 0.0;
      this.isClearance = false;
    }

    // Execute pending lofted pass / clearance when within striking reach
    if (this.pendingLoft) {
      if (inStrikingReach) {
        if (this.passTargetCandidate && !this.pendingLoft.isClearance) {
          const tuned = this.passing.tunePassExecution(
            player,
            this.passTargetCandidate.receiver,
            this.pendingLoft.kickType,
            this.pendingLoft.power,
            targetDir,
            environment
          );
          player.executeKick(ball, this.pendingLoft.kickType, tuned.targetDir, this.pendingLoft.power, spin, tuned.speed, tuned.loft, tuned.backspin);
          if (this.onAutoSwitchOnPass) {
            this.onAutoSwitchOnPass(this.passTargetCandidate.receiver);
          }
        } else {
          player.executeKick(ball, this.pendingLoft.kickType, targetDir, this.pendingLoft.power, spin);
        }
        this.pendingLoft = null;
      } else if (distToBall > 4.5) {
        this.pendingLoft = null;
      }
    }

    // 9. Sole Drag-Back / Lateral Roll (L) when NOT holding trap
    if (!player.isHoldingTrap && this.isKeyActive('KeyL', 'l')) {
      if (player.isBallKickable(ball, 0.35)) {
        if (gait === 'JOCKEY' || dir.magnitudeSq() < 0.1) {
          player.executeSoleDragBack(ball);
        } else {
          player.executeSoleRoll(ball, 1);
        }
        this.clearKey('KeyL', 'l');
      }
    }

    // 10. PES Through Ball with Variable Strength Charging (Hold H)
    if (this.isKeyActive('KeyH', 'h') && !isSuperCancel) {
      if (inRunUpRange || this.isChargingThrough) {
        this.isChargingThrough = true;
        this.throughChargeTime = Math.min(1.0, this.throughChargeTime + dt * 2.0);
        if (isShiftHeld) {
          this.isLoftedThrough = true;
        }
      } else if (distToBall <= 3.5 && ball.z < 1.0 && !this.isChargingThrough) {
        // Buffer one-touch through pass!
        const isLofted = isShiftHeld;
        player.firstTimeBuffer = {
          kickType: isLofted ? 'LOFTED_THROUGH' : 'GROUND_THROUGH',
          targetDir,
          power: 0.85,
          spin,
          expires: 0.70
        };
        player.notifyAction('⏳ BUFFER: THROUGH PASS', '#38bdf8', 0.65);
        this.clearKey('KeyH', 'h');
      }
    } else if (this.isChargingThrough) {
      // Key H released! Lock in pending through ball power
      const isLofted = this.isLoftedThrough || isShiftHeld;
      this.pendingThrough = {
        power: Math.max(0.18, this.throughChargeTime),
        isLofted,
        kickType: isLofted ? 'LOFTED_THROUGH' : 'GROUND_THROUGH'
      };
      this.isChargingThrough = false;
      this.throughChargeTime = 0.0;
      this.isLoftedThrough = false;
    }

    // Execute pending through ball when within striking reach
    if (this.pendingThrough) {
      if (inStrikingReach) {
        if (this.passTargetCandidate) {
          const tuned = this.passing.tunePassExecution(
            player,
            this.passTargetCandidate.receiver,
            this.pendingThrough.kickType,
            this.pendingThrough.power,
            targetDir,
            environment
          );
          player.executeKick(ball, this.pendingThrough.kickType, tuned.targetDir, this.pendingThrough.power, spin, tuned.speed, tuned.loft, tuned.backspin);
          if (this.onAutoSwitchOnPass) {
            this.onAutoSwitchOnPass(this.passTargetCandidate.receiver);
          }
        } else {
          player.executeKick(ball, this.pendingThrough.kickType, targetDir, this.pendingThrough.power, spin);
        }
        this.pendingThrough = null;
      } else if (distToBall > 4.5) {
        this.pendingThrough = null;
      }
    }

    // 11. Shot Charging (Hold K): power run-up strike or finesse curling placement (Space + K)
    if (this.isKeyActive('KeyK', 'k') && !isSuperCancel) {
      if (inRunUpRange || this.isChargingShot) {
        this.isChargingShot = true;
        this.shotChargeTime = Math.min(1.0, this.shotChargeTime + dt * 1.5);
        if (isSpaceHeld) {
          this.isFinesseShot = true;
        }
      } else if (distToBall <= 3.5 && ball.vel.magnitude() > 1.4 && !this.isChargingShot) {
        // Buffer first-time one-touch strike!
        const isFinesse = isSpaceHeld;
        player.firstTimeBuffer = {
          kickType: isFinesse ? 'FINESSE_SHOT' : 'SHOT',
          targetDir,
          power: 0.85,
          spin: spin !== 0 ? spin : (isFinesse ? -42.0 : 0.0),
          expires: 0.70
        };
        player.notifyAction('⏳ BUFFER: 1-TOUCH STRIKE', '#ef4444', 0.65);
        this.clearKey('KeyK', 'k');
      }
    } else if (this.isChargingShot) {
      // Key K released! Lock in pending shot power
      const isFinesse = this.isFinesseShot || isSpaceHeld;
      this.pendingShot = {
        power: Math.max(0.18, this.shotChargeTime),
        spin: spin !== 0 ? spin : (isFinesse ? -42.0 : 0.0),
        kickType: isFinesse ? 'FINESSE_SHOT' : 'SHOT'
      };
      this.isChargingShot = false;
      this.shotChargeTime = 0.0;
      this.isFinesseShot = false;
    }

    // Execute pending shot when within striking reach
    if (this.pendingShot) {
      if (inStrikingReach) {
        player.executeKick(ball, this.pendingShot.kickType, targetDir, this.pendingShot.power, this.pendingShot.spin);
        this.pendingShot = null;
      } else if (distToBall > 4.5) {
        this.pendingShot = null;
      }
    }

    // 12. Ground Pass with Variable Strength Charging (Hold J) & Fake Shot Cancel
    if (this.isKeyActive('KeyJ', 'j') && !isSuperCancel) {
      if (this.pendingShot || this.isChargingShot || this.pendingLoft || this.isChargingLoft) {
        // PES Fake Shot / Fake Cross cancel feint! (Square/Circle -> Cross / K/I -> J)
        const wasLoft = this.pendingLoft || this.isChargingLoft;
        this.pendingShot = null;
        this.isChargingShot = false;
        this.shotChargeTime = 0.0;
        this.isFinesseShot = false;

        this.pendingLoft = null;
        this.isChargingLoft = false;
        this.loftChargeTime = 0.0;
        this.isClearance = false;

        if (player.isBallKickable(ball, 0.40)) {
          player.executeFirstTouch(ball, 'DIRECTIONAL', targetDir);
        }
        player.notifyAction(wasLoft ? '⚡ FAKE CROSS' : '⚡ FAKE SHOT', '#f59e0b', 0.8);
        this.clearKey('KeyJ', 'j');
      } else if (inRunUpRange || this.isChargingPass) {
        this.isChargingPass = true;
        this.passChargeTime = Math.min(1.0, this.passChargeTime + dt * 2.2);
        if (isShiftHeld) {
          this.isDrivenPass = true;
        }
      } else if (distToBall <= 3.5 && ball.vel.magnitude() > 1.5 && ball.z < 1.0 && !this.isChargingPass) {
        // Buffer first-time one-touch pass!
        const isDriven = isShiftHeld;
        player.firstTimeBuffer = {
          kickType: isDriven ? 'DRIVEN_PASS' : 'SHORT_PASS',
          targetDir,
          power: 0.85,
          spin,
          expires: 0.70
        };
        player.notifyAction('⏳ BUFFER: 1-TOUCH PASS', '#10b981', 0.65);
        this.clearKey('KeyJ', 'j');
      } else if (player.isBallTrappable(ball, 0.45) && ball.vel.magnitude() > 2.0) {
        player.executeTrap(ball, 'DIRECTIONAL', targetDir);
        this.clearKey('KeyJ', 'j');
      }
    } else if (this.isChargingPass) {
      // Key J released! Lock in pending pass power
      const isDriven = this.isDrivenPass || isShiftHeld;
      this.pendingPass = {
        power: Math.max(0.18, this.passChargeTime),
        isDriven,
        kickType: isDriven ? 'DRIVEN_PASS' : 'SHORT_PASS'
      };
      this.isChargingPass = false;
      this.passChargeTime = 0.0;
      this.isDrivenPass = false;
    }

    // Execute pending pass when within striking reach
    if (this.pendingPass) {
      if (inStrikingReach) {
        if (this.passTargetCandidate) {
          const tuned = this.passing.tunePassExecution(
            player,
            this.passTargetCandidate.receiver,
            this.pendingPass.kickType,
            this.pendingPass.power,
            targetDir,
            environment
          );
          player.executeKick(ball, this.pendingPass.kickType, tuned.targetDir, this.pendingPass.power, spin, tuned.speed, tuned.loft, tuned.backspin);
          if (this.onAutoSwitchOnPass) {
            this.onAutoSwitchOnPass(this.passTargetCandidate.receiver);
          }
        } else {
          player.executeKick(ball, this.pendingPass.kickType, targetDir, this.pendingPass.power, spin);
        }
        this.pendingPass = null;
      } else if (distToBall > 4.5) {
        this.pendingPass = null;
      }
    }
  }
}
