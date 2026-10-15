# ⚽ Realistic 2D Football Simulation Engine
### Physics-First, Biomechanically Grounded Association Football Simulation

A deterministic, sports-science-driven football (soccer) simulation engine engineered in pure TypeScript. Built with a decoupled **fixed-timestep 120 Hz headless simulation core** and an interpolated **HTML5 Canvas renderer**.

Unlike arcade games that rely on artificial "magnetic glue" or pre-baked animation warps, this simulation is governed strictly by **ground reaction forces, inverted pendulum/spring-mass leg mechanics, Reynolds-number fluid aerodynamics, 3D Magnus effect tensors, and turf tribology**.

---

## 📑 Table of Contents
1. [Core Architectural Principles](#-core-architectural-principles)
2. [Simulation Roadmap & Slices](#-simulation-roadmap--slices)
3. [Slice 1: Locomotion & Physical Attributes](#-slice-1-locomotion--physical-attributes)
4. [Slice 2: 3D Aerodynamic Ball Physics Core](#-slice-2-3d-aerodynamic-ball-physics-core)
5. [Ball Models & Presets (Jabulani, Telstar, etc.)](#-ball-models--presets)
6. [Pitch Agronomy, Wear Grid & Biomechanical Slipping](#-pitch-agronomy-wear-grid--biomechanical-slipping)
7. [Environmental Physics & Pitch Quality Tiers](#-environmental-physics--pitch-quality-tiers-empirical-agronomy)
8. [Interactive Controls Cheat-Sheet](#-interactive-controls-cheat-sheet)
9. [Directory Structure](#-directory-structure)
10. [Getting Started & Testing](#-getting-started--testing)
11. [Scientific Documentation](#-scientific-documentation)

---

## 🔬 Core Architectural Principles

- **Zero "Magnetic Glue"**: The ball is a free 3D rigid body with mass, radius, inertia, 3D trajectory, rotational spin, drag, and turf friction. Dribbling and kicking occur purely through physical contacts and discrete stride impulses.
- **Strict Simulation / Presentation Decoupling**:
  - The core simulation (`src/sim/`) is 100% headless, deterministic, and free of any DOM, Canvas, or browser APIs. It runs at a fixed 120 Hz ($dt = 8.33\text{ ms}$).
  - The renderer (`src/render/`) operates independently via `requestAnimationFrame`, smoothly interpolating player and ball states via sub-tick blending factor $\alpha \in [0, 1]$.
- **Sports Science & Aerodynamic Rigor**:
  - Locomotion models ground contact phases, Morin sprint acceleration lean, axial gaze anticipation, and outside-foot cut kinematics.
  - Ball flight incorporates the Reynolds number **drag crisis**, asymmetric **knuckleball seam vortex shedding**, and non-linear **late-flight Magnus curl**.
  - Pitch physics models real-world agronomy, grass blade shearing friction, live cleat traction limits, and dynamic divot tear mechanics.

---

## 🗺️ Simulation Roadmap & Slices

```
┌────────────────────────────────────────────────────────────────────────┐
│ SLICE 1: Biomechanical Locomotion & Physical Attributes   [COMPLETED] │
│ • Inverted pendulum walking (v ≤ 2.1 m/s, 22% double support)          │
│ • Spring-mass running flight (v > 2.1 m/s, stance compression Z)       │
│ • Morin sprint forward lean & axial gaze precedence (60ms head lead)   │
│ • Bilateral foot dominance (outside plant 130% vs inside check 35%)    │
│ • 5 Athletic Archetypes & Continuous Sprint Curve Index (κ ∈ [-0.3,+0.3])│
├────────────────────────────────────────────────────────────────────────┤
│ SLICE 2: 3D Aerodynamics, Ball Presets & Pitch Agronomy   [COMPLETED] │
│ • FIFA Regulation Size 5 3D trajectory (x, y on pitch, z altitude)     │
│ • Dynamic Drag Crisis Cd(Re): subcritical (0.34) → supercritical (0.18)│
│ • Chaotic Knuckleball Seam Aerodynamics (low-spin dipole wobbles)      │
│ • Non-linear spin ratio S = rω/v producing dramatic "late curl"        │
│ • Inelastic turf bounce decay & tangential spin-momentum exchange      │
│ • Multi-Ball Models: Modern Match, Jabulani 2010, Telstar, Futsal, etc.│
│ • Dynamic Turf Conditions: Standard, Wet Slick (watered), Dry Heavy    │
│ • Grass Height Agronomy (18–36mm) & 0.5m Spatial Wear/Divot Grid       │
│ • Dynamic Surface Moisture (10–90%), Standing Puddles & Hydroplaning   │
│ • Controlled Ground Slides (E key) & Directional Cleat Rut Furrows     │
│ • Pitch-Coupled Fatigue: Heavy mud/tall grass accelerates stamina drain │
│ • Biomechanical Slipping (Traction Demand, FG vs SG Studs, Wipeout)   │
├────────────────────────────────────────────────────────────────────────┤
│ SLICE 3: First Touch & Ball Manipulation Physics         [NEXT UP]     │
│ • Physical body & cleat collision cylinder (no phasing through ball)   │
│ • Stride-cycle dribbling touches (tight walk/jog vs sprint knock-on)   │
│ • First touch cushion physics based on Agility, Balance & Weak Foot    │
│ • Contextual body shielding & ball trapping                            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🏃 Slice 1: Locomotion & Physical Attributes

### Biomechanical Locomotion Mechanics
1. **Inverted Pendulum Walking ($v \le 2.1\text{ m/s}$)**:
   - Zero flight phase; continuous double-support stance ($22\%$ overlap at heel strike).
   - Pelvic rotation and sinusoidal lateral COM sway ($\pm 3.2\text{ cm}$).
2. **Spring-Mass Flight Running ($v > 2.1\text{ m/s}$)**:
   - Dynamic stance compression and ballistic airborne flight phase ($45\%$ of cycle).
   - Cadence scales dynamically ($2.8\text{ Hz}$ jog $\rightarrow 4.4\text{ Hz}$ sprint).
3. **Morin Sprint Acceleration Lean**:
   - Low-speed blastoff forward pitch ($20.5\text{ cm}$ head forward offset) righting to an upright posture ($2.8\text{ cm}$) at high speed.
4. **Axial Gaze Precedence**:
   - Visual scanning anticipation: head yaw leads torso into turns by up to $16^\circ$ ($0.28\text{ rad}$) with a $\approx 60\text{ ms}$ anticipatory lead time.
5. **Bilateral Foot Dominance & Weak-Foot Asymmetry**:
   - Outside-foot plant produces $130\%$ maximum lateral grip impulse for explosive redirection.
   - Inside check-step produces $35\%$ checked braking.
   - Weak foot ability scales outside-foot grip from $84\%$ (1-star) to $100\%$ (5-star ambipedal).

### Continuous Sprint Curve Index ($\kappa$)
Rather than hardcoding arbitrary discrete speed boost modes, player acceleration profiles are modeled by a continuous **Sprint Curve Index ($\kappa \in [-0.30, +0.30]$)** derived from anthropometric power-to-weight leverage:

$$a(v) = a_0 \cdot \left(1 - \frac{v}{v_{\text{max}}}\right) \cdot \left[1 + \kappa \cdot \left(1 - 2\frac{v}{v_{\text{max}}}\right)\right]$$

- **Explosive Burst ($\kappa > 0$)**: Front-loaded thrust for rapid initial blastoff ($0\text{--}15\text{ m}$).
- **Controlled Linear ($\kappa = 0$)**: Standard elite linear force decay.
- **Sustained Lengthy ($\kappa < 0$)**: Inverted pendulum mid-phase thrust sustained into top-speed sprinting ($20\text{--}40\text{ m}$).
- **Energy Invariance Proof**: $\int_0^1 (1 - 2u)\,du = 0$ guarantees that $\kappa$ purely redistributes propulsive work across speed bands with zero synthetic energy inflation.

---

## ⚽ Slice 2: 3D Aerodynamic Ball Physics Core

### Aerodynamics & Ball Trajectory
- **Dynamic Drag Crisis ($C_d(Re)$)**:
  Boundary layer transitions from laminar subcritical flow ($C_d \approx 0.32\text{--}0.38$) down to turbulent supercritical flow ($C_d \approx 0.15\text{--}0.22$) across critical speed $v_c$. Long strikes maintain piercing velocity initially, then brake abruptly as speed falls into the subcritical regime.
- **Chaotic Knuckleball Seam Aerodynamics**:
  When struck at high speed ($v > 18\text{ m/s}$) with near-zero rotational spin ($|\vec{\omega}| < 0.95\text{ RPS}$), boundary layer separation is dictated by the stitched seam profile, shedding vortices at Strouhal frequency ($f_{\text{St}} \approx 15\text{--}25\text{ Hz}$) that produce erratic mid-air lateral force wobbles.
- **Non-Linear Spin Ratio ($S = \frac{r\omega}{v}$) & Late-Flight Curl**:
  Lift coefficient $C_L(S) = \frac{S}{0.35 + 1.25S} \cdot C_{L,\text{max}} \cdot \text{magnusGain}$. As forward speed $v$ decelerates faster than spin decays, $S$ rises along the flight path, reproducing authentic late-curving free-kicks.
- **Turf Restitution & Momentum Transfer**:
  Normal bounce restitution ($e_{\text{turf}} = 0.65$) settles within 8 bounces. Tangential contact slip couples with rotational spin: topspin accelerates forward while backspin checks up on impact.

---

## 🏆 Ball Models & Presets

Toggle active match balls via <kbd>B</kbd> or clicking the **Ball Model** HUD row:

| Ball Model | Mass | Critical Speed ($v_c$) | Seam Volatility | Characteristics |
| :--- | :---: | :---: | :---: | :--- |
| **Modern Match** *(Nike Flight / Al Rihla)* | $0.430\text{ kg}$ | $19.5\text{ m/s}$ | Low ($0.20$) | Aerowsculpt micro-grooves. Balanced, predictable flight and sharp late-bend curl. |
| **Adidas Jabulani** *(2010 World Cup)* | $0.438\text{ kg}$ | **$25.5\text{ m/s}$** | **High ($0.88$)** | Radically smooth 8-panel sphere. Delayed drag crisis and violent knuckleball swerve. |
| **Classic Telstar** *(1970 32-Panel)* | $0.440\text{ kg}$ | $16.5\text{ m/s}$ | Minimal ($0.08$) | 32 hand-stitched panels. Early drag transition and rock-solid stable trajectories. |
| **Futsal Pro** *(Low-Bounce)* | $0.445\text{ kg}$ | $18.0\text{ m/s}$ | Low ($0.15$) | Heavily damped restitution ($e = 0.42$), minimal bounce height, tight turf roll. |
| **Retro 1966** *(Raw Heavy Leather)* | $0.468\text{ kg}$ | $17.0\text{ m/s}$ | Moderate ($0.18$) | Heavy 18-strip stitched leather with vintage laces and authentic thud. |

---

## 🌱 Pitch Agronomy, Wear Grid & Biomechanical Slipping

The pitch is not a static flat texture—it is a dynamic, living surface with agronomic properties, turf damage mechanics, and biomechanical traction limits.

### 1. Grass Cutting Height & Agronomy ($18\text{--}36\text{ mm}$)
- **Ball Rolling Resistance**:
  Ball rolling friction $\mu_{\text{roll}}(h)$ scales linearly with grass blade height:
  $$\mu_{\text{roll}}(h) = \mu_{\text{base}} \cdot [1 + 0.035 \cdot (h - 24)]$$
  Short tournament cuts ($20\text{ mm}$) yield fast, slick passing ($\approx 52\text{ m}$ roll distance), whereas tall unkept grass ($36\text{ mm}$) aggressively leeches kinetic energy ($\approx 36\text{ m}$ roll distance).
- **Cleat Grip & Shearing**:
  Turf shear strength peaks at regulation $24\text{ mm}$, falling off quadratically if cut too short (scalped roots) or overgrown:
  $$f_{\text{grass}}(h) = 1.0 - 0.0008 \cdot (h - 24)^2$$

### 2. Spatial Wear Grid ($0.5\text{ m}$ Cells) & Dynamic Divots
- **High-Resolution Wear Grid**:
  A compact $0.5\text{ m}$ resolution headless wear grid ($230 \times 156 = 35,880$ cells stored in a `Float32Array`) tracks surface degradation over time from footsteps and high-intensity maneuvers.
- **Divot Formation**:
  When a player executes an aggressive plant-and-cut turn ($\|\vec{a}\| > 7.5\text{ m/s}^2$) on damp or worn turf, the sod tears, excavating a persistent directional **divot scar** ($0.15\text{--}0.26\text{ m}$ radius) with an exposed soil core and displaced turf tufts.
- **Divot Ball Collisions**:
  Rolling balls crossing a divot undergo deterministic collision physics: the rim dip and lip eject the ball vertically ($\Delta v_z \approx 0.20\text{--}0.45\text{ m/s}$ micro-bob) and apply a lateral deflection twitch, transitioning rolling balls into a brief ballistic bounce.

### 3. Biomechanical Traction Demand & Footwear Studs
- **Traction Demand ($G$-forces)**:
  $$\text{Demand} = \frac{\|\vec{a}_{\text{target}}\|}{g}$$
- **Available Traction Limit ($TC_{\text{avail}}$)**:
  $$TC_{\text{avail}} = 1.25 \cdot \text{TurfFactor} \cdot \text{StudFactor} \cdot f_{\text{grass}}(h) \cdot (1 - 0.45 \cdot \text{Wear}) \cdot \text{DivotPenalty}$$
- **Footwear Stud Systems (<kbd>Y</kbd>)**:
  - **Firm Ground (FG Plastic)**: Molded TPU studs for dry/standard pitches. On **Wet Slick** turf, grip degrades to $0.72\times$, causing severe loss of traction during sharp cuts.
  - **Soft Ground (SG Metal)**: 6 long interchangeable aluminum/magnesium studs penetrate deep into saturated soil, holding $1.35\times$ grip on wet turf ($+35\%$ grip over baseline) to prevent slipping.
- **Slip Severity Tiers**:
  - **Micro-Slip** ($\text{Demand} \le 1.35 \cdot TC_{\text{avail}}$): An unstable stumble; propulsion force is clamped and the player quickly regains footing ($0.15\text{--}0.25\text{ s}$).
  - **Wipeout** ($\text{Demand} > 1.35 \cdot TC_{\text{avail}}$): Complete catastrophic traction blowout; the player falls into an uncontrolled prone slide governed by body sliding friction ($\mu_{\text{slide}} = 0.35$). Prone recovery duration scales inversely with player **Balance** attribute ($50\text{ Balance} \approx 0.58\text{ s}$ vs. $95\text{ Balance} \approx 0.45\text{ s}$).

### 4. Dynamic Surface Moisture, Standing Puddles & Ball Hydrodynamics
- **Continuous Moisture Gradient ($m \in [0.10, 0.90]$)**:
  Pitch surface moisture is tracked across the $0.5\text{ m}$ spatial grid. It can be cycled via <kbd>M</kbd> or HUD clicks across four distinct hydrological stages:
  1. **Dry Turf ($10\%$)**: High friction, firm soil, zero standing water.
  2. **Damp Turf ($30\%$)**: Ideal matchday pre-watered condition with balanced shear.
  3. **Wet Slick ($65\%$)**: Surface saturated; slick passing skid, heightened traction hazard for FG studs.
  4. **Waterlogged / Puddles ($90\%$)**: Extreme saturation with deep standing water pockets ($r = 2.4\text{--}4.5\text{ m}$) spawned dynamically in goalmouths, center circle, and touchlines.
- **Hydrodynamic Displacement Drag & Hydroplaning**:
  Rolling balls entering puddles ($m \ge 0.65$) experience fluid displacement resistance scaling with velocity squared ($F_{\text{water}} \propto v^2$), cutting roll distance drastically ($\approx 14\text{ m}$ vs $\approx 48\text{ m}$ on standard turf). High-speed passes ($v \ge 14\text{ m/s}$) trigger brief **hydroplaning skimming** where surface tension prevents immediate sinking before rapidly braking.
- **Turf Splash Bounce Damping**:
  Ball-turf impacts inside puddles experience water damping, lowering rebound apex by up to $35\%$ ($e_{\text{wet}} = e_{\text{base}} \cdot [1 - 0.35 \cdot (m - 0.65)]$).

### 5. Controlled Ground Slide Mechanics & Directional Cleat Ruts (<kbd>E</kbd>)
- **Controlled Slide Mechanics**:
  Pressing <kbd>E</kbd> while moving at speed ($v > 2.8\text{ m/s}$) triggers an intentional ground slide tackle.
  - Slide duration and travel distance are governed by turf kinetic friction $\mu_k$: slides extend up to $9.91\text{ m}$ on wet turf compared to $6.11\text{ m}$ on dry turf.
  - The player's vertical center-of-mass drops into a prone posture ($-0.15\text{ m}$), with the torso leaning forward along the slide direction vector.
- **Directional Cleat Rut Furrows**:
  As the player's cleats drag through the pitch during a slide, they carve a persistent **Pitch Rut** ($0.18\text{ m}$ width, $0.03\text{ m}$ trench depth) with an exposed dark subsoil core and elevated displacement berms.
- **Ball & Foot Traversal over Ruts**:
  - Rolling balls crossing a cleat rut encounter vertical micro-bobs ($\Delta v_z \approx 0.16\text{--}0.36\text{ m/s}$) and deterministic angular deflection twitches.
  - Sprinting players stepping on rut furrows suffer a $20\%$ traction penalty hazard, increasing slip probability.

### 6. Pitch-Coupled Metabolic Work & Locomotion Fatigue
- **Pitch Resistance Multiplier ($\Phi_{\text{pitch}}$)**:
  Running on heavy mud, saturated soil, tall grass, or chewed-up turf requires significantly greater mechanical work per stride:
  $$\Phi_{\text{pitch}} = 1.0 + 0.40 \cdot m + 0.35 \cdot \text{GrassWork} + 0.50 \cdot \text{Wear}$$
  On waterlogged, unkept turf, the metabolic drain rate accelerates up to **$2.14\times\text{--}2.20\times$** baseline sprint expenditure.
- **Fatigue Performance Degradation**:
  When stamina drops below critical threshold ($< 0.35$):
  - **Top Speed Clamping**: Degrades up to $18\%$ ($v_{\text{max}} = v_{\text{base}} \cdot [0.82 + 0.18 \cdot \frac{\text{stamina}}{0.35}]$).
  - **Acceleration Penalty**: Propulsive thrust drops up to $22\%$.
  - **Traction Stability Loss**: Muscular stabilizer fatigue penalizes available traction by $15\%$, making exhausted players more susceptible to slips.

---

## 🌍 Environmental Physics & Pitch Quality Tiers (Empirical Agronomy)

Governed by empirical sports agronomy standards from the **Sports Turf Research Institute (STRI)**, the **USGA Green Section**, and the **FIFA Quality Programme for Football Turf**.

### 1. Pitch Quality Tiers & Drainage Hydrology (<kbd>G</kbd>, <kbd>N</kbd>)
Club finances and stadium infrastructure dictate the rootzone engineering and hydraulic evacuation capacity:
- **Tier 1: Elite Hybrid Pitch (UEFA Champions League / Premier League)**:
  - Engineered $95\%$ USGA silica sand rootzone reinforced with $5\%$ Desso GrassMaster / SISGrass stitched polyethylene fibers.
  - SubAir active vacuum aeration drainage delivering **$80\text{ mm/h}$** extraction capacity ($50\text{ mm/h}$ gravity $+ 30\text{ mm/h}$ negative-pressure suction).
  - Evacuates torrential downpours ($35\text{ mm/h}$) in real time with zero standing puddle accumulation ($<28\%$ moisture maintained).
- **Tier 2: Professional Sand-Cap (Championship / Tier 2)**:
  - Pure sand carpet with slotted lateral pipe drainage ($32\text{ mm/h}$ gravity percolation, $0\text{ mm/h}$ vacuum). Handles steady rain ($15\text{ mm/h}$) with minimal waterlogging.
- **Tier 3: Semi-Pro Native Soil / Loam (League Two / Regional)**:
  - Native sandy clay loam ($8.5\text{ mm/h}$ gravity percolation). Puddles begin forming during prolonged rainfall.
- **Tier 4: Grassroots Heavy Clay (Sunday League / Public Park)**:
  - Untreated native clay subsoil with zero sub-surface drainage ($0.8\text{ mm/h}$ gravity percolation).
  - Rapidly floods into a boggy mudbath ($>70\%$ moisture) under rain, with persistent standing water in goalmouths.

### 2. Ground Planarity & Micro-Topography Grid
Pitches are not flat Euclidean planes:
- **Multi-Octave Roughness**: A $0.5\text{ m}$ continuous heightfield synthesized via 3 deterministic spatial octaves:
  - Macro undulations ($12\text{--}15\text{ m}$ wavelength, crown slope).
  - Meso contours ($3\text{--}4\text{ m}$ wavelength, mown roller depressions).
  - Micro bumps & hollows ($0.8\text{--}1.2\text{ m}$ wavelength).
- **Roughness Amplitudes**:
  - Tier 1 Elite: $4.5\text{ mm}$ peak-to-trough (carpet-flat billiard table).
  - Tier 4 Clay: $32.0\text{ mm}$ peak-to-trough (bumpy park field).
- **Slope Normal Vectors & Micro-Hops**:
  - Surface normal $\vec{n} = \nabla z / \|\nabla z\|$ computed via central finite difference across neighbor cells.
  - Rolling balls crossing an abrupt upward bump at speed ($v_{\text{slope}} > 0.12\text{ m/s}$) lift into realistic vertical micro-bobs and pop up into brief bounces.
  - Downhill gravitational slope component accelerates or deflects slow-rolling passes.

### 3. Atmospheric Wind Vector & Dynamic Aerodynamics (<kbd>V</kbd>)
- **Relative Airspeed Vector ($\vec{v}_{\text{rel}} = \vec{v}_{\text{ball}} - \vec{v}_{\text{wind}}$)**:
  - Aerodynamic drag and Magnus forces are strictly computed against relative airspeed rather than ground speed.
- **Crosswind Drift**: A $7.0\text{ m/s}$ crosswind deflects a $40\text{ m}$ driven pass laterally by **$2.15\text{ m}$**.
- **Headwind vs Tailwind Flight Carry**:
  - Driven shot ($24\text{ m/s}$, $14^\circ$ elevation) into a $10\text{ m/s}$ headwind carries **$20.95\text{ m}$** before landing.
  - The identical shot with a $10\text{ m/s}$ tailwind carries **$26.98\text{ m}$** ($+28.8\%$ distance carry).
- **Dynamic Gust Turbulence**: Low-frequency sinusoidal gust modulation ($\pm 20\text{--}35\%$ volatility).

### 4. Soil Compaction & Hardness (Clegg Impact Value - CIV)
Measured via the standard 0.5 kg Clegg Impact Soil Tester (CIV in gravities $g_{10}$):
- **Equilibrium Target**: Elite football target is **$70\text{--}90\text{ CIV}$**.
- **Moisture-Compaction Dynamics**:
  - Dehydrated summer clay shrinks and bakes into a rock-hard crust (**$110\text{--}130+\text{ CIV}$**).
  - Saturated waterlogged clay plasticizes into soft spongy mud (**$30\text{--}45\text{ CIV}$**).
  - Sand-based hybrid pitches (Tier 1) maintain tight stability (**$72\text{--}88\text{ CIV}$**).
- **Restitution & Rolling Coupling**:
  - Rebound height of a $2.0\text{ m}$ drop reaches **$1.126\text{ m}$** on baked hardpan vs. **$0.517\text{ m}$** in soft mud.
  - Rolling distance increases by $+7\%$ on hardpan ($36.28\text{ m}$ vs $33.94\text{ m}$) due to minimal turf sinkage.
- **Stud Bite**: Plastic FG studs cannot bite into baked hardpan ($\text{CIV} > 95$), while metal SG studs pierce the hard crust.

### 5. Rootzone Shear Endurance & Dynamic Mudbath Degradation (<kbd>J</kbd>)
- **Rootzone Shear Threshold**:
  - Tier 1 Hybrid stitching resists up to **$13.5\text{ m/s}^2$** kinematic maneuver shear acceleration.
  - Tier 4 Grassroots clay tears easily at **$5.2\text{ m/s}^2$**.
- **Divot Geometry by Tier**:
  - Hybrid pitches limit divots to minor surface scuffs ($r \approx 0.108\text{ m}$).
  - Grassroots clay yields deep, torn sod craters ($r \approx 0.288\text{ m}$).
- **90-Minute Match Traffic Simulation (<kbd>J</kbd>)**:
  - Simulates spatial traffic wear across the central corridor ($\pm 30\text{ m}$), penalty spots, and goalmouths ($\pm 51.5\text{ m}$).
  - Under wet conditions on clay, high-traffic goalmouths churn into full **mudbaths** ($100\%$ wear) that spawn standing water puddles.

---

## 🎮 Interactive Controls Cheat-Sheet

| Control | Action | Details |
| :---: | :--- | :--- |
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | **Locomotion** | Virtual analog vector steering with momentum conservation |
| <kbd>Shift</kbd> | **Sprint** | Sprint blastoff lean, spring-mass flight running |
| <kbd>Z</kbd> | **Walk** | Inverted pendulum walk, double support stance |
| <kbd>Space</kbd> | **Jockey** | Locks torso facing orientation for backpedaling/defending |
| <kbd>E</kbd> | **Controlled Slide** | Deliberate ground slide tackle (leaves cleat ruts; slides further on wet turf) |
| <kbd>P</kbd> | **Cycle Archetype** | Balanced Pro $\rightarrow$ Explosive Agilist $\rightarrow$ Lengthy $\rightarrow$ Speed Demon $\rightarrow$ Heavy Anchor |
| <kbd>F</kbd> | **Toggle Footedness** | Right-footed (Weak L 1★) $\rightarrow$ Left-footed (Weak R 1★) $\rightarrow$ Ambipedal (Both 5★) |
| <kbd>G</kbd> | **Cycle Pitch Tier** | Tier 1 Elite Hybrid $\rightarrow$ Tier 2 Pro Sand $\rightarrow$ Tier 3 Semi-Pro $\rightarrow$ Tier 4 Grassroots Clay |
| <kbd>N</kbd> | **Cycle Rainfall** | 0 mm/h (Dry) $\rightarrow$ 15 mm/h (Steady Rain) $\rightarrow$ 35 mm/h (Downpour) |
| <kbd>V</kbd> | **Cycle Wind Vector** | Calm (0 m/s) $\rightarrow$ 6 m/s East $\rightarrow$ 9 m/s North $\rightarrow$ 13 m/s West Headwind |
| <kbd>J</kbd> | **Match Traffic Wear** | Advances +30 minutes of progressive match traffic wear (spawns mudbaths in rain) |
| <kbd>Y</kbd> | **Toggle Footwear Studs** | Firm Ground (FG Plastic) $\leftrightarrow$ Soft Ground (SG Metal) |
| <kbd>[</kbd> / <kbd>]</kbd> | **Adjust Grass Height** | Decrease / Increase mowing height ($18\text{--}36\text{ mm}$, default $24\text{ mm}$) |
| <kbd>M</kbd> | **Cycle Moisture** | 10% Dry $\rightarrow$ 30% Damp $\rightarrow$ 65% Wet Slick $\rightarrow$ 90% Standing Puddles |
| <kbd>C</kbd> | **Clear Pitch Damage** | Erases all divots, ruts, puddles and resets wear grid to pristine turf |
| <kbd>B</kbd> | **Cycle Ball Model** | Modern Match $\rightarrow$ Jabulani 2010 $\rightarrow$ Telstar 32 $\rightarrow$ Futsal $\rightarrow$ Retro Leather |
| <kbd>T</kbd> | **Toggle Turf Condition** | Standard Pitch $\rightarrow$ Wet Slick (watered) $\rightarrow$ Dry Heavy Grass |
| <kbd>1</kbd> | **Ground Pass** | $14\text{ m/s}$, $0^\circ$ elevation, flat turf roll |
| <kbd>2</kbd> | **Curving Free-Kick** | $24\text{ m/s}$, $12^\circ$ elevation, $+7\text{ RPS}$ inside Magnus curl |
| <kbd>3</kbd> | **Chipped Lob** | $16\text{ m/s}$, $28^\circ$ elevation, $+5.5\text{ RPS}$ backspin floating lift |
| <kbd>4</kbd> | **Trivela Curve** | $22\text{ m/s}$, $10^\circ$ elevation, $-6\text{ RPS}$ outside boot curve |
| <kbd>5</kbd> | **Knuckleball Strike** | $28\text{ m/s}$, $7.5^\circ$ elevation, $0\text{ spin}$ (test with Jabulani vs Telstar!) |
| <kbd>R</kbd> | **Reset Ball** | Resets ball directly to player's feet at rest |
| <kbd>Click Pitch</kbd> | **Kick to Cursor** | Distance-scaled pass/shot (<kbd>Shift</kbd>+Click = Curve, <kbd>Alt</kbd>+Click = Lob) |
| <kbd>Scroll</kbd> | **Zoom Viewport** | Dynamic camera zoom ($16\text{--}64\text{ px/m}$) |

---

## 📁 Directory Structure

```
Football/
├── src/
│   ├── main.ts                    # Application bootstrap & tick-interpolated render loop
│   ├── math/
│   │   ├── Vector2.ts             # 2D SI vector operations
│   │   └── Vector3.ts             # 3D SI vector operations (cross product, lerp, clamp)
│   ├── sim/                       # 100% Headless Deterministic Simulation Core (120 Hz)
│   │   ├── SimulationCore.ts      # Master engine integrating player locomotion, ball & pitch
│   │   ├── config.ts              # FIFA regulation dimensions, pitch constants, SI parameters
│   │   ├── types.ts               # Contracts (PlayerState, BallState, BallModelConfig, TurfCondition, etc.)
│   │   ├── locomotion/
│   │   │   ├── LocomotionSystem.ts# Kinematic speed envelopes, plant-and-cut turning, Morin lean, slipping
│   │   │   └── StrideEngine.ts    # Inverted pendulum stance & spring-mass airborne flight
│   │   └── physics/
│   │       ├── BallPhysics.ts     # 3D Aerodynamics, Drag Crisis, Knuckleball, Magnus & Turf
│   │       └── PitchSurface.ts    # Grass agronomy, 0.5m wear grid, dynamic divot scars & collisions
│   ├── render/                    # Presentation Layer (Decoupled from simulation)
│   │   ├── CanvasRenderer.ts      # Pitch renderer, grass blades, divots, skid marks, 3D perspective
│   │   └── TelemetryHUD.ts        # Biomechanical HUD telemetry, traction demand, speed graphs
│   └── test/                      # Comprehensive Automated Vitest Test Suite (48 tests across 12 files)
│       ├── pitch_tiers_and_drainage.test.ts # Darcy percolation, SubAir vacuum drainage, rain accumulation
│       ├── pitch_topography_and_bobbles.test.ts # Multi-octave roughness, slope normals, micro-hops
│       ├── atmospheric_wind_aerodynamics.test.ts # Wind vectors, crosswind deflection, carry modulation
│       ├── soil_hardness_civ.test.ts      # Clegg Impact Value (CIV), restitution and rolling friction
│       ├── rootzone_shear_and_mudbaths.test.ts # Root shear resistance, divot radius, match traffic wear
│       ├── ball_physics.test.ts           # Drag crisis, bounce decay, knuckleball, turf conditions
│       ├── pitch_and_slipping.test.ts     # Grass height, wear grid, divots, FG vs SG slipping & recovery
│       ├── pitch_dynamics_and_movement.test.ts # Moisture puddles, slides, ruts, fatigue drain
│       ├── attributes_and_curves.test.ts  # Continuous sprint curve index (κ) benchmarks
│       ├── biomechanics_slice1.test.ts    # Stride phases, Morin lean, axial gaze precedence
│       ├── locomotion_turns.test.ts       # Steering curves, outside plant-and-cut braking
│       └── sprint40m.test.ts              # Calibrated 10m split and 40m sprint verification
├── docs/                          # Scientific Papers & Architectural Specifications
│   └── RESEARCH_PAPER_BIOMECHANICAL_LOCOMOTION.md # Peer-reviewed style whitepaper
├── archive/                       # Archived Legacy Implementation & Historical Prototypes
│   ├── README_legacy.md           # Original prototype documentation
│   ├── src/                       # Legacy vanilla JS prototype files
│   └── tests/                     # Legacy tests
├── index.html                     # HTML5 Canvas viewport & HUD overlay layout
├── package.json                   # Vite, Vitest & TypeScript configuration
└── tsconfig.json                  # Strict TypeScript configuration
```

---

## 🚀 Getting Started & Testing

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Installation
```bash
npm install
```

### Development Server
Starts the local development server with Vite hot module replacement:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Running Automated Test Suite
Runs all 48 unit tests across all 12 test files with Vitest:
```bash
npm test
```

### Production Build
Type-checks TypeScript and compiles production bundle:
```bash
npm run build
```

---

## 📚 Scientific Documentation

For a comprehensive, peer-reviewed-style whitepaper covering the mathematical derivations, inverted pendulum kinematics, spring-mass equations, and sprint curve proofs, see:
* [RESEARCH_PAPER_BIOMECHANICAL_LOCOMOTION.md](file:///home/soumya/Desktop/Games/Football/docs/RESEARCH_PAPER_BIOMECHANICAL_LOCOMOTION.md)
