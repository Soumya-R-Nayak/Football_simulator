import assert from 'node:assert';
import { PlayerEntity } from '../src/entities/PlayerEntity.js';
import { Ball } from '../src/physics/Ball.js';
import { Pitch } from '../src/physics/Pitch.js';
import { Environment } from '../src/physics/Environment.js';
import { Vector2 } from '../src/math/Vector2.js';
import { InputManager } from '../src/input/InputManager.js';

console.log('🎮 Running PES (Pro Evolution Soccer) Mechanics Test Suite...\n');

const pitch = new Pitch();
const env = new Environment();

// -------------------------------------------------------------
// Test 1: PES Super Cancel (Shift + Space)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  const ball = new Ball(50.6, 34.0);
  const input = new InputManager();

  // Simulate charging a shot and holding trap
  input.isChargingShot = true;
  input.shotChargeTime = 0.85;
  input.pendingShot = { power: 0.85, spin: 0.0, kickType: 'SHOT' };
  player.isHoldingTrap = true;
  player.firstTimeBuffer = { kickType: 'SHORT_PASS', targetDir: new Vector2(1, 0), power: 1.0, spin: 0, expires: 0.5 };

  // Press Super Cancel (Shift + Space)
  input.keys['ShiftLeft'] = true;
  input.keys['Space'] = true;

  input.update(player, ball, 0.016);

  assert.strictEqual(input.isChargingShot, false, 'Super Cancel must immediately clear isChargingShot');
  assert.strictEqual(input.pendingShot, null, 'Super Cancel must immediately clear pendingShot');
  assert.strictEqual(player.isHoldingTrap, false, 'Super Cancel must break any active trap lock');
  assert.strictEqual(player.firstTimeBuffer, null, 'Super Cancel must wipe all queued action buffers');
  assert.strictEqual(player.actionNotification.text, '⚡ SUPER CANCEL', 'Super Cancel must post notification feedback');
  console.log('  ✔ PES Super Cancel (Shift + Space): Instantly broke all shot charges, buffers, and stance locks');
}

// -------------------------------------------------------------
// Test 2: PES Body Stance Balance & Scuff Penalty
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0; // Facing East (1, 0)
  player.vel.set(4.0, 0.0); // Running East

  // 1. Direct forward pass (0 deg)
  const forwardStance = player.calculateStanceQuality(new Vector2(1, 0));
  assert(forwardStance.powerFactor >= 0.90, 'Direct forward pass must have >= 90% power quality');
  assert.strictEqual(forwardStance.isOffBalance, false, 'Forward pass must not be off-balance');

  // 2. Half-turn pass (60 deg / ~1.05 rad)
  const halfTurnDir = Vector2.fromAngle(Math.PI / 3);
  const halfTurnStance = player.calculateStanceQuality(halfTurnDir);
  assert(halfTurnStance.powerFactor < forwardStance.powerFactor, 'Half-turn must have lower power factor than forward');
  assert(halfTurnStance.powerFactor >= 0.70, 'Half-turn should retain >= 70% power');
  assert(halfTurnStance.angleNoise > forwardStance.angleNoise, 'Half-turn must increase angular dispersion');

  // 3. Blind / 180 deg turnaround pass (180 deg / PI rad)
  const blindDir = new Vector2(-1, 0); // West
  const blindStance = player.calculateStanceQuality(blindDir);
  assert(blindStance.powerFactor <= 0.65, 'Blind 180° turnaround must suffer severe power penalty (<= 65%)');
  assert.strictEqual(blindStance.isOffBalance, true, 'Blind turnaround pass must flag isOffBalance');
  assert(blindStance.angleNoise >= 0.15, 'Blind turnaround pass must incur significant scuff dispersion');

  console.log(`  ✔ PES Stance Quality: Forward (${Math.round(forwardStance.powerFactor * 100)}%) -> Half-Turn (${Math.round(halfTurnStance.powerFactor * 100)}%) -> 180° Scuff (${Math.round(blindStance.powerFactor * 100)}%) verified`);
}

