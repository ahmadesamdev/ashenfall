import * as React from "react";
import { ModalWindow } from "./ModalWindow.js";
import { CLASS_PORTRAITS } from "../config/GameClientConfig.js";

type AnyState = any;
const h = React.createElement;

function state(): AnyState | null {
  return (window as any).__ashenfallClientState ?? null;
}
function uiSelection() {
  return (window as any).__ashenfallReactUi || {};
}
function esc(value: any): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
function refresh(setVersion: (v: number) => void) {
  const on = () => setVersion(Date.now());
  window.addEventListener("ashenfall-ui-state", on);
  window.addEventListener("ashenfall-react-ui-refresh", on);
  return () => {
    window.removeEventListener("ashenfall-ui-state", on);
    window.removeEventListener("ashenfall-react-ui-refresh", on);
  };
}

export function SkillsModal({ visible }: { visible: boolean }) {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => refresh(setVersion), []);
  const s = state();
  const selected = uiSelection().selectedSkill;
  const cls = s?.catalog?.classes?.[s?.player?.classId] || {};
  const ids = s?.player?.abilityIds || [];
  const all = Object.entries(cls.abilityUnlocks || {});
  const skillId =
    selected && all.some(([id]) => id === selected)
      ? selected
      : all[0]?.[0] || null;
  const ability = skillId ? s?.catalog?.abilities?.[skillId] : null;
  const level = skillId ? cls.abilityUnlocks?.[skillId] : null;
  const details = ability
    ? [
        ability.power
          ? `Damage: ${Number(ability.power).toFixed(2)}× ${ability.scaling === "spell" ? "Spell Power" : "Attack"}`
          : null,
        ability.heal
          ? `Healing: ${(Number(ability.heal) * 100).toFixed(0)}% max health`
          : null,
        ability.hot
          ? `HoT: ${(Number(ability.hot.tickHeal || 0) * 100).toFixed(1)}% max health/sec for ${ability.hot.duration}s`
          : null,
        ability.status
          ? `${String(ability.status.id).replace(/_/g, " ")}: ${ability.status.damage || 0} damage/sec for ${ability.status.duration}s`
          : null,
        ability.debuff
          ? `Debuff: ${String(ability.debuff.id).replace(/_/g, " ")} for ${ability.debuff.duration}s`
          : null,
        ability.stun ? `Stun: ${ability.stun}s` : null,
        ability.executeThreshold
          ? `Execute: ${Math.round((Number(ability.executeMultiplier || 1) - 1) * 100)}% bonus power below ${Math.round(Number(ability.executeThreshold) * 100)}% HP`
          : null,
        ability.aoe
          ? `Area: ${ability.aoe.radius}m radius, up to ${ability.aoe.maxTargets || 6} targets`
          : null,
        ability.partyBuff
          ? `Party buff: ${Object.entries(ability.partyBuff.modifiers || {})
              .map(([k, v]) => `${k} +${v}%`)
              .join(", ")} for ${ability.partyBuff.duration}s`
          : null,
      ].filter(Boolean)
    : [];
  return h(
    ModalWindow,
    {
      id: "skillModal",
      cardClassName: "large skill-modal",
      title: "✨ Skills",
      screenLabel: "ABILITIES",
      visible,
    },
    h(
      "div",
      { className: "journal-layout" },
      h(
        "div",
        { id: "skillList", className: "journal-list" },
        all.map(([id, lvl]) => {
          const a = s?.catalog?.abilities?.[id] || {};
          const learned = ids.includes(id);
          return h(
            "button",
            {
              key: id,
              type: "button",
              draggable: false,
              "data-drag-kind": learned ? "ability" : "locked",
              "data-drag-id": id,
              className: `skill-entry ${skillId === id ? "selected" : ""}`,
              "data-action": "select-skill",
              "data-skill-id": id,
            },
            h("span", { className: "icon" }, a.icon || "✦"),
            h(
              "div",
              null,
              h("b", null, a.name || id),
              h(
                "div",
                { className: "muted" },
                learned ? "✅ Learned" : `🔒 Level ${lvl}`,
              ),
            ),
            h("span", { className: "spacer" }),
            learned ? null : "🔒",
          );
        }),
      ),
      h(
        "div",
        { id: "skillDetail", className: "detail-panel" },
        ability
          ? h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "skill-detail-grid" },
                h("div", { className: "skill-big" }, ability.icon || "✦"),
                h(
                  "div",
                  null,
                  h("h2", null, ability.name || skillId),
                  h(
                    "div",
                    { className: "muted" },
                    `${ids.includes(skillId) ? "✅ Learned" : "🔒 Not learned"} • Unlock level ${level || 1}`,
                  ),
                  h("p", null, ability.description || ""),
                ),
              ),
              h(
                "div",
                { className: "reward" },
                h("b", null, "Combat Details"),
                ...details.map((x: any, i: number) => h("div", { key: i }, x)),
                h("div", null, `Cooldown: ${ability.cooldown || 0}s`),
                h(
                  "div",
                  null,
                  `Resource: ${ability.cost || 0} ${s?.player?.resourceName || "Resource"}`,
                ),
                h("div", null, `GCD: ${ability.gcd || 0}s`),
                h(
                  "div",
                  null,
                  ability.aoe?.center === "self"
                    ? `Radius: ${ability.aoe.radius}m • centered on you`
                    : `Range: ${ability.range || 0}m`,
                ),
              ),
              h(
                "div",
                { className: "muted", style: { marginTop: "8px" } },
                ability.description || "",
              ),
            )
          : "Select a skill.",
      ),
    ),
  );
}

