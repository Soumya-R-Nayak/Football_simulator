# Graph Report - Football  (2026-10-13)

## Corpus Check
- 24 files · ~35,963 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: .css 1)

## Summary
- 305 nodes · 629 edges · 11 communities (7 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- slice1_physics.test.js
- manipulation_physics.test.js
- main.js
- Vector2
- PlayerEntity
- PlayerAttributes
- dribble_physics.test.js
- ⚽ Realistic 2D Football Simulation & Sports Science Sandbox
- Environment
- Package Configuration & Scripts
- CanvasRenderer

## God Nodes (most connected - your core abstractions)
1. `Vector2` - 57 edges
2. `PlayerAttributes` - 37 edges
3. `PlayerEntity` - 34 edges
4. `Environment` - 16 edges
5. `CanvasRenderer` - 16 edges
6. `Ball` - 15 edges
7. `Locomotion` - 14 edges
8. `⚽ Realistic 2D Football Simulation & Sports Science Sandbox` - 14 edges
9. `Pitch` - 13 edges
10. `Camera` - 13 edges

## Surprising Connections (you probably didn't know these)
- `readSlidersAndApply()` --calls--> `PlayerAttributes`  [EXTRACTED]
  src/main.js → src/physics/PlayerAttributes.js

## Import Cycles
- None detected.

## Communities (11 total, 4 thin omitted)

### Community 0 - "slice1_physics.test.js"
Cohesion: 0.09
Nodes (21): Ball, Pitch, env, pitch, env, passing, pitch, env (+13 more)

### Community 1 - "manipulation_physics.test.js"
Cohesion: 0.07
Nodes (29): chipBall, chipPlayer, chipSuccess, cushionDir, dirSuccess, dragSuccess, env, flickBall (+21 more)

### Community 2 - "main.js"
Cohesion: 0.07
Nodes (24): Tactical 2D Football Web App, Ball Dynamics Telemetry (FIFA Size 5), Player Biomechanics & Stride Telemetry, Game Canvas, Discrete Micro-Touch Dribbling Telemetry, Physical Telemetry Panel, Environment & Turf Calibration Telemetry, activePlayer() (+16 more)

### Community 3 - "Vector2"
Cohesion: 0.09
Nodes (5): Controls Cheat Sheet Banner, InputManager, Vector2, PassingController, testKeyVector()

### Community 6 - "dribble_physics.test.js"
Cohesion: 0.12
Nodes (16): ball, closePushSpeed, env, envBall, envLongTest, envPlayer, envWetTest, fatiguedJogSpeed (+8 more)

### Community 7 - "⚽ Realistic 2D Football Simulation & Sports Science Sandbox"
Cohesion: 0.10
Nodes (19): 1. Launching Locally, 2. Running the Test Suite, 🪄 Ball Manipulation & PES 2017 Real Touch Mechanics, 🎥 Camera Projection, Views & Customization, ⌨️ Controls Cheat-Sheet, 🔬 Core Design Philosophy, Core FM24 Attributes (1–20):, ⚡ Discrete Micro-Touch Dribbling & Plant-and-Cut (+11 more)

### Community 9 - "Package Configuration & Scripts"
Cohesion: 0.25
Nodes (7): description, license, name, scripts, test, type, version

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Vector2` connect `Vector2` to `slice1_physics.test.js`, `manipulation_physics.test.js`, `main.js`, `PlayerEntity`, `PlayerAttributes`, `dribble_physics.test.js`, `Environment`?**
  _High betweenness centrality (0.231) - this node is a cross-community bridge._
- **Should `slice1_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09080841638981174 - nodes in this community are weakly interconnected._
- **Why does `PlayerAttributes` connect `PlayerAttributes` to `slice1_physics.test.js`, `main.js`, `PlayerEntity`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Should `manipulation_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Why does `PlayerEntity` connect `PlayerEntity` to `slice1_physics.test.js`, `manipulation_physics.test.js`, `main.js`, `PlayerAttributes`, `dribble_physics.test.js`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0700354609929078 - nodes in this community are weakly interconnected._
- **Should `Vector2` be split into smaller, more focused modules?**
  _Cohesion score 0.0907563025210084 - nodes in this community are weakly interconnected._