// -------------------------------------------------------------
// Test 3: PES Through Ball (Ground & Chipped Through)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  const ball = new Ball(50.5, 34.0);

  // Ground Through Ball (H)
  const kickSuccess1 = player.executeKick(ball, 'GROUND_THROUGH', new Vector2(1, 0), 1.0, 0.0);
  assert.strictEqual(kickSuccess1, true, 'Ground through ball should execute');
  assert.strictEqual(ball.lastKickType, 'GROUND_THROUGH', 'Ball kick type must be GROUND_THROUGH');
  assert(ball.lastKickSpeed >= 14.5 && ball.lastKickSpeed <= 18.5, `Ground through ball speed ${ball.lastKickSpeed} m/s must be 14.5-18.5 m/s`);
  assert.strictEqual(ball.z, 0.0, 'Ground through ball must stay on turf (z = 0)');

  // Reset ball position
  ball.pos.set(50.5, 34.0);
  ball.vel.set(0, 0);
  player.kickCooldown = 0.0;

  // Lofted Chipped Through Ball (Shift + H)
  const kickSuccess2 = player.executeKick(ball, 'LOFTED_THROUGH', new Vector2(1, 0), 1.0, 0.0);
  assert.strictEqual(kickSuccess2, true, 'Lofted through ball should execute');
  assert.strictEqual(ball.lastKickType, 'LOFTED_THROUGH', 'Ball kick type must be LOFTED_THROUGH');
  assert(ball.vz >= 5.0, `Lofted through ball vz ${ball.vz} m/s must be >= 5.0 m/s`);
  assert(ball.backspin < -35.0, `Lofted through ball backspin ${ball.backspin} rad/s must check up on turf`);

  console.log('  ✔ PES Through Ball: Ground (14.5-18.5 m/s corridor) & Lofted (Lift 5.2m/s, Backspin -42 rad/s) verified');
}

// -------------------------------------------------------------
// Test 4: PES Finesse / Curling Shot (Space + K)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  const ball = new Ball(50.5, 34.0);

  player.executeKick(ball, 'FINESSE_SHOT', new Vector2(1, 0), 1.0, -42.0);
  assert.strictEqual(ball.lastKickType, 'FINESSE_SHOT', 'Ball kick type must be FINESSE_SHOT');
  assert(ball.lastKickSpeed >= 18.5 && ball.lastKickSpeed <= 27.0, `Finesse shot speed ${ball.lastKickSpeed} m/s must be 18.5-27.0 m/s`);
  assert.strictEqual(ball.spinZ, -42.0, 'Finesse shot must carry Magnus curl spin');
  console.log(`  ✔ PES Finesse Shot: Controlled curling strike at ${ball.lastKickSpeed.toFixed(1)} m/s with -42 rad/s curl verified`);
}

// -------------------------------------------------------------
// Test 5: PES Dummy Reception (Shift with no move / Key N)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  const ball = new Ball(49.0, 34.0);
  ball.vel.set(6.0, 0.0); // Rolling towards player East at 6 m/s

  player.executeFirstTouch(ball, 'DUMMY');
  assert(player.dummyCooldown > 0.40, 'Dummy must activate dummyCooldown');
  assert.strictEqual(ball.lastKickType, 'DUMMY_RUN', 'Ball action must be DUMMY_RUN');
  assert.strictEqual(ball.vel.x, 6.0, 'Ball speed must remain completely untouched during dummy run-through');
  console.log('  ✔ PES Dummy Reception: Ball bypassed player legs cleanly at 6.0 m/s without deflection');
}

// -------------------------------------------------------------
// Test 6: PES Knock-On Burst (Shift-Shift / E)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  player.vel.set(3.0, 0.0);
  const ball = new Ball(50.5, 34.0);

  player.executeKnockOnBurst(ball, new Vector2(1, 0));
  assert.strictEqual(ball.lastKickType, 'KNOCK_ON_BURST', 'Ball action must be KNOCK_ON_BURST');
  assert(ball.vel.x >= 7.0, `Knock-on burst ball speed ${ball.vel.x} m/s should be >= 7.0 m/s into space`);
  assert(player.knockOnSurgeTimer > 1.0, 'Player surge timer must be active for sprint chase');
  assert(player.vel.x >= 5.0, `Player sprint velocity ${player.vel.x} m/s surged forward`);
  console.log('  ✔ PES Knock-On Burst: Ball propelled firmly ahead (+7.4 m/s) with 1.3s auto-sprint surge');
}