const gearSlots: [string, string][] = [
  ["weapon", "⚔️"],
  ["shield", "🛡️"],
  ["helmet", "⛑️"],
  ["chest", "🧥"],
  ["shoulders", "🪖"],
  ["gloves", "🧤"],
  ["boots", "🥾"],
  ["neck", "📿"],
  ["ring", "💍"],
  ["ring2", "💍"],
  ["relic", "🔮"],
  ["relic2", "🔮"],
];

function ProgressionPanel({ s }: { s: AnyState }) {
  const p = s?.player || {};
  const j = s?.progression?.journey || {};
  const n = j?.nextMilestone;
  const unlocks = n?.unlocks?.length ? n.unlocks : ["Level progression"];
  const zones = (j?.recommendedZones || [])
    .filter((x: any) => !x.city)
    .slice(0, 3);
  const dungeons = (j?.recommendedDungeons || []).slice(0, 3);
  const pct = Number(p.xpPercent || 0);
  return h(
    "div",
    { id: "characterProgressionPanel", className: "progression-panel" },
    h(
      "div",
      { className: "progression-overview" },
      h(
        "div",
        { className: "progression-level" },
        h("div", { className: "progression-level-badge" }, p.level || 1),
        h(
          "div",
          { className: "progression-level-copy" },
          h("b", null, p.bandName || "Initiate"),
          h("span", null, `Character Level • ${p.maxLevel || 60} cap`),
        ),
      ),
      h(
        "div",
        { className: "progression-xp" },
        h(
          "div",
          { className: "progression-xp-head" },
          h("b", null, "Experience"),
          h(
            "span",
            null,
            p.level >= p.maxLevel
              ? "MAX LEVEL"
              : `${Number(p.xp || 0).toLocaleString()} / ${Number(p.xpNext || 0).toLocaleString()} XP`,
          ),
        ),
        h(
          "div",
          { className: "progression-xp-bar" },
          h("i", { style: { width: `${pct}%` } }),
        ),
        h(
          "div",
          { className: "progression-xp-foot" },
          h(
            "span",
            null,
            `Total XP ${Number(p.totalXp || 0).toLocaleString()}`,
          ),
          h("span", null, `${pct}%`),
        ),
      ),
      h(
        "div",
        { className: "progression-next" },
        h(
          "b",
          null,
          n ? `Next milestone: Level ${n.level}` : "Endgame progression",
        ),
        h(
          "div",
          { className: "muted" },
          n ? "Unlocks and rewards" : "You have reached the level cap.",
        ),
        h(
          "div",
          { className: "unlock-list" },
          unlocks.map((x: any, i: number) =>
            h(
              "span",
              { key: i, className: "unlock-chip" },
              String(x).replace(/_/g, " "),
            ),
          ),
        ),
      ),
    ),
    h(
      "div",
      { className: "journey-card" },
      h(
        "div",
        { className: "journey-head" },
        h(
          "div",
          null,
          h("b", null, `Journey: ${j.focus || "Continue the Journey"}`),
          h(
            "span",
            null,
            j.goal ||
              "Explore the world, improve your gear and master your class.",
          ),
        ),
        j.nextSkill
          ? h(
              "div",
              { className: "journey-next-skill" },
              h("span", null, "Next skill "),
              h("strong", null, `Lv ${j.nextSkill.level}`),
              h(
                "small",
                null,
                s.catalog?.abilities?.[j.nextSkill.id]?.name || j.nextSkill.id,
              ),
            )
          : null,
      ),
      h(
        "div",
        { className: "journey-row" },
        h(
          "div",
          null,
          h("label", null, "Explore"),
          h(
            "div",
            { className: "journey-chips" },
            zones.length
              ? zones.map((z: any) =>
                  h(
                    "span",
                    { key: z.id, className: "journey-chip" },
                    z.name,
                    " ",
                    h("small", null, `Lv ${z.minLevel}-${z.maxLevel}`),
                  ),
                )
              : h(
                  "span",
                  { className: "journey-fallback" },
                  "Explore the current story regions.",
                ),
          ),
        ),
        h(
          "div",
          null,
          h("label", null, "Group"),
          h(
            "div",
            { className: "journey-chips" },
            dungeons.length
              ? dungeons.map((d: any) =>
                  h(
                    "span",
                    { key: d.id, className: "journey-chip dungeon" },
                    `🏰 ${d.name} `,
                    h("small", null, `Lv ${d.minLevel}+`),
                  ),
                )
              : h(
                  "span",
                  { className: "journey-fallback" },
                  "Dungeons unlock as you progress.",
                ),
          ),
        ),
      ),
    ),
  );
}

