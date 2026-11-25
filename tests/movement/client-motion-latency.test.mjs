import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const modulePath =
  process.env.MOTION_CONTROLLER_PATH ||
  path.join(root, "dist/client/runtime/ClientMotionController.js");
const { ClientMotionController } = await import(pathToFileURL(modulePath).href);

let clock = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => clock },
  configurable: true,
});
const realDateNow = Date.now;
Date.now = () => 1_000_000 + clock;

const WORLD_METERS = 10000;
const SPEED = 65;

function simulate({ oneWayMs, holdMs, totalMs }) {
  clock = 0;
  const player = {
    hasCharacter: true,
    zone: "z",
    x: 0.5,
    y: 0.5,
    runSpeed: SPEED,
    speed: 45,
  };
  const controller = new ClientMotionController({
    getPlayer: () => player,
    getClockOffset: () => 0,
    getWorldMeters: () => WORLD_METERS,
    getRttMs: () => oneWayMs * 2,
  });
  controller.reset(0.5, 0.5, "z");

  const inbound = [];
  let serverX = 0.5;
  let serverMoving = false;
  let sequence = 1;
  let nextSampleAt = 0;
  const pendingInputs = [];
  const frames = [];
  const sendSample = () => {
    inbound.push({
      deliverAt: clock + oneWayMs,
      sample: {
        zone: "z",
        x: serverX,
        y: 0.5,
        vx: serverMoving ? SPEED / WORLD_METERS : 0,
        vy: 0,
        state: serverMoving ? "moving" : "idle",
        movementIntent: serverMoving ? "manual" : "none",
        serverNow: Date.now(),
        sequence: sequence++,
        speedMeters: SPEED,
        movementMode: "run",
      },
    });
  };

  controller.tick(0);
  let pressed = false;
  let released = false;
  for (clock = 16; clock <= totalMs; clock += 16) {
    if (!pressed && clock >= 100) {
      pressed = true;
      controller.setInput(1, 0, "run");
      pendingInputs.push({ at: clock + oneWayMs, moving: true });
    }
    if (pressed && !released && clock >= 100 + holdMs) {
      released = true;
      controller.stop();
      pendingInputs.push({ at: clock + oneWayMs, moving: false });
    }
    while (pendingInputs.length && pendingInputs[0].at <= clock)
      serverMoving = pendingInputs.shift().moving;
    if (serverMoving) serverX += (SPEED / WORLD_METERS) * 0.016;
    if (clock >= nextSampleAt) {
      sendSample();
      nextSampleAt = clock + 50;
    }
    while (inbound.length && inbound[0].deliverAt <= clock)
      controller.sync(inbound.shift().sample);
    const pos = controller.tick(clock);
    frames.push({ t: clock, x: pos.x * WORLD_METERS, released });
  }
  return { frames, serverFinal: serverX * WORLD_METERS };
}

for (const oneWayMs of [60, 120, 150, 250]) {
  const { frames, serverFinal } = simulate({
    oneWayMs,
    holdMs: 2400,
    totalMs: 4600,
  });
  const holding = frames.filter((f) => !f.released);
  let worstBack = 0;
  for (let i = 1; i < holding.length; i++)
    worstBack = Math.min(worstBack, holding[i].x - holding[i - 1].x);
  assert.ok(
    worstBack >= -0.01,
    `${oneWayMs} ms one-way: the character never moves backward while the key is held (worst step ${worstBack.toFixed(2)} m)`,
  );
  const last = frames[frames.length - 1].x;
  assert.ok(
    Math.abs(last - serverFinal) < 1.5,
    `${oneWayMs} ms one-way: the client settles on the server position (client ${last.toFixed(1)} m, server ${serverFinal.toFixed(1)} m)`,
  );
  let worstSettle = 0;
  const after = frames.filter((f) => f.released);
  for (let i = 1; i < after.length; i++)
    worstSettle = Math.min(worstSettle, after[i].x - after[i - 1].x);
  assert.ok(
    worstSettle > -2.5,
    `${oneWayMs} ms one-way: settling after release is smooth, never a snap (worst frame ${worstSettle.toFixed(2)} m)`,
  );
}

Date.now = realDateNow;
console.log(
  "motion-latency: PASS — no pull-backs while moving and smooth settling at 60, 120, 150 and 250 ms one-way latency",
);
