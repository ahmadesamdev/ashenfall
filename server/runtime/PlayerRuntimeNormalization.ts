import { MOVEMENT_SPEEDS } from "../world/Movement.js";

export interface PlayerRuntimeNormalizationContext {
  quest: any;
  repo: any;
}

export function createPlayerRuntimeNormalization({
  quest,
  repo,
}: PlayerRuntimeNormalizationContext) {
  function normalizeMovement(player: any) {
    if (
      !["none", "manual", "combat", "interaction"].includes(
        String(player.movementIntent || ""),
      )
    )
      player.movementIntent = "none";
    player.speed = MOVEMENT_SPEEDS.walk;
    player.runSpeed = MOVEMENT_SPEEDS.run;
    if (Number(player.movementPreferenceVersion || 0) < 2) {
      player.movementMode = "run";
      player.movementPreferenceVersion = 2;
      player.movementPreferenceInitialized = true;
    } else if (!player.movementPreferenceInitialized) {
      player.movementMode = "run";
      player.movementPreferenceInitialized = true;
    }
  }

  function normalizeStoryQuest(player: any) {
    quest.ensure(player);
    const storyQuest = player.quests.call_of_ashenfall;
    if (
      player.hasCharacter &&
      player.storyIntroSeen &&
      storyQuest &&
      storyQuest.visible &&
      !storyQuest.claimed &&
      !storyQuest.accepted
    ) {
      storyQuest.accepted = true;
      storyQuest.visible = true;
    }
  }

  function reconcileTravelQuestState(player: any) {
    quest.ensure(player);
    quest.reconcile(player);
    const active = Object.entries(player.quests || {}).find(
      ([id, state]: any) =>
        state?.accepted &&
        !state?.claimed &&
        quest.get(id)?.type === "travel" &&
        quest.get(id)?.target === player.zone,
    );
    if (active) {
      const [, state]: any = active;
      state.progress = quest.get(active[0]).amount || 1;
      state.complete = true;
      state.visible = true;
    }
  }

  function normalizeCharacterName(name: any) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }

  function characterNameTaken(name: any, exceptId: any = null) {
    const key = normalizeCharacterName(name);
    if (!key) return false;
    return repo
      .allPlayers()
      .some(
        (player: any) =>
          player?.hasCharacter &&
          player.id !== exceptId &&
          normalizeCharacterName(player.name) === key,
      );
  }

  return {
    normalizeMovement,
    normalizeStoryQuest,
    reconcileTravelQuestState,
    normalizeCharacterName,
    characterNameTaken,
  };
}