function Loadouts({ s }: { s: AnyState }) {
  const loads = s?.progression?.loadouts || [];
  const slots = ["leveling", "dungeon", "boss", "pvp"];
  const names: any = {
    leveling: "Leveling",
    dungeon: "Dungeon",
    boss: "Boss",
    pvp: "PvP",
  };
  const cards = slots.map((slot) => {
    const l = loads.find((x: any) => x.slot === slot);
    const actions = l
      ? h(
          React.Fragment,
          null,
          h(
            "button",
            {
              className: "primary",
              "data-action": "apply-loadout",
              "data-loadout-id": l.id,
              disabled: l.active,
            },
            l.active ? "Active" : "Apply",
          ),
          h(
            "button",
            { "data-action": "save-loadout", "data-slot": slot },
            "Overwrite",
          ),
          h(
            "button",
            {
              "data-action": "delete-loadout",
              "data-loadout-id": l.id,
              "data-slot": slot,
            },
            "Delete",
          ),
        )
      : h(
          "button",
          { "data-action": "save-loadout", "data-slot": slot },
          "Save Current",
        );
    return h(
      "div",
      { key: slot, className: `loadout-card ${l?.active ? "active" : ""}` },
      h("h4", null, l?.name || names[slot]),
      h(
        "div",
        { className: "loadout-meta" },
        names[slot],
        l?.active ? " • Active" : "",
      ),
      l
        ? h(
            "div",
            { className: "muted" },
            `${l.buildId || "No specialization"} • Saved ${new Date(l.savedAt || Date.now()).toLocaleDateString()}`,
          )
        : h("div", { className: "loadout-empty" }, "No saved loadout."),
      h("div", { className: "loadout-actions" }, actions),
    );
  });
  return h("div", { id: "loadoutList", className: "loadout-grid" }, ...cards);
}

function CharacterGear({
  p,
  items,
  bonuses,
}: {
  p: any;
  items: any;
  bonuses: any;
}) {
  return h(
    "div",
    { id: "characterGear" },
    ...gearSlots.map(([slot, icon]) => {
      const id = p.equipment?.[slot];
      const it = id ? items[id] : null;
      const score = (bonuses.gearItems || []).find(
        (x: any) => x.id === id,
      )?.gearScore;
      return h(
        "div",
        { key: slot, className: "item gear-slot-row" },
        h("span", { className: "gear-slot-icon" }, icon),
        h(
          "div",
          { className: "gear-item-main" },
          h("b", null, it?.name || "Empty"),
          h(
            "div",
            { className: "muted" },
            `${slot}${score ? ` • Gear Score ${Number(score).toFixed(1)}` : ""}`,
          ),
        ),
        h(
          "span",
          { className: `gear-state ${it ? "equipped" : "empty"}` },
          it ? "Equipped" : "Empty",
        ),
        it
          ? h(
              "button",
              {
                type: "button",
                className: "gear-unequip",
                "data-cmd": "unequip",
                "data-slot": slot,
              },
              "Unequip",
            )
          : h("span", {
              className: "gear-unequip-placeholder",
              "aria-hidden": "true",
            }),
      );
    }),
  );
}

