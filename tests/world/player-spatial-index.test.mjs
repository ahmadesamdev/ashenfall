import assert from "node:assert/strict";
import { PlayerSpatialIndex } from "../../server/shared/PlayerSpatialIndex.ts";

const players = [
  { id: "viewer", zone: "forest", x: 0.49, y: 0.49, online: true },
  { id: "near-1", zone: "forest", x: 0.51, y: 0.49, online: true },
  { id: "near-2", zone: "forest", x: 0.48, y: 0.5, online: true },
  { id: "far", zone: "forest", x: 0.8, y: 0.8, online: true },
  { id: "other-zone", zone: "desert", x: 0.5, y: 0.5, online: true },
  { id: "offline", zone: "forest", x: 0.5, y: 0.5, online: false },
];
const index = new PlayerSpatialIndex(players, 0.05);
assert.deepEqual(
  index.nearby("forest", 0.49, 0.49, 0.04, "viewer").map((p) => p.id),
  ["near-2", "near-1"],
);
assert.deepEqual(
  index.nearby("forest", 0.49, 0.49, 0.04, "viewer", 1).map((p) => p.id),
  ["near-2"],
);
assert.deepEqual(
  index.nearby("desert", 0.49, 0.49, 0.04, "missing").map((p) => p.id),
  ["other-zone"],
);
assert.deepEqual(
  index.nearby("forest", 0.49, 0.49, 0.001, "viewer").map((p) => p.id),
  [],
);
assert.deepEqual(
  index.nearby("forest", Number.NaN, 0.49, 0.1).map((p) => p.id),
  [],
);

let seed = 73421;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const many = Array.from({ length: 2500 }, (_, i) => ({
  id: `p${i}`,
  zone: i % 9 === 0 ? "desert" : "forest",
  x: random(),
  y: random(),
  online: i % 31 !== 0,
}));
const largeIndex = new PlayerSpatialIndex(many, 0.05);
for (let i = 0; i < 30; i++) {
  const x = random(),
    y = random(),
    radius = 0.065,
    viewerId = `p${i}`;
  const expected = many
    .filter(
      (p) =>
        p.online &&
        p.zone === "forest" &&
        p.id !== viewerId &&
        Math.hypot(p.x - x, p.y - y) <= radius,
    )
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
    .slice(0, 250)
    .map((p) => p.id);
  assert.deepEqual(
    largeIndex.nearby("forest", x, y, radius, viewerId).map((p) => p.id),
    expected,
  );
}
console.log(
  "player spatial index regression: PASS — zones, online filtering, radius, nearest ordering, caps, and randomized parity",
);
