import fs from "node:fs";
const read = (n) =>
  JSON.parse(fs.readFileSync(new URL(`../${n}`, import.meta.url), "utf8"));
const abilities = read("game-data/abilities/abilities.json"),
  classes = read("game-data/classes/classes.json");
const byId = Object.fromEntries(abilities.map((a) => [a.id, a]));

const baseline = read("scripts/balance-baseline.json");
const original = (a) => ({
  ...a,
  power: baseline[a.id]?.power ?? a.power,
  heal: baseline[a.id]?.heal ?? a.heal,
  castTime: 0,
});
function simulate(
  kit,
  { miss = 0, crit = 15, critSuppress = 0, seconds = 120 },
) {
  const cds = {};
  let t = 0,
    total = 0,
    casts = 0;
  const effCrit = Math.max(0, crit - critSuppress) / 100,
    critMult = 1 + effCrit * 0.5;
  while (t < seconds) {
    let best = null;
    for (const a of kit) {
      if ((cds[a.id] || 0) > t || !(a.power > 0) || a.selfBuff) continue;
      const time = Math.max(Number(a.gcd || 1.2), Number(a.castTime || 0));
      const aoeFactor = 1;
      const score = (a.power * aoeFactor) / time;
      if (!best || score > best.score) best = { a, time, score };
    }
    if (!best) {
      t += 0.25;
      continue;
    }
    total += best.a.power * critMult * (1 - miss);
    casts++;
    cds[best.a.id] = t + Number(best.a.cooldown || 0);
    t += best.time;
  }
  return { dps: total / seconds, casts };
}
const rows = [];
for (const c of classes) {
  const unlocks =
    c.abilityUnlocks && !Array.isArray(c.abilityUnlocks)
      ? c.abilityUnlocks
      : {};
  for (const level of [1, 10, 20, 30, 45, 60]) {
    const ids = new Set([
      ...(c.startSkills || []),
      "basic_strike",
      ...Object.entries(unlocks)
        .filter(([, lv]) => Number(lv) <= level)
        .map(([id]) => id),
    ]);
    const now = [...ids].map((id) => byId[id]).filter(Boolean),
      before = now.map(original);
    const b = simulate(before, { miss: 0, critSuppress: 0 });
    const open = simulate(now, { miss: 0.05, critSuppress: 0 });
    const boss = simulate(now, { miss: 0.08, critSuppress: 1.5 });
    const castShare = now.filter((a) => a.castTime > 0).length;
    rows.push({
      class: c.id,
      level,
      abilities: now.length,
      castAbilities: castShare,
      before: +b.dps.toFixed(3),
      open: +open.dps.toFixed(3),
      openRatio: +(open.dps / b.dps).toFixed(3),
      bossRatio: +(boss.dps / b.dps).toFixed(3),
    });
  }
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
console.log(
  "class        lvl  abil cast   before   open   open/before  boss/before",
);
for (const r of rows)
  console.log(
    `${r.class.padEnd(12)} ${String(r.level).padStart(3)}  ${String(r.abilities).padStart(4)} ${String(r.castAbilities).padStart(4)}   ${r.before.toFixed(2).padStart(6)}  ${r.open.toFixed(2).padStart(6)}   ${r.openRatio.toFixed(3).padStart(8)}   ${r.bossRatio.toFixed(3).padStart(8)}`,
  );
const spread = (lvl) => {
  const rs = rows.filter((r) => r.level === lvl).map((r) => r.openRatio);
  return (Math.max(...rs) - Math.min(...rs)).toFixed(3);
};
console.log(
  "\nopen-world ratio spread across classes (max-min): " +
    [10, 30, 60].map((l) => `L${l}=${spread(l)}`).join("  "),
);