function CharacterStats({
  p,
  stats,
  bonuses,
}: {
  p: any;
  stats: any;
  bonuses: any;
}) {
  const derived = [
    ["Attack", p.attack || 0],
    ["Spell Power", p.spellPower || p.attack || 0],
    ["Armor", p.armor || 0],
    ["HP", p.maxHp || 0],
    [p.resourceName || "Resource", p.maxResolve || 0],
    ["Gear Score", Number(bonuses.gearScore || 0).toFixed(1)],
    ["Avg Item Level", Number(bonuses.averageItemLevel || 0).toFixed(1)],
    ["Build Score", Number(bonuses.gearBuildScore || 0).toFixed(1)],
  ];
  const derivedNodes = derived.map(([name, value]) =>
    h("div", { key: String(name) }, name, ": ", h("b", null, value)),
  );
  derivedNodes.push(
    h("div", { key: "haste" }, `Haste: ${bonuses.haste || 0}%`),
  );
  derivedNodes.push(h("div", { key: "crit" }, `Crit: ${bonuses.crit || 0}%`));
  derivedNodes.push(
    h(
      "div",
      { key: "bleed" },
      `Bleed: +${bonuses.bleedDamage || 0}% dmg / +${bonuses.bleedDuration || 0}% duration`,
    ),
  );
  derivedNodes.push(
    h(
      "div",
      { key: "stun" },
      `Stun: +${bonuses.stunDuration || 0}% duration / -${bonuses.stunResist || 0}% received`,
    ),
  );
  derivedNodes.push(
    h("div", { key: "hot" }, `HoT: +${bonuses.hotDuration || 0}% duration`),
  );
  const statNodes = Object.entries(stats).map(([k, v]: any) =>
    h(
      "div",
      { key: k, className: "stat-row" },
      h("b", null, k),
      h("span", null, Number(v) || 0),
      h(
        "button",
        {
          type: "button",
          "data-cmd": "allocate_stat",
          "data-stat": k,
          "data-amount": "1",
          disabled: !(p.statPoints > 0),
        },
        "+",
      ),
    ),
  );
  statNodes.push(
    h(
      "div",
      { key: "points", className: "muted" },
      `${p.statPoints || 0} stat point(s) available.`,
    ),
  );
  return h(
    "div",
    null,
    h("h3", null, "Overall Stats"),
    h("div", { id: "characterDerived" }, ...derivedNodes),
    h("h3", null, "Attributes"),
    h("div", { id: "characterStats" }, ...statNodes),
  );
}
export function CharacterModal({ visible }: { visible: boolean }) {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => refresh(setVersion), []);
  const s = state();
  const p = s?.player || {};
  const items = s?.catalog?.items || {};
  const stats = p.stats || {};
  const bonuses = p.bonuses || {};
  return h(
    ModalWindow,
    {
      id: "characterModal",
      cardClassName: "xlarge",
      title: "🧙 Character & Progression",
      subtitle: "Your level, gear, milestones and combat identity.",
      screenLabel: "CHARACTER",
      visible,
    },
    h(
      "div",
      { className: "character-sheet" },
      h(
        "div",
        { className: "character-sheet-head" },
        h("div", {
          className: "avatar",
          id: "characterAvatar",
          style: {
            backgroundImage: `url('/assets/ashenfall/classes/${CLASS_PORTRAITS[p.classId] || ""}')`,
            backgroundSize: "contain",
            backgroundPosition: "center top",
            backgroundRepeat: "no-repeat",
          },
        }),
        h(
          "div",
          null,
          h("h2", { id: "characterNameBig" }, p.name || ""),
          h(
            "div",
            { id: "characterMetaBig", className: "muted" },
            `${p.icon || ""} ${p.role || "Adventurer"} • Level ${p.level || 1} • ${s?.progression?.bandName || "Initiate"}`,
          ),
        ),
      ),
      h(ProgressionPanel, { s }),
      h(
        "div",
        { className: "character-cols" },
        h(CharacterStats, { p, stats, bonuses }),
        h(
          "div",
          null,
          h("h3", null, "Equipped"),
          h(CharacterGear, { p, items, bonuses }),
        ),
      ),
      h(
        "div",
        { className: "loadout-section" },
        h(
          "div",
          { className: "section-head" },
          h(
            "div",
            null,
            h("h3", null, "Combat Loadouts"),
            h(
              "span",
              { className: "muted" },
              "Save gear + specialization + talents + attributes for fast swapping outside combat.",
            ),
          ),
        ),
        h(Loadouts, { s }),
      ),
    ),
  );
}
function QuestList({ s, selection }: { s: AnyState; selection: any }) {
  const p = s?.player || {};
  const tab = selection.questJournalTab || "current";
  if (tab === "story") {
    const arcs = s?.storyProgress?.arcs || [];
    return h(
      React.Fragment,
      null,
      arcs.length
        ? arcs.map((a: any, i: number) =>
            h(
              "button",
              {
                key: a.id,
                type: "button",
                className: `journal-entry ${selection.selectedStoryArcId === a.id ? "selected" : ""}`,
                "data-action": "story-arc",
                "data-story-arc-id": a.id,
              },
              h("b", null, `Arc ${i + 1}  -  ${a.name}`),
              h(
                "div",
                { className: "muted" },
                `${a.completed}/${a.total} quests completed${a.active ? ` • ${a.active} active` : ""}`,
              ),
              h(
                "div",
                { className: "muted" },
                (a.zones || [])
                  .map(
                    (id: any) =>
                      s.zones?.find((z: any) => z.id === id)?.name ||
                      String(id).replace(/_/g, " "),
                  )
                  .join(" • "),
              ),
            ),
          )
        : h("div", { className: "muted" }, "The story records are empty."),
    );
  }
  const dynamic = (s.worldIntegration?.contracts || [])
    .filter((c: any) => c.status === "active")
    .map((c: any) => [
      c.id,
      {
        title: c.title,
        progress: Number(c.objectiveIndex || 0),
        amount: Number((c.objectives || []).length || 3),
        complete: false,
        accepted: true,
      },
    ]);
  const list = [
    ...dynamic,
    ...Object.entries(p.quests || {})
      .filter(([_, q]: any) => q.accepted || q.claimed || q.complete)
      .filter(([_, q]: any) => (tab === "current" ? !q.claimed : q.claimed)),
  ];
  return h(
    React.Fragment,
    null,
    list.length
      ? list.map(([id, q]: any) => {
          const d = s.catalog?.quests?.find((x: any) => x.id === id) || {};
          const dynamicQuest = String(id).startsWith("wc:");
          const amount = dynamicQuest ? q.amount || 3 : d.amount || 1;
          return h(
            "button",
            {
              key: id,
              type: "button",
              className: `journal-entry ${selection.selectedQuest === id ? "selected" : ""}`,
              "data-action": "select-quest",
              "data-quest-id": id,
            },
            h(
              "b",
              null,
              dynamicQuest ? q.title || "Dynamic World Quest" : d.name || id,
            ),
            h(
              "div",
              { className: "muted" },
              `${dynamicQuest ? "world quest" : d.category || "world"} • ${q.progress || 0}/${amount} ${q.complete ? "✓ Completed" : q.accepted ? "Active" : "Available"}`,
            ),
          );
        })
      : h(
          "div",
          { className: "muted" },
          tab === "completed"
            ? "No completed quests yet."
            : "No accepted quests yet.",
        ),
  );
}