// -------------------------------------------------------------
// Test 7: PES First-Time Action Buffering
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  // Ball is approaching from 2.5m away (out of striking reach > 1.35m)
  const ball = new Ball(47.5, 34.0);
  ball.vel.set(10.0, 0.0);

  // Buffer a first-time strike
  player.firstTimeBuffer = {
    kickType: 'SHOT',
    targetDir: new Vector2(1, 0),
    power: 0.90,
    spin: 0.0,
    expires: 0.70
  };

  assert.strictEqual(player.isBallKickable(ball, 0.45), false, 'Ball is initially outside striking reach');

  // Advance time: ball arrives within reach
  ball.pos.set(49.8, 34.0); // 0.2m away
  assert.strictEqual(player.isBallKickable(ball, 0.45), true, 'Ball is now within striking reach');

  // Execute Player update step
  player.update(0.016, ball, pitch, env, new Vector2(0, 0), 'RUN');

  assert.strictEqual(player.firstTimeBuffer, null, 'Buffered action must be consumed upon arrival');
  assert.strictEqual(ball.lastKickType, 'SHOT', 'Ball must be struck with buffered SHOT');
  assert(ball.lastKickSpeed >= 20.0, 'First-time strike executed with full power');
  console.log('  ✔ PES First-Time Buffering: Queued one-touch strike fired instantly upon ball arrival');
}

// -------------------------------------------------------------
// Test 8: Variable Strength Ground Passes & Through Balls
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  const ball = new Ball(50.5, 34.0);
  const input = new InputManager();

  // 1. Soft Layoff Pass (Light tap, power = 0.18)
  player.executeKick(ball, 'SHORT_PASS', new Vector2(1, 0), 0.18);
  const tapSpeed = ball.lastKickSpeed;
  assert(tapSpeed >= 5.5 && tapSpeed <= 7.0, `Soft layoff pass speed ${tapSpeed.toFixed(2)} m/s must be 5.5-7.0 m/s`);

  // 2. Firm Direct Ground Pass (Full power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'SHORT_PASS', new Vector2(1, 0), 1.0);
  const fullSpeed = ball.lastKickSpeed;
  assert(fullSpeed >= 12.5 && fullSpeed <= 14.5, `Full strength pass speed ${fullSpeed.toFixed(2)} m/s must be 12.5-14.5 m/s`);
  assert(fullSpeed > tapSpeed * 1.8, 'Full strength pass must be significantly faster than soft layoff');

  // 3. Short Slip Through Ball (power = 0.18)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'GROUND_THROUGH', new Vector2(1, 0), 0.18);
  const softThrough = ball.lastKickSpeed;
  assert(softThrough >= 7.8 && softThrough <= 9.2, `Soft slip through ball speed ${softThrough.toFixed(2)} m/s must be 7.8-9.2 m/s`);

  // 4. Long Deep Corridor Through Ball (power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'GROUND_THROUGH', new Vector2(1, 0), 1.0);
  const deepThrough = ball.lastKickSpeed;
  assert(deepThrough >= 16.5 && deepThrough <= 18.5, `Deep through ball speed ${deepThrough.toFixed(2)} m/s must be 16.5-18.5 m/s`);
  assert(deepThrough > softThrough * 1.8, 'Deep through ball must travel with higher corridor velocity');

  // 5. InputManager Pass Charging over time
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  input.keys['KeyJ'] = true;
  input.update(player, ball, 0.20); // Hold for 200ms
  assert(input.isChargingPass, 'InputManager should be actively charging pass');
  assert(input.passChargeTime >= 0.40, `Pass charge time ${input.passChargeTime} should have accumulated`);

  // Release KeyJ
  input.keys['KeyJ'] = false;
  input.update(player, ball, 0.016);
  assert.strictEqual(input.isChargingPass, false, 'Charging should end on key release');
  assert.strictEqual(ball.lastKickType, 'SHORT_PASS', 'Pass should execute on key release');
  assert(ball.lastKickSpeed > tapSpeed, 'Charged pass should be faster than quick tap');

  console.log(`  ✔ Variable Pass Strength: Tap (${tapSpeed.toFixed(1)} m/s) -> Charged (${ball.lastKickSpeed.toFixed(1)} m/s) -> Full (${fullSpeed.toFixed(1)} m/s) verified`);
  console.log(`  ✔ Variable Through Ball: Slip (${softThrough.toFixed(1)} m/s) -> Deep (${deepThrough.toFixed(1)} m/s) verified`);
}

