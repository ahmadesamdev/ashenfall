export const STORY_FACTIONS = Object.freeze([
  { id: "stonehold_council", name: "Stonehold Council", min: -1000, max: 1000 },
  { id: "lantern_guard", name: "Lantern Guard", min: -1000, max: 1000 },
  { id: "veil_wardens", name: "Veil Wardens", min: -1000, max: 1000 },
  { id: "ashen_covenant", name: "Ashen Covenant", min: -1000, max: 1000 },
  { id: "the_hollow", name: "The Hollow", min: -1000, max: 1000 },
]);

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number(n) || 0));

export function ensureStoryState(p: any) {
  p.storyFlags =
    p.storyFlags && typeof p.storyFlags === "object" ? p.storyFlags : {};
  p.storyChoices =
    p.storyChoices && typeof p.storyChoices === "object" ? p.storyChoices : {};
  p.factionReputation =
    p.factionReputation && typeof p.factionReputation === "object"
      ? p.factionReputation
      : {};
  for (const f of STORY_FACTIONS)
    p.factionReputation[f.id] = clamp(
      p.factionReputation[f.id] ?? 0,
      f.min,
      f.max,
    );
  p.loreDiscoveries = Array.isArray(p.loreDiscoveries) ? p.loreDiscoveries : [];
  p.classStory =
    p.classStory && typeof p.classStory === "object" ? p.classStory : {};
  p.worldStoryState =
    p.worldStoryState && typeof p.worldStoryState === "object"
      ? p.worldStoryState
      : {};
  return p;
}

export function factionTier(rep: number) {
  const r = Number(rep) || 0;
  if (r >= 750) return "exalted";
  if (r >= 500) return "revered";
  if (r >= 250) return "friendly";
  if (r >= 0) return "neutral";
  if (r >= -250) return "wary";
  if (r >= -500) return "hostile";
  return "hated";
}

export function applyReputation(p: any, changes: any = {}) {
  ensureStoryState(p);
  const applied: any = {};
  for (const f of STORY_FACTIONS) {
    if (changes[f.id] == null) continue;
    const before = p.factionReputation[f.id];
    const after = clamp(before + Number(changes[f.id] || 0), -1000, 1000);
    p.factionReputation[f.id] = after;
    applied[f.id] = {
      before,
      delta: after - before,
      after,
      tier: factionTier(after),
    };
  }
  return applied;
}

export function storyWorldState(p: any, worldStory: any) {
  ensureStoryState(p);
  const flags = p.storyFlags;
  const phases: any = {
    stonehold_awareness: Number(p.storyChapter || 0) >= 1,
    gloamwood_awakened: Number(p.storyChapter || 0) >= 2,
    black_citadel_alert: Number(p.storyChapter || 0) >= 3,
    eastern_road_open: Number(p.storyChapter || 0) >= 5,
    old_kingdom_revealed: Number(p.storyChapter || 0) >= 6,
    memory_roads_active: Number(p.storyChapter || 0) >= 7,
    hollow_court_awakened: Number(p.storyChapter || 0) >= 8,
    first_stitch_revealed: Number(p.storyChapter || 0) >= 9,
    final_bells_active: Number(p.storyChapter || 0) >= 10,
    council_trust: !!flags.choice_council_truth,
    guard_loyalty: !!flags.choice_guard_duty,
    covenant_contact: !!flags.choice_covenant_heard,
    hollow_contact: !!flags.choice_hollow_listened,
  };
  const rules = worldStory?.worldPhases || [];
  for (const r of rules) {
    if (r.flag && flags[r.flag]) phases[r.id] = true;
  }
  return phases;
}

export function currentStoryArc(p: any, storyline: any) {
  ensureStoryState(p);
  const chapter = Number(p.storyChapter || 0);
  return (
    (storyline?.chapters || []).find((x: any) => Number(x.id) === chapter) ||
    null
  );
}

export function eligibleChoice(p: any, choice: any) {
  ensureStoryState(p);
  if (!choice) return false;
  if (p.storyChoices[choice.id]) return false;
  if (Number(p.storyChapter || 0) < Number(choice.minChapter || 0))
    return false;
  if (choice.requiresFlag && !p.storyFlags[choice.requiresFlag]) return false;
  if (choice.requiresFaction) {
    const rep = Number(p.factionReputation?.[choice.requiresFaction.id] || 0);
    if (rep < Number(choice.requiresFaction.min || 0)) return false;
  }
  return true;
}

