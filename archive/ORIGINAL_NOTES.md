Main Idea:

My goal is to be as accurate as possible, without the fluff of animating it. This means I want to make a 2d game that behaves very realistically and has great complex decision making and depth and environment and physics interactions without focussing on the graphics for a stripped down but enriched experience. I want it to be basically kind of a playable interactive version of Football Manager, I also want the AI to respond to tactical changes and adjustments as characters in FM would. However, the movement of the simulated 3d engine that is shown in 2d in FM looks weird to me, I don't want to have that at all by having the game simplified from the get go, and I want realistic looking compromises that prioritise the quality of the simulation. 

I want the code to be made in such a way that it is very discrete and individual components can be added to more degrees of complexity that will make the game more realistic.

Rough plan is this - I want to make a single player's movement without the ball perfect. Then I want to add the ball. Then I want to see the player kick the ball. Then dribbling into free space -while sprinting, jockeying, normally moving - here I would want to pause and flesh out the dynamics to be in as much detail as possible.

Then I want to add two players, first touch/passing reception while standing and passing directly, passing into space, lofted passing, position and foot dependant choice making (whether to drive the pass, roll it, curve it etc.) Then I want to model reception of a pass while one is moving (first touch - to avoid obstacles? to keep dribbling? - here I want to see what happens). 

Then the next step is adding a pressure system to press the ball and ways in which you can evade pressure or shield yourself. Here I want to separate the head and use the vision and scanning to have players using tracking + memory + pre match training/drills to react to environment (players with higher vision can keep awareness of their surroundings pretty high -we can use this mechanic for passing as well, passing blindly whose accuracy is based on memory obtained from scanning earlier or using chemistry from training).


I then want to add a goalkeeper, who can dive, block, collect, jump, rush, throw etc. I want to develop a realistic way that the gk tracks the ball.
Then the next step is static shooting - various kinds. Then shooting while moving, heading, using knees? to control and then shoot etc.


After this, the next steps would be to add even more players, and finally tactics like in FM24/26 + efootball(latest). Then play it.



My goal is to basically take a real life football match on TV and be able to recreate it on my potato PC by stripping down the graphics to speed it up, while having as realistic of a football simulator you can get as possible...




First, I was thinking of making movement.


Movement: I want the player to have these physical attributes: pace(speed), acceleration, agility, stamina, jumping reach, balance. Keep it aside for now, when we make a generic player, we will see what advantages changing these stats will bring to the player's movement. 

Generic player -  I want a separated torso, (head for later -to scan the pitch, for vision/interaction with the ball purposes.) The torso will be able to pin down exactly what kind of motion I am inputting - if I use the go back key, it could mean two things, hastily retreating while keeping the torso pointed forwards, or running after turning backwards. I want these to look different but sensibly implemented. Lunging to the side should be different than slaloming should be different than turning to the right while zigzagging. Side to side jockeying should be an option. I also want to develop a control system (currently I don't have a controller, but however far we can go using the keyboard I guess. Maybe later we can develop controller support too). Maybe we should add thighs to be able to take first touches that way?


This is a claude prompt:

Build a TypeScript + Vite project for a football simulation. Strictly separate the simulation core (pure TS, no DOM, fixed 120 Hz timestep, SI units, 105×68 m pitch) from a Canvas top-down renderer. First, write ARCHITECTURE.md defining: an Intent struct {moveDir, faceDir, gait, holdFacing}, a PlayerState {position, velocity, facing, stamina}, and a system pipeline (perception → decision → intent → locomotion → physics). Then implement only the locomotion system for one player: velocity follows v(t)=vmax(1−e^(−t/τ)) toward the intent; max speed scales by the angle between velocity and facing (forward 100%, sideways ~65%, backward ~55%); facing turns at a limited rate; lateral acceleration is capped by a grip budget shared with longitudinal acceleration.Add a debug overlay with velocity/facing vectors and a speed graph, and a headless test for a 40 m sprint. Put all tuning constants in config.ts. Do not implement the ball yet.

Keyboard intent source, no mouse, no Ctrl or Alt. Bindings live in keybindings.ts using event.code. WASD drives a virtual analog stick: ramp up over ~100 ms, but pass through zero in ~35 ms when the opposite direction is pressed; normalise diagonals. Gaits: default jog, Shift = sprint, Z = walk. Space = holdFacing (locks torso facing at the moment of press). Facing otherwise follows movement. Dev-only: Left/Right arrows rotate the torso at the player’s turn rate. Key events only update a held-keys set, which is sampled once per sim tick. Ignore event.repeat, clear held keys on window blur, preventDefault on Space and arrows. Reserve (do not implement) IJKL, U, O, Q, E, R, F for future actions. Render with interpolation between fixed 120 Hz ticks and cap catch-up steps at 5 per frame.

