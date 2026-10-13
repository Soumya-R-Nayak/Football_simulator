# Graph Report - Football  (2026-10-12)

## Corpus Check
- 19 files · ~25,562 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: .css 1)

## Summary
- 224 nodes · 475 edges · 13 communities (7 shown, 6 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- main.js
- manipulation_physics.test.js
- Physical Telemetry Panel
- Vector2
- PlayerEntity
- Locomotion
- dribble_physics.test.js
- Environment
- DribbleController
- Package Configuration & Scripts
- CanvasRenderer
- Ball
- loop

## God Nodes (most connected - your core abstractions)
1. `Vector2` - 52 edges
2. `PlayerEntity` - 29 edges
3. `CanvasRenderer` - 15 edges
4. `Environment` - 14 edges
5. `Ball` - 13 edges
6. `Locomotion` - 13 edges
7. `DribbleController` - 12 edges
8. `Pitch` - 11 edges
9. `InputManager` - 9 edges
10. `loop()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `loop()` --calls--> `switchPlayer()`  [EXTRACTED]
  src/main.js → src/main.js  _Bridges community 0 → community 12_

## Import Cycles
- None detected.

## Communities (13 total, 6 thin omitted)

### Community 0 - "main.js"
Cohesion: 0.10
Nodes (19): applySkillRating(), switchPlayer(), updatePresetButtons(), Pitch, env, passing, pitch, env (+11 more)

### Community 1 - "manipulation_physics.test.js"
Cohesion: 0.07
Nodes (29): chipBall, chipPlayer, chipSuccess, cushionDir, dirSuccess, dragSuccess, env, flickBall (+21 more)

### Community 2 - "Physical Telemetry Panel"
Cohesion: 0.15
Nodes (9): Tactical 2D Football Web App, Ball Dynamics Telemetry (FIFA Size 5), Player Biomechanics & Stride Telemetry, Controls Cheat Sheet Banner, Game Canvas, Discrete Micro-Touch Dribbling Telemetry, Physical Telemetry Panel, Environment & Turf Calibration Telemetry (+1 more)

### Community 3 - "Vector2"
Cohesion: 0.12
Nodes (3): InputManager, Vector2, testKeyVector()

### Community 6 - "dribble_physics.test.js"
Cohesion: 0.12
Nodes (16): ball, closePushSpeed, env, envBall, envLongTest, envPlayer, envWetTest, fatiguedJogSpeed (+8 more)

### Community 9 - "Package Configuration & Scripts"
Cohesion: 0.25
Nodes (7): description, license, name, scripts, test, type, version

### Community 12 - "loop"
Cohesion: 0.20
Nodes (3): activePlayer(), loop(), Camera

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Vector2` connect `Vector2` to `main.js`, `manipulation_physics.test.js`, `PlayerEntity`, `Locomotion`, `dribble_physics.test.js`, `Environment`, `DribbleController`, `Ball`, `loop`?**
  _High betweenness centrality (0.304) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09672830725462304 - nodes in this community are weakly interconnected._
- **Why does `PlayerEntity` connect `PlayerEntity` to `main.js`, `manipulation_physics.test.js`, `Locomotion`, `dribble_physics.test.js`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Should `manipulation_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Why does `CanvasRenderer` connect `CanvasRenderer` to `main.js`, `Physical Telemetry Panel`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Should `Vector2` be split into smaller, more focused modules?**
  _Cohesion score 0.12333333333333334 - nodes in this community are weakly interconnected._
- **Should `dribble_physics.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._