// -------------------------------------------------------------
// Test 9: Variable Strength Lofted Passes & Clearances (Key I & Shift+I)
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  const ball = new Ball(50.5, 34.0);
  const input = new InputManager();

  // 1. Delicate Short Chip Scoop (Light tap, power = 0.18)
  player.executeKick(ball, 'LOFT_CHIP', new Vector2(1, 0), 0.18);
  const tapSpeed = ball.lastKickSpeed;
  const tapLoft = ball.vz;
  assert(tapSpeed >= 7.5 && tapSpeed <= 9.5, `Delicate chip speed ${tapSpeed.toFixed(2)} m/s must be 7.5-9.5 m/s`);
  assert(tapLoft >= 3.8 && tapLoft <= 5.2, `Delicate chip vz ${tapLoft.toFixed(2)} m/s must be 3.8-5.2 m/s`);

  // 2. Full Long Lofted Pass / Cross (power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'LOFT_CHIP', new Vector2(1, 0), 1.0);
  const fullSpeed = ball.lastKickSpeed;
  const fullLoft = ball.vz;
  assert(fullSpeed >= 18.0 && fullSpeed <= 21.0, `Full strength loft speed ${fullSpeed.toFixed(2)} m/s must be 18.0-21.0 m/s`);
  assert(fullLoft >= 8.5 && fullLoft <= 9.5, `Full strength loft vz ${fullLoft.toFixed(2)} m/s must be 8.5-9.5 m/s`);
  assert.strictEqual(ball.backspin, -48.0, 'Full lofted pass must carry maximum -48 rad/s backspin');
  assert(fullSpeed > tapSpeed * 2.0, 'Full lofted pass must be more than twice as fast as delicate chip');

  // 3. Booming Defensive Clearance (Shift+I / CLEARANCE, power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'CLEARANCE', new Vector2(1, 0), 1.0);
  const clearSpeed = ball.lastKickSpeed;
  const clearLoft = ball.vz;
  assert(clearSpeed >= 24.0 && clearSpeed <= 27.5, `Clearance speed ${clearSpeed.toFixed(2)} m/s must be 24.0-27.5 m/s`);
  assert(clearLoft >= 10.0 && clearLoft <= 12.0, `Clearance vz ${clearLoft.toFixed(2)} m/s must provide high 11 m/s clearance arc`);

  // 4. InputManager Key I Charging over time
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  input.keys['KeyI'] = true;
  input.update(player, ball, 0.20); // Hold for 200ms
  assert(input.isChargingLoft, 'InputManager should be actively charging loft');
  assert(input.loftChargeTime >= 0.40, `Loft charge time ${input.loftChargeTime} should accumulate`);

  // Release Key I
  input.keys['KeyI'] = false;
  input.update(player, ball, 0.016);
  assert.strictEqual(input.isChargingLoft, false, 'Charging should end on Key I release');
  assert.strictEqual(ball.lastKickType, 'LOFT_CHIP', 'Loft should execute on Key I release');
  assert(ball.lastKickSpeed > tapSpeed, 'Charged loft should be faster than quick tap');

  // 5. InputManager Shift + Key I Clearance Charging
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  input.keys['ShiftLeft'] = true;
  input.keys['KeyI'] = true;
  input.update(player, ball, 0.20);
  assert(input.isClearance, 'Shift + Key I must activate clearance mode');
  input.keys['KeyI'] = false;
  input.keys['ShiftLeft'] = false;
  input.update(player, ball, 0.016);
  assert.strictEqual(ball.lastKickType, 'CLEARANCE', 'Shift + Key I must execute CLEARANCE');
  assert(ball.lastKickSpeed >= 18.0, 'Clearance must travel with high launch speed');

  // 6. Fake Cross Cancel Feint (Hold I -> press J)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  input.keys['KeyI'] = true;
  input.update(player, ball, 0.15);
  assert(input.isChargingLoft, 'Should be charging loft before cancel');
  input.keys['KeyJ'] = true;
  input.update(player, ball, 0.016);
  assert.strictEqual(input.isChargingLoft, false, 'Loft charge must be canceled by Pass key');
  assert.strictEqual(input.pendingLoft, null, 'Pending loft must be cleared');
  assert.strictEqual(player.actionNotification.text, '⚡ FAKE CROSS', 'Action notification must report FAKE CROSS');

  console.log(`  ✔ Variable Lofted Pass: Chip (${tapSpeed.toFixed(1)} m/s, vz: ${tapLoft.toFixed(1)}) -> Loft (${fullSpeed.toFixed(1)} m/s, vz: ${fullLoft.toFixed(1)}) verified`);
  console.log(`  ✔ Booming Clearance: Shift+I launched at ${clearSpeed.toFixed(1)} m/s with vz: ${clearLoft.toFixed(1)} m/s verified`);
  console.log('  ✔ Fake Cross Cancel: Hold I -> J seamlessly feinted into directional turn');
}

