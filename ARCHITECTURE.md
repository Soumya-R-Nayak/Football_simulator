# 🏛️ Architecture & Sports Science Specification

A deterministic, high-fidelity 2D football simulation engine built in TypeScript. Grounded in SI metric units, biomechanics, discrete stride physics, and a strictly decoupled headless simulation core.

---

## 1. Architectural Foundations & System Invariants

### 1.1 Strict Decoupling (Headless Core vs. Renderer)
* **Simulation Core (`src/sim/`)**:
  * 100% pure TypeScript.
  * **Zero DOM, zero HTML Canvas, zero Web APIs**: No `document`, `window`, or `HTMLElement`.
  * Runs headlessly in Node.js / Vitest for algorithmic testing, physics regression tracking, and kinematics benchmarks.
* **Renderer Subsystem (`src/render/`)**:
  * Consumes simulation states strictly as read-only snapshots.
  * Never feeds state or events back into the simulation core.
  * Uses linear interpolation between physics ticks to render at variable monitor refresh rates (60 Hz, 120 Hz, 144 Hz, 240 Hz).

### 1.2 Fixed Timestep Execution ($120\text{ Hz}$)
* Fixed tick rate: $\Delta t = \frac{1}{120}\text{ s} \approx 8.333\text{ ms}$.
* Accumulator-based game loop:
  ```typescript
  accumulator += frameDeltaTime;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
    sim.step(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  const alpha = accumulator / FIXED_DT;
  renderer.render(sim.previousState, sim.currentState, alpha);
  ```
* `MAX_CATCHUP_STEPS = 5`: Clamps catch-up execution to prevent the "spiral of death" during performance spikes.

### 1.3 SI Metric Coordinate Standard
* Standard SI Units: meters ($m$), seconds ($s$), kilograms ($kg$), radians ($rad$), Newtons ($N$).
* FIFA standard pitch dimensions: $105.0\text{ m} \times 68.0\text{ m}$.
* Pitch origin $(0, 0)$ is at the center spot:
  * $+X \in [-52.5, +52.5]\text{ m}$ (points toward attacking right goal).
  * $+Y \in [-34.0, +34.0]\text{ m}$ (points toward bottom touchline).
  * Angle $\theta = 0\text{ rad}$ points along $+X$; positive rotation is clockwise.

---

## 2. The 5-Stage System Pipeline

Every tick ($8.333\text{ ms}$) processes entities through a unidirectional data flow:

```
[1. Perception] ──► [2. Decision] ──► [3. Intent] ──► [4. Locomotion] ──► [5. Physics & World]
```

1. **Perception**: Evaluates sensory context (opponent proximity, ball trajectories, pitch boundaries). For the human player, samples the smoothed input stick.
2. **Decision**: Resolves tactical choices (target movement vector, desired facing, gait).
3. **Intent**: Emits an immutable `Intent` struct describing unconstrained desires.
4. **Locomotion**: Filters `Intent` through biomechanical laws (stride cycle phase, muscle limits, traction budget, directional speed penalties, angular inertia).
5. **Physics & World Integration**: Semi-implicit Euler integration, applying turf forces and updating velocities and positions.

---

## 3. Data Contracts

### 3.1 `Intent`
```typescript
import { Vector2 } from './math/Vector2';

export type Gait = 'walk' | 'jog' | 'sprint';

export interface Intent {
  /** Normalized desired movement direction vector (magnitude in [0, 1]) */
  readonly moveDir: Vector2;
  /** Desired torso facing direction vector (null to align torso with movement) */
  readonly faceDir: Vector2 | null;
  /** Requested movement gait */
  readonly gait: Gait;
  /** Locks torso orientation to current angle when true (jockeying / backpedaling) */
  readonly holdFacing: boolean;
}
```

### 3.2 `StrideState` & Biomechanical Gait Cycle
```typescript
export type FootId = 'left' | 'right';
export type StridePhase = 'stance' | 'flight';

export interface StrideState {
  /** Active foot currently in contact or transitioning */
  currentFoot: FootId;
  /** Stance (foot planted on turf applying force) vs. Flight (both feet airborne) */
  phase: StridePhase;
  /** Progress through current phase [0.0, 1.0] */
  phaseProgress: number;
  /** Dynamic cadence in strides per second (e.g. 2.4 Hz walk up to 4.2 Hz sprint) */
  cadence: number;
  /** Dynamic stride length in meters (e.g. 0.8 m initial dig up to 2.1 m at full sprint) */
  strideLength: number;
  /** World coordinates of the planted cleat on turf (null during flight) */
  plantPosition: Vector2 | null;
  /** Lateral offset of feet relative to torso center (m) */
  stanceWidth: number;
}
```