function StoryArcDetail({ s, selection }: { s: AnyState; selection: any }) {
  const arcs = s?.storyProgress?.arcs || [];
  const arc =
    arcs.find((x: any) => x.id === selection.selectedStoryArcId) ||
    arcs.find((x: any) => x.id === s?.storyProgress?.currentArcId) ||
    arcs[0];
  if (!arc)
    return h("div", { className: "muted" }, "The story records are empty.");
  const zoneNames = (arc.zones || [])
    .map(
      (id: any) =>
        s.zones?.find((z: any) => z.id === id)?.name ||
        String(id).replace(/_/g, " "),
    )
    .join(" • ");
  const quests = s?.player?.quests || {};
  return h(
    "div",
    { className: "story-codex" },
    h("div", { className: "eyebrow" }, `STORY ARC ${Number(arc.index) + 1}`),
    h("h2", null, arc.name),
    h(
      "div",
      { className: "muted" },
      `${arc.completed}/${arc.total} quests completed`,
    ),
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Purpose"),
      h("p", null, arc.purpose || ""),
    ),
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Regions"),
      h("p", null, zoneNames),
    ),
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Story quests"),
      ...(arc.quests || []).map((id: any) => {
        const q = s.catalog?.quests?.find((x: any) => x.id === id);
        const st = quests[id] || {};
        const cls = st.claimed
          ? "completed"
          : st.accepted
            ? st.complete
              ? "ready"
              : "active"
            : "locked";
        const label = st.claimed
          ? "✓ Completed"
          : st.accepted
            ? st.complete
              ? "✓ Ready to turn in"
              : "Active"
            : "Not yet discovered";
        return h(
          "div",
          { key: id, className: "story-codex-quest" },
          h(
            "div",
            { className: "story-quest-name" },
            h("b", null, q?.name || id),
          ),
          h("div", { className: `story-quest-status ${cls}` }, label),
        );
      }),
    ),
  );
}