export function makeChoice(p: any, choice: any) {
  ensureStoryState(p);
  if (!eligibleChoice(p, choice))
    return [false, "That story choice is no longer available."];
  p.storyChoices[choice.id] = choice.outcomeId || choice.id;
  if (choice.flag) p.storyFlags[choice.flag] = true;
  const reputation = applyReputation(p, choice.reputation || {});
  if (choice.worldState)
    for (const [k, v] of Object.entries(choice.worldState))
      p.worldStoryState[k] = v;
  return [
    true,
    "Choice recorded.",
    {
      choiceId: choice.id,
      outcomeId: choice.outcomeId || choice.id,
      reputation,
      worldState: p.worldStoryState,
    },
  ];
}

export function classStoryState(p: any, classStories: any) {
  ensureStoryState(p);
  const def = classStories?.classes?.[p.classId];
  if (!def) return null;
  const state = p.classStory[p.classId] || { completed: [], current: null };
  const completed = new Set(state.completed || []);
  const next = (def.steps || []).find(
    (s: any) =>
      !completed.has(s.id) &&
      Number(p.level || 1) >= Number(s.minLevel || 1) &&
      (!s.requires || s.requires.every((id: string) => completed.has(id))),
  );
  return {
    classId: p.classId,
    name: def.name,
    steps: def.steps || [],
    completed: [...completed],
    next: next || null,
  };
}

export function claimClassStory(p: any, step: any, classStories: any) {
  ensureStoryState(p);
  const def = classStories?.classes?.[p.classId];
  if (!def || !step) return [false, "Unknown class story."];
  const state = p.classStory[p.classId] || { completed: [], current: null };
  if ((state.completed || []).includes(step.id))
    return [false, "That class story chapter is already complete."];
  if (Number(p.level || 1) < Number(step.minLevel || 1))
    return [false, `Reach level ${step.minLevel} first.`];
  if (
    (step.requires || []).some(
      (id: string) => !(state.completed || []).includes(id),
    )
  )
    return [false, "Complete the previous class story chapter first."];
  state.completed = [...(state.completed || []), step.id];
  state.current = null;
  p.classStory[p.classId] = state;
  if (step.flag) p.storyFlags[step.flag] = true;
  const reputation = applyReputation(p, step.reputation || {});
  if (step.reward) {
    p.gold = Number(p.gold || 0) + Number(step.reward.gold || 0);
  }
  return [
    true,
    "Class story chapter complete.",
    { step, reputation, reward: step.reward || {} },
  ];
}

export function discoverLore(p: any, entry: any) {
  ensureStoryState(p);
  if (!entry) return [false, "Unknown lore entry."];
  if (p.zone !== entry.zone)
    return [false, "This lore is not in your current zone."];
  if (p.loreDiscoveries.includes(entry.id))
    return [false, "Lore already discovered."];
  if (Number(p.level || 1) < Number(entry.minLevel || 1))
    return [false, `Reach level ${entry.minLevel} first.`];
  p.loreDiscoveries.push(entry.id);
  p.storyFlags[`lore:${entry.id}`] = true;
  const reward = entry.reward || {};
  p.gold = Number(p.gold || 0) + Number(reward.gold || 0);
  return [true, "Lore discovered.", { entry, reward }];
}

export function narrativeSnapshot(
  p: any,
  storyline: any,
  worldStory: any,
  classStories: any,
  lore: any,
) {
  ensureStoryState(p);
  const arc = currentStoryArc(p, storyline);
  const phases = storyWorldState(p, worldStory);
  const cs = classStoryState(p, classStories);
  return {
    chapter: Number(p.storyChapter || 0),
    currentArc: arc
      ? {
          id: arc.id,
          name: arc.name,
          summary: arc.summary,
          question: arc.player_question,
          reveal: arc.reveal,
        }
      : null,
    history: p.storyChapterHistory || [],
    flags: p.storyFlags,
    choices: p.storyChoices,
    factions: STORY_FACTIONS.map((f) => ({
      id: f.id,
      name: f.name,
      reputation: p.factionReputation[f.id] || 0,
      tier: factionTier(p.factionReputation[f.id] || 0),
    })),
    classStory: cs
      ? {
          name: cs.name,
          completed: cs.completed,
          next: cs.next
            ? { id: cs.next.id, name: cs.next.name, minLevel: cs.next.minLevel }
            : null,
        }
      : null,
    loreDiscovered: p.loreDiscoveries.length,
    loreTotal: (lore || []).length,
    worldPhases: phases,
  };
}