### 3.3 `PlayerState`
```typescript
export interface PlayerState {
  readonly id: string;
  readonly position: Vector2;       // In SI meters [x, y]
  readonly velocity: Vector2;       // In m/s [vx, vy]
  readonly facing: number;          // Torso heading angle in radians [-π, π]
  readonly angularVelocity: number; // Current rotation speed in rad/s
  readonly stamina: number;         // Normalized stamina pool [0.0, 1.0]
  readonly gait: Gait;              // Active gait
  readonly stride: StrideState;     // Discrete footstep and gait state
}
```

---

## 4. Biomechanics & Locomotion Kinematics

### 4.1 Discrete Stride Simulation (The Footstep Engine)
Movement is not continuous rocket propulsion; it is driven by discrete foot-ground contacts:
1. **Stance Phase ($t_c \approx 0.10\text{--}0.20\text{ s}$)**:
   * The active foot is planted on the turf.
   * Ground Reaction Force (GRF) is applied, accelerating the center of mass forward or braking/cutting.
   * Ground contact time $t_c$ scales inversely with speed (longer contact during initial drive, short stiff contacts at top speed).
2. **Flight Phase ($t_f \approx 0.08\text{--}0.12\text{ s}$)**:
   * Both feet are airborne. Zero propulsive ground force can be generated.
   * The center of mass coasts ballistically, subject only to minimal aerodynamic drag.
   * Momentum is preserved; sharp direction changes are physically impossible until the next foot strikes turf.
3. **Micro-Surge Velocity Profile**:
   * Stance creates a realistic propulsion pulse, followed by a slight coast during flight.
   * Produces authentic micro-surges on the speed-time telemetry graph, mimicking high-speed camera tracking of elite sprinters.

### 4.2 Macroscopic Sprint Acceleration Envelope (The Morin Model)
The peak propulsive envelope toward target gait velocity follows:
$$v(t) = v_{\max}(1 - e^{-t/\tau})$$
Target propulsion acceleration per stride stance phase is bounded by:
$$\mathbf{a}_{\text{target}} = \frac{\mathbf{v}_{\text{intent}} - \mathbf{v}}{\tau}$$
* Default athlete parameters: $\tau = 1.05\text{ s}$, $v_{\text{sprint}} = 8.5\text{ m/s}$, $v_{\text{jog}} = 4.5\text{ m/s}$, $v_{\text{walk}} = 2.2\text{ m/s}$.

### 4.3 Step-Based Braking & Deceleration (Chop Steps)
Braking is strictly discrete and step-based—continuous mid-air deceleration is impossible:
1. **Flight Phase Invariance**: If intent requests a stop or reversal during a flight phase, the body continues on its ballistic trajectory until the next foot strikes turf.
2. **Braking Plant Step**: Deceleration occurs when a foot strikes the turf *ahead of the center of mass* (plant step). The cleat bites into the grass, applying an opposing Ground Reaction Force (GRF).
3. **Speed-Dependent Chop Steps**:
   * *Low speed ($< 3.5\text{ m/s}$)*: Can stop in a single firm plant step.
   * *High sprint speed ($> 6.0\text{ m/s}$)*: Stopping safely requires 2 to 3 rapid, stiff "chop/stutter steps", with each plant absorbing momentum eccentrically until full stop.

### 4.4 Directional Speed Anisotropy
Maximum achievable speed is biomechanically tied to torso and hip orientation:
* **Forward** ($\theta = 0^\circ$): $100\%$ of gait top speed (full hip extension and knee drive).
* **Lateral Shuffle / Jockey** ($\theta = 90^\circ$): $65\%$ of gait top speed (abductor/adductor limits).
* **Backward / Backpedal** ($\theta = 180^\circ$): $55\%$ of gait top speed (short backward reach).
Interpolated smoothly based on the angle between torso heading and velocity:
$$S(\theta) = \frac{1}{\sqrt{\cos^2\theta + \left(\frac{1}{0.65}\right)^2 \sin^2\theta}}$$

### 4.5 Plant-and-Cut Biomechanics (Anatomical Turning)
Rather than an abstract tire friction budget, directional changes are governed by plant-foot geometry and hip alignment:
1. **Plant-Foot Anchor**: To execute a sharp cut ($> 45^\circ$), the outside foot plants into the turf as an anchor pivot $(x_{\text{plant}}, y_{\text{plant}})$.
2. **Momentum Absorption**: The plant leg absorbs the forward momentum, causing an authentic drop in forward velocity during the cut.
3. **Hip/Torso Realignment**: The torso rotates toward the new intent vector. The swinging inside foot can only drive propulsion along the newly established hip orientation.
4. **Centripetal Arc at Speed**: When turning without a full plant-cut at high speed, body lean and cleat grip limit the maximum lateral acceleration to $a_{\text{lat\_max}} \approx 6.0\text{ m/s}^2$, naturally opening up the turning radius ($R = v^2 / a$).

