const SECTION_ACTIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    chat: [
      "chat",
      "whisper",
      "guild_chat",
      "guild_project_start",
      "guild_project_contribute",
      "social_search",
    ],
    party: [
      "party_create",
      "party_invite",
      "party_accept",
      "party_decline",
      "party_kick",
      "party_disband",
      "party_leave",
      "party_target",
      "party_set_assist",
      "party_transfer_leader",
      "party_chat",
    ],
    mail: [
      "mail_state",
      "mail_read",
      "mail_unread",
      "claim_mail",
      "claim_all_mail",
      "delete_mail",
    ],
    auctions: [
      "auction_list",
      "auction_buy",
      "auction_bid",
      "auction_cancel",
      "auction_search",
      "market_stats",
      "auction_seller_history",
    ],
    worldMapNpcs: [
      "reroll_gear",
      "equip",
      "unequip",
      "learn_talent",
      "allocate_stat",
      "create_character",
      "advance_story",
      "open_story",
      "accept_quest",
      "turnin_quest",
      "abandon_quest",
      "reset_stats",
      "learn_skill",
      "select_profession",
      "drop_profession",
      "set_profession_specialization",
      "craft_blacksmith",
      "craft_recipe",
      "mine_ore",
      "buyback_shop",
    ],
    zones: [
      "create_character",
      "resume_character",
      "use_gate",
      "use_hearthstone",
    ],
  });

const SECTION_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(SECTION_ACTIONS).map(([key, actions]) => [
      key,
      new Set(actions),
    ]),
  ) as Record<string, Set<string>>,
);

export function sectionsForCommand(action: string): Record<string, boolean> {
  const sections: Record<string, boolean> = {};
  for (const [section, actions] of Object.entries(SECTION_SETS)) {
    if (actions.has(action)) sections[section] = true;
  }
  return sections;
}

export const TRANSIENT_COMMANDS: ReadonlySet<string> = new Set([
  "move",
  "move_input",
  "stop",
  "toggle_run",
  "select_player",
  "target_mob",
  "select_mob",
]);
