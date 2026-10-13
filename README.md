# ⚽ Realistic 2D Football Simulation & Sports Science Sandbox

A high-fidelity, physics-first 2D football (soccer) simulation engine built from the ground up with **vanilla ES Modules** (zero runtime npm dependencies) and rendered onto an HTML5 Canvas.

Unlike arcade football games where the ball is glued to player sprites via state magnets, this simulation is **grounded in real-world SI metric physics, sports biomechanics, Pro Evolution Soccer (PES) ball manipulation mechanics, and Football Manager (FM24) 1–20 attribute profiles**.

---

## 📑 Table of Contents
1. [Core Design Philosophy](#-core-design-philosophy)
2. [SI Metric Physics & Ball Aerodynamics](#-si-metric-physics--ball-aerodynamics)
3. [Locomotion, Stride Biomechanics & Gait](#-locomotion-stride-biomechanics--gait)
4. [Discrete Micro-Touch Dribbling & Plant-and-Cut](#-discrete-micro-touch-dribbling--plant-and-cut)
5. [Ball Manipulation & PES 2017 Real Touch Mechanics](#-ball-manipulation--pes-2017-real-touch-mechanics)
6. [Passing, Targeting AI & Receiving Engine](#-passing-targeting-ai--receiving-engine)
7. [FM24 Biomechanical Attributes Profile](#-fm24-biomechanical-attributes-profile)
8. [Training Sandbox & Obstacle Drills](#-training-sandbox--obstacle-drills)
9. [Camera Projection, Views & Customization](#-camera-projection-views--customization)
10. [Controls Cheat-Sheet](#-controls-cheat-sheet)
11. [Project Structure & Architecture](#-project-structure--architecture)
12. [Running & Testing](#-running--testing)

---

## 🔬 Core Design Philosophy

- **Zero "Glue" Physics**: The ball is always a 100% free rigid body with mass, radius, 3D elevation, angular spin, drag, and turf friction. Dribbling is simulated as periodic, discrete micro-kicks with realistic free-rolling phases where the ball can be tackled or intercepted.
- **Anatomical Foot Reach Envelopes**: Players can only touch the ball where their boots can physically reach. Touching behind the heels or through body boundaries is impossible.
- **PES Mechanical Depth**: Incorporates classic tactical mechanics inspired by *PES 2017 / PES 6*, such as R1/R2 *Super Cancel*, *Real Touch* hop-and-roll, stance quality degradation, one-touch action buffering, and dummy ball-runs.
- **FM24 Attributes Integration**: Player movement, turning radii, burst acceleration, reception cushions, and shot dispersion are dynamically governed by FM24 1–20 physical and technical ratings modulated by height ($m$) and weight ($kg$).

---

## 🌐 SI Metric Physics & Ball Aerodynamics

All values in the simulation are modeled in standard International System of Units (SI: meters, seconds, kilograms, Newtons, radians).

- **FIFA Quality Pro Ball Specifications**:
  - Mass: $m = 0.430\text{ kg}$
  - Circumference: $0.690\text{ m}$ (Radius $r = 0.110\text{ m}$)
  - Cross-sectional Area: $A = \pi r^2 \approx 0.038\text{ m}^2$
- **Atmospheric Drag & Wind Vectors**:
  - Air density $\rho = 1.225\text{ kg/m}^3$
  - Drag coefficient $C_d = 0.25$
  - Aerodynamic drag force: $\mathbf{F}_{\text{drag}} = \frac{1}{2} \rho C_d A \|\mathbf{v}_{\text{rel}}\| \mathbf{v}_{\text{rel}}$
  - Dynamic wind vector with periodic gust oscillation.
- **Magnus Effect (Lateral Spin Swerve)**:
  - Lift force: $\mathbf{F}_{\text{magnus}} = \frac{1}{2} \rho C_L A \|\mathbf{v}\|^2 (\hat{\boldsymbol{\omega}} \times \hat{\mathbf{v}})$
  - Imparts genuine dipping arcs on finesse strikes and curving through balls.
- **Ground Rolling Resistance & Turf Conditions**:
  - Deceleration: $a_{\text{roll}} = \mu_r \cdot g$
  - **Dry Pitch**: $\mu_r = 0.110 \implies a = 1.08\text{ m/s}^2$
  - **Wet Pitch**: $\mu_r = 0.075 \implies a = 0.74\text{ m/s}^2$ (ball skims +40% further)
  - **Long Grass**: $\mu_r = 0.180 \implies a = 1.77\text{ m/s}^2$ (rapid check-up)
- **3D Vertical Ball Elevation & Bouncing**:
  - Gravity: $g = 9.81\text{ m/s}^2$
  - Grass coefficient of restitution: $e = 0.65$
  - Backspin bite: backspin $\omega_y$ applies forward drag reduction in air and creates friction braking on turf contact.

---

## 🏃 Locomotion, Stride Biomechanics & Gait

Player movement models human locomotive limits rather than instant vector changes:

- **WACD Ergonomic Locomotion**:
  - Designed for comfortable, natural hand resting: **W** (Up), **A** (Left), **C / X** (Down), **D** (Right) using standard 4-finger resting posture. (Arrow keys and *S* are supported as fallbacks).
- **Cleat Traction & Centripetal Turning Radius**:
  - Maximum lateral acceleration: $a_{\text{lat}} = 7.2\text{ m/s}^2$ (further scaled by player Agility and height).
  - High-speed turning radius: $R = \frac{v^2}{a_{\text{lat}}}$. At top sprint ($8.8\text{ m/s}$), turning radius is $\sim 10.76\text{ m}$, preventing instantaneous 90° arcade pivoting without braking.
- **Longitudinal Acceleration & Cleat Braking**:
  - Max sprint acceleration: up to $6.6\text{ m/s}^2$ (governed by Acceleration rating & power-to-weight ratio).
  - Cleat braking deceleration: up to $-6.8\text{ m/s}^2$ with visible cleat skid damping.
- **Stride Phases & Body Lean**:
  - Animated alternating cleat articulation linked directly to gait frequency ($3.2\text{--}4.8\text{ Hz}$).
  - Torso banking lean into sharp turns and forward pitch angle during sprints.
- **Stamina & Aerobic Depletion**:
  - Sprints consume stamina proportionally to work rate; exhaustion reduces top sprint speed down to a jog ($3.5\text{ m/s}$).
  - Walking, jockeying, or idling rapidly regenerates aerobic reserve.

---

## ⚡ Discrete Micro-Touch Dribbling & Plant-and-Cut

- **Discrete Micro-Kick Engine**:
  - The ball is nudged forward into a running stride pocket ($0.35\text{m} - 0.90\text{m}$ ahead). Between touches, the ball rolls freely on the turf, vulnerable to tackling and deflection.
- **Anatomical Foot Reach Envelope**:
  - Forward reach: up to $1.05\text{ m}$ ahead (scaled by leg length/height).
  - Lateral reach: $0.65\text{ m}$ to either side.
  - Behind heels: $0\text{ m}$ reach. If the ball drops behind the feet, it cannot be kicked forward without turning around.
- **Anti-Overrun High-Control Protection**:
  - High-control dribblers (Messi, Modrić) continuously monitor the ball's position relative to their strides, taking reactive chop-steps before the ball can slip behind their boots.
- **Adaptive Stride Cadence**:
  - **Deceleration / Traffic Chop-Steps**: In tight traffic or while braking, step frequency spikes to $4.5\text{--}5.5\text{ Hz}$, drawing the ball into a tight $0.35\text{ m}$ pocket.
  - **Acceleration Elongation**: Accelerating into space opens stride time and pushes the ball further into stride.
- **Plant-and-Cut Mechanics (90° Cuts & 180° Reversals)**:
  - Initiating a sharp turn ($> 30^\circ$) triggers a physical plant-and-cut: the player plants their support cleat, absorbs momentum, and uses the outside/inside of the cutting boot to redirect the ball.
  - Exit velocity and redirection accuracy scale directly with player **Agility** and **Technique**.
- **Cleat Surface Spin Injection**:
  - Alternating contacts impart realistic physical spin: Right boot touches apply clockwise spin ($\omega_z < 0$); Left boot touches apply counter-clockwise spin ($\omega_z > 0$).
- **Knock-On Burst (Double-Tap Sprint or Key E)**:
  - Propels the ball $4\text{--}6\text{ m}$ ahead into open turf and unleashes an uninhibited sprint burst.

---

## 🪄 Ball Manipulation & PES 2017 Real Touch Mechanics

- **Trap & Hold / PES Real Touch (Hold M)**:
  - Cushions incoming or loose balls into a protected $0.65\text{ m}$ forward pocket.
  - Switches the player into a squared-up hop-and-roll cadence ($3.8\text{ Hz}$ hop frequency, $4.2\text{ cm}$ vertical bounce).
  - Supports lateral sole-rolls across the body (**A / D / L** keys) to shift angles around approaching defenders.
  - Releasing **M** while holding **Sprint** unleashes an explosive $+2.4\text{ m/s}$ burst out of the stance.
- **Directional Trapping**:
  - Cushioning and redirecting incoming passes into space in a single fluid stride.
- **Micro-Flick (Key U)**:
  - Scoops the ball $0.73\text{--}0.81\text{ m}$ into the air to clear sliding leg tackles or set up volleys.
- **Sole Drag-Back (Key J + Back)**:
  - Rolls the ball $180^\circ$ backwards underneath the cleat studs at $3.2\text{ m/s}$.
- **Chipped Scoop & Clearance (Key I / Shift + I)**:
  - Variable-power lofted passes with physical backspin that bites upon hitting the grass.
  - Shift + I triggers an emergency booming clearance ($26.0\text{ m/s}$, vertical velocity $11.0\text{ m/s}$).
- **PES Super Cancel (Shift + Space)**:
  - Instantly breaks out of any active shot charge, queued pass buffer, or locked animation, restoring immediate 100% manual locomotive control.
- **PES Action Buffering**:
  - Queue up one-touch passes, finesse shots, or clearances while the ball is still traveling toward the player.
- **PES Dummy Reception (Shift with No Movement, or Key N)**:
  - Lets an incoming pass roll through the player's legs without contact to wrong-foot defenders.

---

## 🎯 Passing, Targeting AI & Receiving Engine

- **Semi-Assisted Directional Passing Cone**:
  - Scans teammates within a directional cone ($60^\circ$ cone window, up to $35\text{ m}$) along the player's stick/aim angle.
  - Displays a real-time HUD targeting reticle and projected trajectory corridor.
- **Friction-Compensated Velocity Tuning**:
  - Calculates the exact release speed required so that after decelerating across turf friction ($\mu_r \cdot g$), the ball arrives at the receiver's feet at a comfortable reception velocity ($2.0\text{ m/s}$).
- **Through Ball Lead Calculations**:
  - Projects teammate velocity forward and leads the pass $3\text{--}7\text{ m}$ ahead into their stride.
- **Automated Teammate Reception AI**:
  - Off-ball receivers track incoming pass trajectories, orient their bodies to face the ball, cushion the incoming velocity with ankle compliance, and settle it into their stride pocket.
- **Seamless Player Switching**:
  - Pressing **Tab** or completing an assisted pass seamlessly transfers user control to the receiver.

---

## 🎛️ FM24 Biomechanical Attributes Profile

Every player is powered by a Football Manager 2024 **1–20 attribute system** coupled with physical variables:

### Morphological Variables:
- **Height ($1.60\text{ m} - 2.05\text{ m}$)**:
  - Affects Center of Mass ($CoM_z \approx 56\%$ of height) and rotational inertia ($I = m \cdot r^2$).
  - Shorter players receive an **Agility & Balance bonus**; taller players gain **Aerial Reach** and forward stride envelope reach.
- **Weight ($55\text{ kg} - 100\text{ kg}$)**:
  - Modulates power-to-weight burst acceleration ($F = m \cdot a$) and physical shielding force ($150\text{ N} - 550\text{ N}$).

### Core FM24 Attributes (1–20):
| Attribute | Primary Biomechanical Effects |
| :--- | :--- |
| **Pace** | Max terminal sprint velocity ($5.4\text{ m/s}$ up to $10.0\text{ m/s}$ / $36\text{ km/h}$). |
| **Acceleration** | Longitudinal burst rate ($2.4\text{ m/s}^2$ up to $6.6\text{ m/s}^2$), scaled by body mass. |
| **Agility** | Lateral cleat traction ($4.2\text{--}9.6\text{ m/s}^2$) and hip pivot angular speed ($12\text{--}32\text{ rad/s}$). |
| **Balance** | Stance stability floor ($0.38\text{--}0.85$) and off-balance shot/pass noise reduction. |
| **Jumping** | Vertical leap ($0.20\text{ m} - 0.90\text{ m}$), determining total aerial reach with height. |
| **Stamina** | Cardiovascular resistance to high-intensity sprint fatigue and aerobic recovery speed. |
| **Strength** | Physical shielding dominance and collision impact resistance. |
| **First Touch** | Ankle compliance coefficient ($e = 0.08$ velvet cushion vs $e = 0.50$ heavy rebound). |
| **Technique** | Directional cut angle dispersion, plant-and-cut exit velocity retention, and outside-boot efficiency. |
| **Dribbling** | Stride pocket tightness ($0.36\text{--}0.44\text{ m}$), stride cadence, and stumble suppression. |

### Iconic Archetype Presets:
- 🐐 **Lionel Messi**: $1.70\text{m}$, $72\text{kg}$ — Max Agility (20), Balance (20), First Touch (20), Technique (20), Dribbling (20).
- 🤖 **Erling Haaland**: $1.95\text{m}$, $88\text{kg}$ — Blistering Pace (19), Strength (19), Aerial Reach ($2.78\text{m}$).
- ⚡ **Kylian Mbappé**: $1.78\text{m}$, $75\text{kg}$ — Terminal $10\text{ m/s}$ Pace (20), Acceleration (20), Dribbling (19).
- 🪄 **Luka Modrić**: $1.72\text{m}$, $66\text{kg}$ — Masterful Stamina (19), Agility (19), First Touch (19), Technique (20).
- 🧱 **Virgil van Dijk**: $1.93\text{m}$, $92\text{kg}$ — Dominant Strength (20), Jumping Reach (19), High Aerial Denial.
- 👟 **Amateur**: $1.78\text{m}$, $80\text{kg}$ — Heavy touches ($e = 0.50$), slow cadence ($1.8\text{ Hz}$), high dispersion noise.

---

## 🚩 Training Sandbox & Obstacle Drills

The simulation includes a dedicated **1-Player Obstacle Training Mode** featuring real-time collision cones and drills:

- **Drill Layouts**:
  - **Slalom**: 8 cones spaced $2.5\text{ m}$ apart along midfield with dynamic S-curve guide lanes.
  - **Zig-Zag**: 6 alternating cones configured for sharp 90° plant-and-cut maneuvers.
  - **Agility Box**: 4 corner boundary cones with a central pivot obstacle.
- **Obstacle Physics**:
  - **Player-Cone Collisions**: Physical cylindrical boundary resolution with push-out and 75% brush velocity damping.
  - **Ball-Cone Deflections**: Elastic bounce ($e = 0.68$) with directional deflection and spring-damped wobble animation.
- **Drill Controls**:
  - Toggle between 1-Player Drill Mode and 2-Player Match Mode using the **G** key or UI button.
  - Instant reset back to the start gate using the **R** key.

---

## 🎥 Camera Projection, Views & Customization

The metric camera smoothly projects SI meters to canvas pixels with advanced framing and layout options:

- **Orientation Modes**:
  - **Horizontal Mode (↔️)**: Traditional side-on broadcast perspective (East-West).
  - **Vertical Mode (↕️)**: Top-to-bottom goal-to-goal view (rotated $-90^\circ$). Ideal for forward dribbling drills and finishing practice.
  - **Hotkey**: Toggle orientation anytime with **`Y`**.
- **Zoom Heights & Levels**:
  - **Broadcast** ($1.0\times$): High tactical view showing full attacking thirds.
  - **Tele** ($1.35\times$): Balanced broadcast pitch view.
  - **Close** ($1.85\times$ - Default): Intimate camera height where player footwork, ball spin, cones, and overhead badges are razor-sharp.
  - **Height Slider / Hotkeys**: Continuously adjust height zoom from $0.6\times$ to $2.8\times$ using the UI slider or **`+`** / **`-`** keys.
- **Overhead Player Notification Badges**:
  - Displays high-contrast badges for special actions: `✨ VELVET FIRST TOUCH`, `⚡ OUTSIDE-BOOT CUT`, `180° REVERSAL`, `⚠️ HEAVY RECEPTION`, `⏳ BUFFER: THROUGH PASS`.

---

## ⌨️ Controls Cheat-Sheet

| Key / Input | Action |
| :--- | :--- |
| **W, A, C / X, D** | **Ergonomic Locomotion** (W: Up, A: Left, C/X: Down, D: Right) |
| **Shift** (Held) | **Sprint** (Consumes stamina, cleat skid braking) |
| **Shift-Shift** / **E** | **Knock-On Burst** (Propels ball into space with sprint surge) |
| **Space** (Held) | **Agile Jockey / Shield Stance** (Close control, nimble turns) |
| **Shift + Space** | **PES Super Cancel** (Breaks shot charges, buffers, and stance locks) |
| **Hold M** | **PES Real Touch / Trap & Hold** (Sole trap, hop-and-roll pace) |
| **A / D / L** (while holding M) | **Lateral Sole Roll** (Rolls ball across cleats) |
| **Shift** (while releasing M) | **Explosive Trap Burst** (Bursts out of sole trap into open space) |
| **Shift (no move)** / **N** | **PES Dummy Run** (Lets incoming ball roll through legs) |
| **J** | **Grounded Pass** (Aim cone targets teammate, auto-switches) |
| **H** | **Through Ball** (Leads teammate into running corridor) |
| **Hold K** | **Shot** (Variable power bar; release to strike) |
| **Space + K** | **PES Finesse Shot** (Curling placed shot with dipping arc) |
| **I** | **Lofted Pass / Chip / Clearance** (Shift + I for booming clearance) |
| **U** | **Micro-Flick** (Scoops ball $0.75\text{ m}$ to clear tackles) |
| **Tab** | **Switch Active Player** (Manual toggle between players) |
| **G** | **Toggle Obstacle Drill** (Switch between 1P Drill & 2P Match) |
| **R** | **Reset Drill / Ball** (Teleports to drill start line) |
| **Y** | **Toggle Camera Orientation** (Side-on vs Goal-to-Goal) |
| **+ / -** | **Camera Zoom In / Out** |
| **V** | **Camera Mode** (Follow vs Full Pitch) |
| **T** | **Toggle Turf State** (Dry, Wet, Long grass) |
| **Left Click (Canvas)** | **Teleport Ball** to cursor position |

---

## 📂 Project Structure & Architecture

```text
Football/
├── index.html                   # UI layout, canvas container & telemetry cards
├── style.css                    # Obsidian theme styling, scrollable telemetry HUD
├── package.json                 # ES module package descriptor & test runner scripts
├── src/
│   ├── main.js                  # Application bootloader, game loop & UI event bus
│   ├── math/
│   │   └── Vector2.js           # 2D Vector mathematics (chainable, zero-alloc methods)
│   ├── physics/
│   │   ├── Ball.js              # 3D ball rigid body, aerodynamics, drag & Magnus effect
│   │   ├── Locomotion.js        # Cleat traction, acceleration, braking & turning radius
│   │   ├── Pitch.js             # Official IFAB pitch dimensions & boundary clamping
│   │   ├── Environment.js       # Turf friction models (Dry/Wet/Long) & wind gust vectors
│   │   ├── PlayerAttributes.js  # FM24 1-20 attributes system with height/weight scaling
│   │   ├── DribbleController.js # Discrete micro-touch cadence, cuts, & touch quality
│   │   ├── PassingController.js # Assisted targeting cone, lead calculations & AI reception
│   │   └── TrainingCourse.js    # Cones, obstacle layouts, collisions & course reset logic
│   ├── entities/
│   │   └── PlayerEntity.js      # Player state machine, body lean, traps & PES mechanics
│   ├── input/
│   │   └── InputManager.js      # WACD keyboard input, charge meters & super cancel
│   ├── renderer/
│   │   ├── Camera.js            # Metric-to-pixel projection, orientations & zoom height
│   │   └── CanvasRenderer.js    # Articulated player rendering, pitch turf & HUD badges
│   └── ui/
│       └── TelemetryHUD.js      # Real-time SI telemetry and FM24 readout sync
└── tests/                       # 100% Green Pure Node.js Test Suites
    ├── slice1_physics.test.js       # IFAB pitch, rolling friction, aerodynamics & drag
    ├── dribble_physics.test.js      # Discrete micro-touches, reach envelope & anti-overrun
    ├── manipulation_physics.test.js # Trap & hold, sole rolls, micro-flicks & scoops
    ├── pes_mechanics.test.js        # Super cancel, dummy runs, buffers & shot charging
    ├── passing_physics.test.js      # Assisted targeting, lead vectors & AI reception
    ├── attributes_physics.test.js   # FM24 attribute conversions & height/weight scaling
    └── training_course.test.js      # Obstacle generation, cone collisions & resets
```

---

## 🚀 Running & Testing

### 1. Launching Locally
Because this project uses native browser ES Modules, serve it over any local HTTP server:

```bash
# Using Python 3
python3 -m http.server 8080

# Or using Node.js
npx serve -l 8080 .
```
Then navigate to: **`http://localhost:8080`**

### 2. Running the Test Suite
All physics and biomechanical calculations are accompanied by automated unit tests that run in pure Node.js with zero dependencies:

```bash
npm test
```

All 7 test suites will execute and verify pitch geometry, ball roll standards, traction limits, micro-touch envelopes, PES mechanics, and FM24 attribute scalings.