function QuestDetail({ s, selection }: { s: AnyState; selection: any }) {
  const id = selection.selectedQuest;
  if (!id) return h("div", { className: "muted" }, "Select a quest.");
  if (String(id).startsWith("wc:")) {
    const c = (s.worldIntegration?.contracts || []).find(
      (x: any) => String(x.id) === String(id),
    );
    if (!c)
      return h(
        "div",
        { className: "muted" },
        "This world quest is no longer active.",
      );
    const steps = c.objectives || [];
    const idx = Math.min(Number(c.objectiveIndex || 0), steps.length);
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "quest-detail-head" },
        h(
          "div",
          { className: "eyebrow" },
          `WORLD QUEST • ${String(c.kind || "world").replace(/_/g, " ")}`,
        ),
        h("h2", null, c.title || "Dynamic World Quest"),
        h(
          "div",
          { className: "muted quest-status-line" },
          `${idx >= steps.length ? "✓ Completed" : "Active"} • ${idx}/${steps.length} objectives`,
        ),
      ),
      h(
        "div",
        { className: "quest-lore" },
        h("b", null, "Situation"),
        h(
          "p",
          null,
          c.description ||
            "The world has changed and is asking for a response.",
        ),
      ),
      h(
        "div",
        { className: "quest-lore" },
        h("b", null, "Objectives"),
        ...steps.map((x: any, i: number) =>
          h(
            "div",
            { key: i, className: "story-codex-quest" },
            h(
              "div",
              { className: "story-quest-name" },
              h("b", null, `${i < idx ? "✓" : i === idx ? "→" : "○"} ${x}`),
            ),
            h(
              "div",
              { className: "muted" },
              i < idx
                ? "Completed"
                : i === idx
                  ? "Current objective"
                  : "Upcoming",
            ),
          ),
        ),
      ),
      h(
        "div",
        { className: "quest-lore" },
        h("b", null, "Location"),
        h(
          "p",
          null,
          `📍 ${s.zoneInfo?.name || c.regionId || "Unknown region"}`,
        ),
      ),
      idx < steps.length
        ? h(
            "div",
            { className: "actions-inline" },
            h(
              "button",
              {
                className: "primary",
                "data-action": "world-contract-action",
                "data-contract-id": c.id,
              },
              c.label || "Continue World Quest",
            ),
          )
        : null,
    );
  }
  const d = s.catalog?.quests?.find((x: any) => x.id === id);
  const q = s.player?.quests?.[id] || {};
  if (!d) return h("div", { className: "muted" }, "Quest data unavailable.");
  const status = q.claimed
    ? "Completed"
    : q.complete
      ? "Ready to turn in"
      : q.accepted
        ? "Active"
        : "Not yet discovered";
  const targetZone = d.target
    ? s.zones?.find((z: any) => z.id === d.target)?.name ||
      String(d.target).replace(/_/g, " ")
    : s.zoneInfo?.name;
  const reward = d.reward || {};
  const rewardText =
    [
      reward.xp ? `✨ ${reward.xp} XP` : "",
      reward.gold ? `🪙 ${reward.gold} gold` : "",
      reward.item
        ? `📦 ${s.catalog?.items?.[reward.item]?.name || reward.item}`
        : "",
    ]
      .filter(Boolean)
      .join(" • ") || "See the quest reward on turn-in.";
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "quest-detail-head" },
      h("div", { className: "eyebrow" }, d.chapter || "Quest"),
      h("h2", null, d.name || id),
      h(
        "div",
        { className: "muted quest-status-line" },
        `${status} • ${Number(q.progress || 0)}/${Number(d.amount || 1)}`,
      ),
    ),
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Objective"),
      h("p", null, d.description || d.story || "Follow the quest objective."),
    ),
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Location"),
      h("p", null, `📍 ${targetZone || "Unknown"}`),
    ),
    d.story
      ? h(
          "div",
          { className: "quest-lore" },
          h("b", null, "Story"),
          h("p", null, d.story),
        )
      : null,
    h(
      "div",
      { className: "quest-lore" },
      h("b", null, "Reward"),
      h("p", null, rewardText),
    ),
    h(
      "div",
      { className: "actions-inline" },
      h(
        "button",
        {
          type: "button",
          className:
            String(s.player?.activeQuestId || "") === String(id)
              ? "primary"
              : "",
          "data-action": "set-active-quest",
          "data-quest-id": id,
        },
        String(s.player?.activeQuestId || "") === String(id)
          ? "✓ Active Quest Helper"
          : "Set Active Quest Helper",
      ),
      q.complete && !q.claimed
        ? h(
            "button",
            {
              className: "primary",
              "data-cmd": "turnin_quest",
              "data-quest-id": id,
            },
            "Turn In Quest",
          )
        : null,
    ),
  );
}