### 4.6 Anatomical Reach Envelopes & Kinematic Range of Motion
Foot placement is strictly constrained by human skeletal geometry and joint limits:
1. **Local Pelvis Coordinate System**:
   * Foot coordinates are computed relative to the pelvis center in local body space rotated by torso heading $\theta$:
     $$\mathbf{p}_{\text{foot\_local}} = \mathbf{R}(-\theta) \cdot (\mathbf{p}_{\text{foot\_world}} - \mathbf{p}_{\text{pelvis}})$$
   * Fore-aft axis ($X_{\text{local}}$ aligned with facing) and lateral axis ($Y_{\text{local}}$).
2. **Inviolable Geometric Constraints**:
   * **Max Leg Reach ($L_{\max} \approx 1.05\text{ m}$)**: A foot can never plant or swing beyond maximum extended leg length $\|\mathbf{p}_{\text{foot\_local}}\| \le L_{\max}$.
   * **Fore-Aft Reach Bounds**: Strike plant reach is bounded to $[-0.8\text{ m}, +0.9\text{ m}]$ relative to center of mass.
   * **No Leg-Crossing & Stance Width**: Neutral stance width is $w_{\text{stance}} \approx 0.28\text{ m}$. Left foot $Y_{\text{local}} \in [-0.55\text{ m}, -0.05\text{ m}]$; Right foot $Y_{\text{local}} \in [+0.05\text{ m}, +0.55\text{ m}]$. Feet can never cross through each other.
   * **Torso-Pelvis Twist ($\Delta \theta \le 40^\circ$)**: Torso rotation relative to pelvic propulsion vector is anatomically bounded; lateral movement beyond twist limits forces a side-shuffle gait.
3. **Ball Interaction Readiness (Future Slices)**:
   * Sets the foundation for Slice 3 & 4: a player can only touch, trap, or kick the ball if the ball intersects the reachable envelope of the free swinging foot.

### 4.7 Torso Rotational Inertia
Torso rotational speed is clamped to $\omega_{\max} \approx 6.0\text{ rad/s}$ ($~344^\circ/\text{s}$). Facing tracks movement velocity unless `holdFacing` is active.

---

## 5. Input Subsystem (Virtual Analog Stick)

* **Sampling Decoupling**: Raw DOM keyboard events update a `Set<string>` of held keys. The simulation samples this set once per $120\text{ Hz}$ tick.
* **Virtual Analog Dynamics**:
  * **Attack Ramp**: WASD ramps up linearly from $0.0 \to 1.0$ over $100\text{ ms}$ ($\sim 12$ ticks).
  * **Zero-Crossing Reversal**: Switching to the opposite key snaps through zero in $35\text{ ms}$ ($\sim 4$ ticks) to prevent sluggishness while maintaining physical weight.
  * **Diagonal Normalization**: Multi-key inputs are clamped to unit vector length $\le 1.0$.
* **Key Mappings (`event.code`)**:
  * Movement: `KeyW`, `KeyA`, `KeyS`, `KeyD`
  * Gaits: Default `Jog`, `ShiftLeft` / `ShiftRight` = `Sprint`, `KeyZ` = `Walk`
  * Torso Lock: `Space` = `holdFacing` (locks torso heading at moment of press)
  * Dev Rotation: `ArrowLeft` / `ArrowRight` (manually rotates torso at $\omega_{\max}$)
  * Reserved for Future Slices: `KeyI`, `KeyJ`, `KeyK`, `KeyL`, `KeyU`, `KeyO`, `KeyQ`, `KeyE`, `KeyR`, `KeyF`

---

## 6. Verification, Testing & Telemetry

* **Headless 40m Sprint Benchmark**:
  * Runs headlessly in Node/Vitest over 5 simulation seconds from standstill to $40\text{ m}$.
  * Asserts $10\text{ m}$ split $\in [1.70, 1.95]\text{ s}$ and $40\text{ m}$ finish $\in [4.75, 5.25]\text{ s}$.
* **Debug Canvas Telemetry**:
  * Real-time vectors: Velocity $\mathbf{v}$ (Blue), Facing Heading (Red), Desired Intent (Dashed White).
  * Visual cleats: Left and Right foot plant markers rendered on turf during stance phase.
  * Real-time rolling speed graph ($v$ vs. $t$) displaying authentic stride micro-surges.

---

## 7. Phased Roadmap

* **Slice 1 (Current)**: Single-player locomotion with discrete strides, Morin sprint kinetics, traction budget, virtual analog input, 40m headless sprint test, and debug canvas.
* **Slice 2**: Free ball rigid body physics (aerodynamic drag, Magnus effect spin, turf rolling resistance, 3D bounce).
* **Slice 3**: Micro-touch dribbling and foot-reach envelopes anchored to the stride cycle.
* **Slice 4**: Two-player passing, trajectory interception, and first-touch cushioning.
* **Slice 5**: Perception, vision cone scanning, and pressure/shielding mechanics.
* **Slice 6**: Goalkeeper tracking, shot-stopping, and shooting mechanics.
* **Slice 7**: Full team tactical match engine (FM-style tactical adjustments).
