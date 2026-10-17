import { describe, expect, it } from 'vitest';
import { Vector2 } from '../math/Vector2';
import { SIM_CONFIG } from '../sim/config';
import { SimulationCore } from '../sim/SimulationCore';
import { Intent } from '../sim/types';

describe('Slice 1 Locomotion Trajectory Validation Benchmark', () => {
  const dt = SIM_CONFIG.LOOP.FIXED_DT;

  it('keeps walk input at the configured walking speed cap', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const walkIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'walk',
      holdFacing: false,
      manualTurn: 0,
    };

    for (let i = 0; i < 600; i++) sim.step(walkIntent, dt);

    const speed = sim.getCurrentState().velocity.length();
    expect(speed).toBeGreaterThan(SIM_CONFIG.GAIT_SPEEDS.walk - 0.05);
    expect(speed).toBeLessThanOrEqual(SIM_CONFIG.GAIT_SPEEDS.walk + 0.05);
  });

  it('keeps the default jog in the soccer jogging band with plausible contact spacing', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const jogIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    // Let the player settle at the jog speed cap before measuring foot contacts.
    for (let i = 0; i < 480; i++) sim.step(jogIntent, dt);

    let speedSum = 0;
    let cadenceSum = 0;
    let stepLengthSum = 0;
    let samples = 0;
    let contacts = 0;
    let previousFoot = sim.getCurrentState().stride.currentFoot;
    for (let i = 0; i < 240; i++) {
      sim.step(jogIntent, dt);
      const state = sim.getCurrentState();
      speedSum += state.velocity.length();
      cadenceSum += state.stride.cadence;
      stepLengthSum += state.stride.strideLength;
      samples++;
      if (state.stride.currentFoot !== previousFoot) contacts++;
      previousFoot = state.stride.currentFoot;
    }

    const meanSpeed = speedSum / samples;
    const meanCadence = cadenceSum / samples;
    const meanStepLength = stepLengthSum / samples;
    const observedCadence = contacts / (240 * dt);

    expect(meanSpeed).toBeGreaterThan(3.6);
    expect(meanSpeed).toBeLessThanOrEqual(SIM_CONFIG.GAIT_SPEEDS.jog + 0.05);
    expect(meanCadence).toBeGreaterThanOrEqual(2.3);
    expect(meanCadence).toBeLessThanOrEqual(2.8);
    expect(meanStepLength).toBeGreaterThan(1.3);
    expect(meanStepLength).toBeLessThan(1.65);
    expect(observedCadence).toBeGreaterThanOrEqual(2.3);
    expect(observedCadence).toBeLessThanOrEqual(2.8);
  });

  it('instruments standing-start 40m sprint and validates physical and numerical invariants', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    let time = 0;
    let tick = 0;
    let prevPos = sim.getCurrentState().position;
    let prevVel = sim.getCurrentState().velocity;
    let prevPlantPos: Vector2 | null = null;
    let prevPhase = sim.getCurrentState().stride.phase;

    let maxPlantDisplacementDuringStance = 0;
    let airborneGroundForceViolations = 0;
    let positionReversals = 0;
    let nonFiniteViolations = 0;
    let maxSpeedObserved = 0;

    let split10mTime: number | null = null;
    let finish40mTime: number | null = null;

    while (time <= 6.0) {
      sim.step(sprintIntent, dt);
      tick++;
      time += dt;

      const state = sim.getCurrentState();
      const pos = state.position;
      const vel = state.velocity;
      const speed = vel.length();
      const stride = state.stride;

      if (speed > maxSpeedObserved) maxSpeedObserved = speed;

      // 1. Invariant: Finite values across all state vectors
      if (
        !Number.isFinite(pos.x) ||
        !Number.isFinite(pos.y) ||
        !Number.isFinite(vel.x) ||
        !Number.isFinite(vel.y) ||
        !Number.isFinite(stride.cadence) ||
        !Number.isFinite(stride.phaseProgress)
      ) {
        nonFiniteViolations++;
      }

      // 2. Invariant: Monotonic forward progression in straight-line sprint
      if (pos.x < prevPos.x - 1e-6) {
        positionReversals++;
      }

      // 3. Invariant: Finite-difference acceleration during flight must NOT exhibit ground propulsion
      const acc = vel.sub(prevVel).scale(1 / dt);
      if (stride.phase === 'flight') {
        // In flight, plantPosition must be null
        if (stride.plantPosition !== null) {
          airborneGroundForceViolations++;
        }
        // In flight, acceleration along velocity must be <= 0 (aerodynamic drag only)
        if (speed > 1.0 && acc.dot(vel.normalize()) > 0.05) {
          airborneGroundForceViolations++;
        }
      }

      // 4. Invariant: Planted foot in world space must be stationary during stance
      if (stride.phase === 'stance' && prevPhase === 'stance') {
        if (stride.plantPosition && prevPlantPos) {
          const deltaPlant = stride.plantPosition.sub(prevPlantPos).length();
          if (deltaPlant > maxPlantDisplacementDuringStance) {
            maxPlantDisplacementDuringStance = deltaPlant;
          }
        }
      }

      if (split10mTime === null && pos.x >= 10.0) split10mTime = time;
      if (finish40mTime === null && pos.x >= 40.0) {
        finish40mTime = time;
        break;
      }

      prevPos = pos;
      prevVel = vel;
      prevPlantPos = stride.plantPosition;
      prevPhase = stride.phase;
    }

    // Assertions targeting genuine physical and numerical invariants
    expect(nonFiniteViolations).toBe(0);
    expect(positionReversals).toBe(0);
    expect(airborneGroundForceViolations).toBe(0);
    expect(maxPlantDisplacementDuringStance).toBeLessThan(1e-5);
    expect(maxSpeedObserved).toBeLessThanOrEqual(SIM_CONFIG.GAIT_SPEEDS.sprint + 0.5);

    expect(split10mTime).not.toBeNull();
    expect(finish40mTime).not.toBeNull();
    expect(split10mTime!).toBeGreaterThan(1.6);
    expect(split10mTime!).toBeLessThan(2.36);
    expect(finish40mTime!).toBeGreaterThan(4.6);
    // Measured 40m performance across a first-division professional sample: 4.877-5.766s.
    expect(finish40mTime!).toBeLessThan(5.766);
  });

  it('instruments steady-state sprinting and confirms stride phase balance and speed corridors', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Warm up to top speed (3.5s)
    let time = 0;
    while (time < 3.5) {
      sim.step(sprintIntent, dt);
      time += dt;
    }

    let steadyTicks = 0;
    let stanceTicks = 0;
    let flightTicks = 0;
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    let prevPlantPos: Vector2 | null = null;
    let prevPhase = sim.getCurrentState().stride.phase;
    let maxPlantDisplacement = 0;

    // Observe steady sprinting for 2.0s (~240 ticks)
    for (let i = 0; i < 240; i++) {
      sim.step(sprintIntent, dt);
      steadyTicks++;

      const state = sim.getCurrentState();
      const speed = state.velocity.length();
      if (speed < minSpeed) minSpeed = speed;
      if (speed > maxSpeed) maxSpeed = speed;

      if (state.stride.phase === 'stance') {
        stanceTicks++;
        if (prevPhase === 'stance' && state.stride.plantPosition && prevPlantPos) {
          const delta = state.stride.plantPosition.sub(prevPlantPos).length();
          if (delta > maxPlantDisplacement) maxPlantDisplacement = delta;
        }
      } else {
        flightTicks++;
      }

      prevPlantPos = state.stride.plantPosition;
      prevPhase = state.stride.phase;
    }

    // Invariants:
    // 1. Planted foot zero world drift during stance
    expect(maxPlantDisplacement).toBeLessThan(1e-5);

    // 2. Speed stays near the 9.4m/s terminal speed without exceeding the configured cap.
    expect(minSpeed).toBeGreaterThan(8.8);
    expect(maxSpeed).toBeLessThanOrEqual(SIM_CONFIG.GAIT_SPEEDS.sprint + 0.1);

    // 3. Both stance and flight phases occur and maintain plausible duty cycle (30% - 50% stance)
    const dutyFraction = stanceTicks / steadyTicks;
    expect(dutyFraction).toBeGreaterThan(0.30);
    expect(dutyFraction).toBeLessThan(0.50);
  });

  it('instruments sprint-to-stop braking and confirms negative work and standstill stabilization', () => {
    const sim = new SimulationCore(Vector2.zero(), 0);
    const sprintIntent: Intent = {
      moveDir: new Vector2(1, 0),
      faceDir: null,
      gait: 'sprint',
      holdFacing: false,
      manualTurn: 0,
    };

    // Accelerate to top speed
    let time = 0;
    while (time < 3.5) {
      sim.step(sprintIntent, dt);
      time += dt;
    }

    const entrySpeed = sim.getCurrentState().velocity.length();
    expect(entrySpeed).toBeGreaterThan(8.5);

    // Release movement controls -> player initiates active deceleration to standstill
    const stopIntent: Intent = {
      moveDir: Vector2.zero(),
      faceDir: null,
      gait: 'jog',
      holdFacing: false,
      manualTurn: 0,
    };

    let prevVel = sim.getCurrentState().velocity;
    let forwardAccDuringBraking = 0;
    let stoppedTickCount = 0;

    for (let i = 0; i < 360; i++) {
      sim.step(stopIntent, dt);
      const state = sim.getCurrentState();
      const vel = state.velocity;
      const speed = vel.length();

      // Finite difference acceleration along velocity
      if (prevVel.length() > 0.2) {
        const acc = vel.sub(prevVel).scale(1 / dt);
        const longAcc = acc.dot(prevVel.normalize());
        // Longitudinal acceleration must be purely decelerative (no forward acceleration)
        if (longAcc > 0.05) {
          forwardAccDuringBraking++;
        }
      }

      if (speed === 0) {
        stoppedTickCount++;
      }

      prevVel = vel;
    }

    // Invariants:
    // 1. No forward acceleration during braking
    expect(forwardAccDuringBraking).toBe(0);

    // 2. Player comes to a complete standstill
    const finalState = sim.getCurrentState();
    expect(finalState.velocity.length()).toBe(0);
    expect(finalState.stride.cadence).toBe(0);
    expect(finalState.stride.phase).toBe('stance');
    expect(stoppedTickCount).toBeGreaterThan(0);
  });
});