export function QuestModal({ visible }: { visible: boolean }) {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => refresh(setVersion), []);
  const s = state();
  const sel = uiSelection();
  const tab = sel.questJournalTab || "current";
  const entries = Object.entries(s?.player?.quests || {});
  const active = entries.filter(
    ([_, q]: any) => q?.accepted && !q?.claimed,
  ).length;
  const ready = entries.filter(
    ([_, q]: any) => q?.complete && !q?.claimed,
  ).length;
  const done = entries.filter(([_, q]: any) => q?.claimed).length;
  const selection = { ...sel };
  if (selection.questJournalTab !== "story" && !selection.selectedQuest) {
    const first = entries.find(([_, q]: any) =>
      selection.questJournalTab === "current"
        ? (q?.accepted || q?.complete) && !q?.claimed
        : q?.claimed,
    );
    if (first) selection.selectedQuest = first[0];
  }
  if (selection.questJournalTab === "story" && !selection.selectedStoryArcId)
    selection.selectedStoryArcId =
      s?.storyProgress?.currentArcId || s?.storyProgress?.arcs?.[0]?.id || null;
  return h(
    ModalWindow,
    {
      id: "questModal",
      cardClassName: "large",
      title: "📜 Quest Journal",
      screenLabel: "QUEST LOG",
      visible,
    },
    h(
      "div",
      { id: "questJournalSummary", className: "quest-journal-summary" },
      h(
        "div",
        null,
        h("div", { className: "eyebrow" }, "QUEST HUB"),
        h("h3", null, "Adventures & Objectives"),
      ),
      h(
        "div",
        { className: "summary-stats" },
        h("span", null, h("b", null, active), " Active"),
        h("span", null, h("b", null, ready), " Ready"),
        h("span", null, h("b", null, done), " Done"),
      ),
    ),
    h(
      "div",
      { className: "quest-tabs" },
      ["current", "completed", "story"].map((x) =>
        h(
          "button",
          {
            key: x,
            type: "button",
            "data-action": "quest-tab",
            "data-tab": x,
            className: tab === x ? "active" : "",
          },
          x[0].toUpperCase() + x.slice(1),
        ),
      ),
    ),
    h(
      "div",
      { className: "journal-layout" },
      h(
        "div",
        { id: "questList", className: "journal-list" },
        s ? h(QuestList, { s, selection }) : null,
      ),
      h(
        "div",
        { id: "questDetail", className: "detail-panel" },
        s
          ? tab === "story"
            ? h(StoryArcDetail, { s, selection })
            : h(QuestDetail, { s, selection })
          : "Select a quest.",
      ),
    ),
  );
}

export function BuildModal({ visible }: { visible: boolean }) {
  return h(
    ModalWindow,
    {
      id: "buildModal",
      cardClassName: "xlarge",
      title: "✦ Build & Talents",
      screenLabel: "BUILD & TALENTS",
      visible,
    },
    h("div", { id: "buildResetSection", className: "build-choice-section" }),
    h("div", { id: "talentList", className: "talent-list" }),
  );
}
