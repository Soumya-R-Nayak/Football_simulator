# Graph Report - Football  (2026-10-13)

## Corpus Check
- 23 files · ~33,171 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: .css 1)

## Summary
- 285 nodes · 610 edges · 10 communities (6 shown, 4 thin omitted)
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
- DribbleController
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
8. `Pitch` - 13 edges
9. `Camera` - 13 edges
10. `DribbleController` - 12 edges

## Surprising Connections (you probably didn't know these)
- `readSlidersAndApply()` --calls--> `PlayerAttributes`  [EXTRACTED]
  src/main.js → src/physics/PlayerAttributes.js

## Import Cycles
- None detected.

## Communities (10 total, 4 thin omitted)

### Community 0 - "slice1_physics.test.js"
Cohesion: 0.09
Nodes (21): Ball, Pitch, env, pitch, env, passing, pitch, env (+13 more)

### Community 1 - "manipulation_physics.test.js"
Cohesion: 0.07
Nodes (29): chipBall, chipPlayer, chipSuccess, cushionDir, dirSuccess, dragSuccess, env, flickBall (+21 more)

### Community 2 - "main.js"
Cohesion: 0.10
Nodes (24): Tactical 2D Football Web App, Ball Dynamics Telemetry (FIFA Size 5), Player Biomechanics & Stride Telemetry, Controls Cheat Sheet Banner, Game Canvas, Discrete Micro-Touch Dribbling Telemetry, Physical Telemetry Panel, Environment & Turf Calibration Telemetry (+16 more)

### Community 3 - "Vector2"
Cohesion: 0.08
Nodes (4): InputManager, Vector2, Camera, testKeyVector()

### Community 6 - "dribble_physics.test.js"
Cohesion: 0.10
Nodes (17): Environment, ball, closePushSpeed, env, envBall, envLongTest, envPlayer, envWetTest (+9 more)

### Community 9 - "Package Configuration & Scripts"
Cohesion: 0.25
Nodes (7): description, license, name, scripts, test, type, version

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Vector2` connect `Vector2` to `slice1_physics.test.js`, `manipulation_physics.test.js`, `main.js`, `PlayerEntity`, `PlayerAttributes`, `dribble_physics.test.js`, `DribbleController`?**
  _High betweenness centrality (0.265) - this node is a cross-community bridge._
- **Should `slice1_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08502415458937199 - nodes in this community are weakly interconnected._
- **Why does `PlayerAttributes` connect `PlayerAttributes` to `slice1_physics.test.js`, `main.js`, `PlayerEntity`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Should `manipulation_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Why does `PlayerEntity` connect `PlayerEntity` to `slice1_physics.test.js`, `manipulation_physics.test.js`, `main.js`, `PlayerAttributes`, `dribble_physics.test.js`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0953058321479374 - nodes in this community are weakly interconnected._
- **Should `Vector2` be split into smaller, more focused modules?**
  _Cohesion score 0.08235294117647059 - nodes in this community are weakly interconnected._