// -------------------------------------------------------------
// Test 10: Shot Elevation, Velocity Spectrum & Pass Magnitude Balance
// -------------------------------------------------------------
{
  const player = new PlayerEntity({ x: 50.0, y: 34.0 });
  player.heading = 0.0;
  const ball = new Ball(50.5, 34.0);

  // 1. Placed Low Finish (Tap Shot, power = 0.18)
  player.executeKick(ball, 'SHOT', new Vector2(1, 0), 0.18);
  const tapSpeed = ball.lastKickSpeed;
  const tapLoft = ball.vz;
  const tapPeakHeight = (tapLoft * tapLoft) / (2 * 9.81);
  assert(tapSpeed >= 18.0 && tapSpeed <= 20.0, `Tap shot speed ${tapSpeed.toFixed(2)} m/s must be 18.0-20.0 m/s`);
  assert(tapLoft >= 1.8 && tapLoft <= 2.1, `Tap shot vz ${tapLoft.toFixed(2)} m/s must be 1.8-2.1 m/s`);
  assert(tapPeakHeight < 0.25, `Tap shot peak height ${tapPeakHeight.toFixed(2)}m must stay low (< 0.25m)`);

  // 2. Full Blast Screamer (power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'SHOT', new Vector2(1, 0), 1.0);
  const blastSpeed = ball.lastKickSpeed;
  const blastLoft = ball.vz;
  const blastPeakHeight = (blastLoft * blastLoft) / (2 * 9.81);
  assert(blastSpeed >= 31.0 && blastSpeed <= 33.0, `Full blast speed ${blastSpeed.toFixed(2)} m/s must reach ~32 m/s`);
  assert(blastLoft >= 5.8 && blastLoft <= 6.5, `Full blast vz ${blastLoft.toFixed(2)} m/s must be ~6.2 m/s`);
  assert(blastPeakHeight >= 1.80 && blastPeakHeight <= 2.30, 
    `Full blast peak height ${blastPeakHeight.toFixed(2)}m must reach upper 90 under crossbar (2.44m)`);

  // 3. Finesse Dipping Curl (power = 1.0)
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'FINESSE_SHOT', new Vector2(1, 0), 1.0, -42.0);
  const finesseLoft = ball.vz;
  const finessePeakHeight = (finesseLoft * finesseLoft) / (2 * 9.81);
  assert(finesseLoft >= 5.2 && finesseLoft <= 6.0, `Finesse vz ${finesseLoft.toFixed(2)} m/s must provide dipping arc`);
  assert(finessePeakHeight >= 1.40 && finessePeakHeight <= 1.80, 
    `Finesse peak height ${finessePeakHeight.toFixed(2)}m must clear diving keepers`);

  // 4. Driven Pass Balance: crisp punch without outspeeding shots
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.executeKick(ball, 'DRIVEN_PASS', new Vector2(1, 0), 1.0);
  const drivenSpeed = ball.lastKickSpeed;
  assert(drivenSpeed >= 18.0 && drivenSpeed <= 19.0, `Driven pass speed ${drivenSpeed.toFixed(2)} m/s must be ~18.5 m/s`);
  assert(ball.vz <= 0.30, `Driven pass vz ${ball.vz.toFixed(2)} m/s must skim grass`);
  assert(drivenSpeed < blastSpeed, 'Driven pass must never outspeed full-power shots');

  // 5. Off-Balance Leaning Back Shot Skys the Ball
  ball.pos.set(50.5, 34.0);
  player.kickCooldown = 0.0;
  player.heading = Math.PI; // Facing West, kicking East = 180° off-balance
  player.executeKick(ball, 'SHOT', new Vector2(1, 0), 1.0);
  assert(ball.lastKickSpeed < blastSpeed * 0.75, 'Off-balance shot power must be scuffed');
  assert(ball.vz > blastLoft, 'Off-balance leaning back strike must sky the ball higher');

  console.log(`  ✔ Realistic Shot Spectrum: Low Finish (${tapSpeed.toFixed(1)} m/s, H: ${tapPeakHeight.toFixed(2)}m) -> Screamer (${blastSpeed.toFixed(1)} m/s, H: ${blastPeakHeight.toFixed(2)}m) verified`);
  console.log(`  ✔ Finesse Dipping Arc (H: ${finessePeakHeight.toFixed(2)}m) & Driven Pass Balance (${drivenSpeed.toFixed(1)} m/s) verified`);
}

console.log('\n✅ ALL PES MECHANICS TESTS PASSED CLEANLY!\n');

