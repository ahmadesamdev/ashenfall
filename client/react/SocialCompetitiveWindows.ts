import * as React from "react";
import { ModalWindow } from "./ModalWindow.js";
import { BOSS_VISUALS } from "../config/GameClientConfig.js";

const h = React.createElement;
const getState = () => (window as any).__ashenfallClientState ?? null;
const getUi = () => (window as any).__ashenfallReactUi ?? {};

function useUiVersion() {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("ashenfall-ui-state", refresh);
    window.addEventListener("ashenfall-react-ui-refresh", refresh);
    return () => {
      window.removeEventListener("ashenfall-ui-state", refresh);
      window.removeEventListener("ashenfall-react-ui-refresh", refresh);
    };
  }, []);
}

function Button(props: any, children: any) {
  return h("button", props, children);
}
function ActionRow(...children: any[]) {
  return h("div", { className: "actions-inline" }, ...children);
}

export function PartyModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  if (!s)
    return h(
      ModalWindow,
      { id: "partyModal", title: "👥 Party", screenLabel: "PARTY", visible },
      h("div", { className: "muted" }, "Loading party..."),
    );
  const party =
    s.party ||
    (s.player?.partyId
      ? { leader: s.player.partyLeaderId || s.player.id, members: [s.player] }
      : null);
  if (!party) {
    const nearby = (s.nearby || []).filter(
      (x: any) => x.id !== s.player.id && !x.partyId,
    );
    return h(
      ModalWindow,
      { id: "partyModal", title: "👥 Party", screenLabel: "PARTY", visible },
      h(
        "div",
        { id: "partyList" },
        h(
          "div",
          { className: "party-empty-hero" },
          h("div", { className: "social-avatar guild-avatar" }, "👥"),
          h(
            "div",
            null,
            h("h3", null, "Create a party"),
            h(
              "div",
              { className: "muted" },
              "Build a group of up to five adventurers for quests, dungeons and combat.",
            ),
          ),
        ),
        ActionRow(
          Button(
            { className: "primary", "data-cmd": "party_create" },
            "Create Party",
          ),
        ),
        h(
          "div",
          { className: "social-section-head" },
          h(
            "div",
            null,
            h("h3", null, "Invite Nearby"),
            h("span", { className: "muted" }, "Players in your current area."),
          ),
        ),
        nearby.length
          ? nearby.map((x: any) =>
              h(
                "div",
                { key: x.id, className: "social-friend-row" },
                h("span", { className: "presence online" }),
                h("span", { className: "social-avatar" }, x.icon || "👤"),
                h(
                  "div",
                  { className: "player-main" },
                  h("b", null, x.name),
                  h(
                    "div",
                    { className: "muted" },
                    `Lv ${x.level || "?"} • ${x.role || "Adventurer"}`,
                  ),
                ),
                ActionRow(
                  Button(
                    { "data-action": "player-inspect", "data-player-id": x.id },
                    "Inspect",
                  ),
                  Button(
                    { "data-action": "player-invite", "data-player-id": x.id },
                    "Invite",
                  ),
                ),
              ),
            )
          : h(
              "div",
              { className: "social-empty" },
              "No eligible nearby players.",
            ),
      ),
    );
  }
  const leader = party.leader === s.player.id;
  const members = party.members || [];
  const me = members.find((m: any) => m.id === s.player.id);
  const memberCards = members.map((m: any) => {
    const hp = Math.max(
      0,
      Math.min(
        100,
        (100 * Number(m.hp || 0)) / Math.max(1, Number(m.maxHp || 1)),
      ),
    );
    const res = Math.max(
      0,
      Math.min(
        100,
        (100 * Number(m.resolve || 0)) / Math.max(1, Number(m.maxResolve || 1)),
      ),
    );
    const online = !!m.online;
    const actions =
      online && m.id !== s.player.id
        ? ActionRow(
            Button(
              { "data-action": "party-target", "data-player-id": m.id },
              "Target",
            ),
            Button(
              { "data-cmd": "party_set_assist", "data-target-id": m.id },
              "Assist",
            ),
            Button(
              { "data-cmd": "party_assist", "data-target-id": m.id },
              "Follow",
            ),
            Button(
              { "data-cmd": "inspect_player", "data-target-id": m.id },
              "Inspect",
            ),
            Button(
              { "data-action": "player-whisper", "data-player-id": m.id },
              "Whisper",
            ),
            leader
              ? Button(
                  { "data-cmd": "party_kick", "data-target-id": m.id },
                  "Remove",
                )
              : null,
            leader
              ? Button(
                  {
                    "data-cmd": "party_transfer_leader",
                    "data-target-id": m.id,
                  },
                  "Make Leader",
                )
              : null,
          )
        : null;
    return h(
      "div",
      { key: m.id, className: `party-member-card ${online ? "" : "offline"}` },
      h("span", { className: `presence ${online ? "online" : "offline"}` }),
      h(
        "span",
        { className: "social-avatar" },
        m.id === party.leader ? "👑" : m.icon || "👤",
      ),
      h(
        "div",
        { className: "player-main" },
        h(
          "div",
          null,
          h("b", null, m.name),
          " ",
          h(
            "span",
            { className: "muted" },
            `Lv ${m.level} • ${m.partyRole || m.role || "DPS"} ${m.id === party.leader ? "• Leader" : ""}`,
          ),
        ),
        h(
          "div",
          { className: "party-mini-bars" },
          h("i", { className: "hp", style: { width: `${hp}%` } }),
        ),
        h(
          "div",
          { className: "party-mini-bars" },
          h("i", { className: "res", style: { width: `${res}%` } }),
        ),
        h(
          "div",
          { className: "muted" },
          online
            ? m.zone === s.player.zone
              ? `${Number(m.rangeMeters || 0).toFixed(0)}m away`
              : "Different zone"
            : "Offline",
          m.target?.name ? ` • Target: ${m.target.name}` : "",
        ),
        actions,
      ),
    );
  });
  const candidates = leader
    ? (s.nearby || []).filter((x: any) => x.id !== s.player.id && !x.partyId)
    : [];
  return h(
    ModalWindow,
    { id: "partyModal", title: "👥 Party", screenLabel: "PARTY", visible },
    h(
      "div",
      { id: "partyList" },
      h(
        "div",
        { className: "party-empty-hero" },
        h("div", { className: "social-avatar guild-avatar" }, "👥"),
        h(
          "div",
          { className: "player-main" },
          h("h3", null, leader ? "Party Leader" : "Party"),
          h(
            "div",
            { className: "muted" },
            `${members.filter((m: any) => m.online).length}/${members.length} online • ${members.length}/5 members`,
          ),
        ),
        h(
          "div",
          { className: "party-role-pill" },
          me?.partyRole || me?.role || "DPS",
        ),
      ),
      ...memberCards,
      leader
        ? h(
            "div",
            { className: "social-section-head" },
            h(
              "div",
              null,
              h("h3", null, "Invite Nearby"),
              h(
                "span",
                { className: "muted" },
                "Party invitations expire after one minute.",
              ),
            ),
          )
        : null,
      ...candidates.map((x: any) =>
        h(
          "div",
          { key: `near-${x.id}`, className: "social-friend-row" },
          h("span", { className: "social-avatar" }, x.icon || "👤"),
          h(
            "div",
            { className: "player-main" },
            h("b", null, x.name),
            h(
              "div",
              { className: "muted" },
              `Lv ${x.level || "?"} • ${x.role || "Adventurer"}`,
            ),
          ),
          Button(
            { "data-action": "player-invite", "data-player-id": x.id },
            "Invite",
          ),
        ),
      ),
      ActionRow(
        Button({ "data-cmd": "party_assist" }, "Assist Selected"),
        Button({ "data-cmd": "party_leave" }, "Leave Party"),
        leader
          ? Button(
              { className: "danger", "data-cmd": "party_disband" },
              "Disband Party",
            )
          : null,
      ),
    ),
  );
}

export function SocialModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const ui = getUi();
  const social = s?.social || {};
  const tab = ui.socialTab || "friends";
  const searchResults = ui.socialSearchResults || [];
  const friends = social.friends || [];
  const requests = s?.pendingFriendRequests || [];
  const ignored = social.ignored || [];
  const nearby = (s?.nearby || []).filter((x: any) => x.id !== s?.player?.id);
  const whispers = social.whispers || [];
  const guildChat = social.guildChat || [];
  const guild = s?.guild || null;
  const tabs: [string, string][] = [
    ["friends", "Friends"],
    ["requests", `Requests${requests.length ? ` (${requests.length})` : ""}`],
    ["guild", "Guild"],
    ["ignore", "Ignored"],
  ];

  const playerRow = (x: any, key: string, extra: any[] = []) =>
    h(
      "div",
      { key, className: `social-friend-row ${x.online ? "" : "offline"}` },
      h("span", { className: `presence ${x.online ? "online" : "offline"}` }),
      h("span", { className: "social-avatar" }, x.icon || "👤"),
      h(
        "div",
        { className: "player-main" },
        h("b", null, x.name || "Player"),
        h(
          "div",
          { className: "muted" },
          `Lv ${x.level || "?"} • ${x.role || "Adventurer"} • ${x.online ? x.zone || "Online" : "Offline"}`,
        ),
      ),
      ActionRow(
        Button(
          { "data-action": "player-inspect", "data-player-id": x.id },
          "Inspect",
        ),
        Button(
          {
            "data-action": "player-whisper",
            "data-player-id": x.id,
            disabled: !x.online,
          },
          "Whisper",
        ),
        ...extra,
      ),
    );

  let body: any[] = [];
  if (searchResults.length) {
    body.push(
      h(
        "div",
        { className: "social-search-results", key: "search-results" },
        h("div", { className: "social-section-title" }, "Search Results"),
        ...searchResults.map((x: any) => {
          const status = x.online
            ? "Online"
            : `Offline • ${x.zone || "Unknown"}`;
          const action = x.friend
            ? Button({ disabled: true }, "✓ Friends")
            : x.pending
              ? Button({ disabled: true }, "Request Sent")
              : x.ignored
                ? Button({ disabled: true }, "Ignored")
                : Button(
                    {
                      className: "primary",
                      "data-cmd": "friend_add",
                      "data-target-id": x.id,
                    },
                    "Add Friend",
                  );
          return h(
            "div",
            { key: x.id, className: "social-result" },
            h("span", { className: "social-avatar" }, x.icon || "👤"),
            h(
              "div",
              { className: "player-main" },
              h("b", null, x.name),
              h(
                "div",
                { className: "muted" },
                `Lv ${x.level || "?"} • ${x.role || "Adventurer"} • ${status}`,
              ),
            ),
            ActionRow(
              Button(
                { "data-action": "player-inspect", "data-player-id": x.id },
                "Inspect",
              ),
              Button(
                {
                  "data-action": "player-whisper",
                  "data-player-id": x.id,
                  disabled: !x.online,
                },
                "Whisper",
              ),
              action,
            ),
          );
        }),
      ),
    );
  }

  if (tab === "friends") {
    body.push(
      h(
        "div",
        { className: "social-section-head", key: "friends-head" },
        h(
          "div",
          null,
          h("h3", null, "Friends"),
          h(
            "span",
            { className: "muted" },
            `${friends.filter((f: any) => f.online).length} online • ${friends.length} total`,
          ),
        ),
      ),
    );
    body.push(
      ...(friends.length
        ? friends.map((f: any) =>
            playerRow(f, `friend-${f.id}`, [
              Button(
                { "data-cmd": "friend_remove", "data-target-id": f.id },
                "Remove",
              ),
            ]),
          )
        : [
            h(
              "div",
              { className: "social-empty", key: "friends-empty" },
              h("b", null, "No friends yet."),
              h(
                "span",
                null,
                "Search for a player above or right-click someone in the world.",
              ),
            ),
          ]),
    );
    body.push(
      h(
        "div",
        { className: "social-section-head", key: "nearby-head" },
        h(
          "div",
          null,
          h("h3", null, "Nearby Players"),
          h("span", { className: "muted" }, "Players in your current area"),
        ),
      ),
    );
    body.push(
      ...(nearby.length
        ? nearby.map((x: any) => {
            const already = friends.some((f: any) => f.id === x.id);
            const pending = requests.some((r: any) => r.fromId === x.id);
            const friendAction = already
              ? Button({ disabled: true }, "✓ Friends")
              : pending
                ? Button({ disabled: true }, "Request Sent")
                : Button(
                    { "data-cmd": "friend_add", "data-target-id": x.id },
                    "Add Friend",
                  );
            return playerRow(x, `near-${x.id}`, [
              friendAction,
              Button(
                { "data-action": "player-invite", "data-player-id": x.id },
                "Party",
              ),
              guild?.leader === s?.player?.id && !x.guildId
                ? Button(
                    {
                      "data-action": "player-guild-invite",
                      "data-player-id": x.id,
                    },
                    "Guild",
                  )
                : null,
            ]);
          })
        : [
            h(
              "div",
              { className: "social-empty", key: "near-empty" },
              "No other players nearby.",
            ),
          ]),
    );
  } else if (tab === "requests") {
    body.push(
      h(
        "div",
        { className: "social-section-head", key: "requests-head" },
        h(
          "div",
          null,
          h("h3", null, "Friend Requests"),
          h("span", { className: "muted" }, "Requests expire after 7 days."),
        ),
      ),
    );
    body.push(
      ...(requests.length
        ? requests.map((r: any) =>
            h(
              "div",
              { key: r.fromId, className: "social-request" },
              h("span", { className: "social-avatar" }, "🤝"),
              h(
                "div",
                { className: "player-main" },
                h("b", null, r.fromName || "Player"),
                h(
                  "div",
                  { className: "muted" },
                  "Wants to add you as a friend.",
                ),
              ),
              ActionRow(
                Button(
                  {
                    className: "primary",
                    "data-cmd": "friend_accept",
                    "data-target-id": r.fromId,
                  },
                  "Accept",
                ),
                Button(
                  { "data-cmd": "friend_decline", "data-target-id": r.fromId },
                  "Decline",
                ),
                Button(
                  {
                    "data-action": "player-inspect",
                    "data-player-id": r.fromId,
                  },
                  "Inspect",
                ),
              ),
            ),
          )
        : [
            h(
              "div",
              { className: "social-empty", key: "requests-empty" },
              h("b", null, "All clear."),
              h("span", null, "You have no pending friend requests."),
            ),
          ]),
    );
  } else if (tab === "guild") {
    if (!guild) {
      body.push(
        h(
          "div",
          { className: "guild-hero", key: "create-guild" },
          h("div", { className: "social-avatar guild-avatar" }, "⚔️"),
          h(
            "div",
            null,
            h("h3", null, "Create your guild"),
            h(
              "div",
              { className: "muted" },
              "Build a home for your group. Creation costs ",
              h("b", null, "1,000 gold"),
              ".",
            ),
          ),
        ),
      );
      body.push(
        h(
          "div",
          { className: "guild-create-form", key: "guild-form" },
          h("input", {
            id: "guildNameInput",
            maxLength: 32,
            placeholder: "Guild name…",
          }),
          Button(
            { className: "primary", "data-action": "guild-create" },
            "Create Guild",
          ),
        ),
      );
    } else {
      const me = (guild.members || []).find((m: any) => m.id === s?.player?.id);
      const leader = guild.leader === s?.player?.id;
      const officer = me?.guildRank === "officer";
      body.push(
        h(
          "div",
          { className: "guild-hero", key: "guild-hero" },
          h("div", { className: "social-avatar guild-avatar" }, "⚔️"),
          h(
            "div",
            { className: "player-main" },
            h("h3", null, guild.name),
            h(
              "div",
              { className: "muted" },
              `${guild.onlineCount || 0} online • ${(guild.members || []).length}/50 members • ${leader ? "Guild Leader" : me?.guildRank || "Member"}`,
            ),
            h(
              "p",
              { className: "guild-motd" },
              guild.motd || "No message of the day.",
            ),
            h(
              "p",
              { className: "muted" },
              guild.description || "No guild description yet.",
            ),
          ),
        ),
      );
      if (leader || officer)
        body.push(
          h(
            "div",
            { className: "guild-edit-grid", key: "guild-edit" },
            h(
              "label",
              null,
              "Guild description",
              h("input", {
                id: "guildDescriptionInput",
                maxLength: 240,
                defaultValue: guild.description || "",
              }),
            ),
            Button({ "data-action": "guild-save-description" }, "Save"),
            h(
              "label",
              null,
              "Message of the day",
              h("input", {
                id: "guildMotdInput",
                maxLength: 180,
                defaultValue: guild.motd || "",
              }),
            ),
            Button({ "data-action": "guild-save-motd" }, "Save"),
          ),
        );
      body.push(
        h(
          "div",
          { className: "social-section-head", key: "roster-head" },
          h(
            "div",
            null,
            h("h3", null, "Roster"),
            h(
              "span",
              { className: "muted" },
              `${(guild.members || []).length} members`,
            ),
          ),
        ),
      );
      body.push(
        ...(guild.members || []).map((m: any) => {
          const canManage = leader || officer;
          const rank = m.guildRank || "member";
          const controls =
            m.id === s?.player?.id
              ? []
              : [
                  Button(
                    { "data-action": "player-inspect", "data-player-id": m.id },
                    "Inspect",
                  ),
                  Button(
                    {
                      "data-action": "player-whisper",
                      "data-player-id": m.id,
                      disabled: !m.online,
                    },
                    "Whisper",
                  ),
                  canManage && m.online
                    ? Button(
                        { "data-cmd": "guild_kick", "data-target-id": m.id },
                        "Remove",
                      )
                    : null,
                  leader && m.id !== guild.leader
                    ? Button(
                        {
                          "data-cmd": "guild_transfer_leader",
                          "data-target-id": m.id,
                        },
                        "Make Leader",
                      )
                    : null,
                  leader && m.id !== guild.leader
                    ? Button(
                        {
                          "data-cmd": "guild_promote",
                          "data-target-id": m.id,
                          "data-rank":
                            rank === "officer" ? "member" : "officer",
                        },
                        rank === "officer" ? "Demote" : "Promote",
                      )
                    : null,
                ];
          return h(
            "div",
            {
              key: m.id,
              className: `social-friend-row ${m.online ? "" : "offline"}`,
            },
            h("span", {
              className: `presence ${m.online ? "online" : "offline"}`,
            }),
            h(
              "span",
              { className: "social-avatar" },
              m.id === guild.leader ? "👑" : "🛡️",
            ),
            h(
              "div",
              { className: "player-main" },
              h("b", null, m.name),
              h(
                "div",
                { className: "muted" },
                `Lv ${m.level || "?"} • ${rank} • ${m.online ? "Online" : "Offline"}`,
              ),
            ),
            ActionRow(...controls),
          );
        }),
      );
      const inviteCandidates = nearby.filter(
        (x: any) => x.id !== s?.player?.id && !x.guildId,
      );
      if (leader || officer) {
        body.push(
          h(
            "div",
            { className: "social-section-head", key: "invite-head" },
            h(
              "div",
              null,
              h("h3", null, "Invite Nearby"),
              h(
                "span",
                { className: "muted" },
                "Invite players in your current area.",
              ),
            ),
          ),
        );
        body.push(
          ...(inviteCandidates.length
            ? inviteCandidates.map((x: any) =>
                h(
                  "div",
                  {
                    key: `guild-invite-${x.id}`,
                    className: "social-friend-row",
                  },
                  h("span", { className: "social-avatar" }, x.icon || "👤"),
                  h(
                    "div",
                    { className: "player-main" },
                    h("b", null, x.name),
                    h(
                      "div",
                      { className: "muted" },
                      `Lv ${x.level || "?"} • ${x.role || "Adventurer"}`,
                    ),
                  ),
                  Button(
                    { "data-cmd": "guild_invite", "data-target-id": x.id },
                    "Invite",
                  ),
                ),
              )
            : [
                h(
                  "div",
                  { className: "social-empty", key: "guild-invite-empty" },
                  "No eligible nearby players.",
                ),
              ]),
        );
      }
      body.push(
        h(
          "div",
          { className: "guild-chat", key: "guild-chat" },
          h(
            "div",
            { className: "social-section-head" },
            h(
              "div",
              null,
              h("h3", null, "Guild Chat"),
              h(
                "span",
                { className: "muted" },
                "Only guild members can see this channel.",
              ),
            ),
          ),
          h(
            "div",
            { className: "guild-chat-log" },
            guildChat.length
              ? guildChat.map((m: any, i: number) =>
                  h(
                    "div",
                    { key: `${m.at || i}`, className: "guild-chat-row" },
                    h("b", null, m.fromName),
                    h("span", null, m.text),
                    h(
                      "time",
                      null,
                      new Date(m.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    ),
                  ),
                )
              : h(
                  "div",
                  { className: "social-empty" },
                  "No guild messages yet.",
                ),
          ),
          h(
            "div",
            { className: "social-chat-input" },
            h("input", {
              id: "guildChatInput",
              maxLength: 240,
              placeholder: "Message your guild…",
            }),
            Button(
              { className: "primary", "data-action": "guild-chat-send" },
              "Send",
            ),
          ),
        ),
      );
      body.push(
        h(
          "div",
          { className: "social-danger-row", key: "guild-danger" },
          Button({ "data-cmd": "guild_leave" }, "Leave Guild"),
          leader
            ? Button(
                { className: "danger", "data-action": "guild-disband" },
                "Disband Guild",
              )
            : null,
        ),
      );
    }
  } else if (tab === "whispers") {
    body.push(
      h(
        "div",
        { className: "social-section-head", key: "whispers-head" },
        h(
          "div",
          null,
          h("h3", null, "Whispers"),
          h(
            "span",
            { className: "muted" },
            "Private conversations with other players.",
          ),
        ),
      ),
    );
    body.push(
      ...(whispers.length
        ? whispers.map((m: any, i: number) =>
            h(
              "div",
              {
                key: `${m.at || i}-${i}`,
                className: `whisper-row ${m.direction === "out" ? "out" : "in"}`,
              },
              h(
                "div",
                null,
                h(
                  "b",
                  null,
                  m.direction === "out" ? "You" : m.from || "Player",
                ),
                " ",
                h("span", { className: "muted" }, m.t || ""),
              ),
              h("div", null, m.text || ""),
            ),
          )
        : [
            h(
              "div",
              { className: "social-empty", key: "whisper-empty" },
              "No whisper history yet.",
            ),
          ]),
      h(
        "div",
        { className: "social-empty", key: "whisper-help" },
        "Whispers are sent from the chat channel selector. Click a whisper in chat to reply.",
      ),
    );
  } else {
    body.push(
      h(
        "div",
        { className: "social-section-head", key: "ignore-head" },
        h(
          "div",
          null,
          h("h3", null, "Ignored Players"),
          h(
            "span",
            { className: "muted" },
            "Ignored players cannot whisper or send social requests.",
          ),
        ),
      ),
    );
    body.push(
      ...(ignored.length
        ? ignored.map((f: any) =>
            h(
              "div",
              { key: f.id || f.name, className: "social-friend-row" },
              h("span", { className: "social-avatar" }, "🚫"),
              h(
                "div",
                { className: "player-main" },
                h("b", null, f.name || f.id),
                h(
                  "div",
                  { className: "muted" },
                  f.online ? "Online" : "Offline",
                ),
              ),
              Button(
                { "data-cmd": "ignore_remove", "data-target-id": f.id },
                "Unignore",
              ),
            ),
          )
        : [
            h(
              "div",
              { className: "social-empty", key: "ignore-empty" },
              "No ignored players.",
            ),
          ]),
    );
  }

  return h(
    ModalWindow,
    {
      id: "socialModal",
      cardClassName: "large",
      title: "👥 Social",
      screenLabel: "SOCIAL",
      visible,
    },
    h(
      "div",
      { id: "socialList" },
      h(
        "div",
        { className: "social-tabs" },
        ...tabs.map(([id, label]) =>
          Button(
            {
              key: id,
              type: "button",
              className: tab === id ? "active" : "",
              "data-action": "social-tab",
              "data-social-tab": id,
            },
            label,
          ),
        ),
      ),
      h(
        "div",
        { className: "social-search" },
        h("input", {
          id: "socialSearchInput",
          maxLength: 20,
          placeholder: "Find a player by name…",
        }),
        Button(
          { className: "primary", "data-action": "social-search" },
          "Search",
        ),
      ),
      ...body,
    ),
  );
}

export function MailModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const mail = s?.mail || [];
  const unread = Number(
    s?.mailSummary?.unread ?? mail.filter((m: any) => !m.read).length,
  );
  const rows = mail.length
    ? mail.map((m: any) => {
        const gold = Number(m.payload?.gold || 0);
        const items = Array.isArray(m.payload?.items) ? m.payload.items : [];
        const attachments = gold > 0 || items.length > 0;
        return h(
          "div",
          { key: m.id, className: `mail-row ${m.read ? "read" : "unread"}` },
          h("div", { className: "mail-icon" }, "✉️"),
          h(
            "div",
            { className: "mail-main" },
            h(
              "div",
              { className: "mail-head" },
              h("b", null, m.subject || "Ashenfall Mail"),
              h(
                "span",
                { className: "muted" },
                `${Math.max(0, Math.floor((Number(m.expiresAt || Date.now()) - Date.now()) / 86400000))}d left`,
              ),
            ),
            h("div", { className: "muted mail-body" }, m.body || ""),
            gold
              ? h("div", { className: "mail-attachment" }, `🪙 ${gold} gold`)
              : null,
            items.length
              ? h(
                  "div",
                  { className: "mail-attachment" },
                  `📦 ${items.map((x: any) => `${s?.catalog?.items?.[x.itemId]?.name || x.itemId} ×${Number(x.qty || 1)}`).join(" • ")}`,
                )
              : null,
          ),
          h(
            "div",
            { className: "mail-actions" },
            Button(
              {
                "data-cmd": m.read ? "mail_unread" : "mail_read",
                "data-mail-id": m.id,
              },
              m.read ? "Unread" : "Read",
            ),
            attachments
              ? Button(
                  {
                    className: "primary",
                    "data-cmd": "claim_mail",
                    "data-mail-id": m.id,
                  },
                  "Claim",
                )
              : Button(
                  { "data-cmd": "delete_mail", "data-mail-id": m.id },
                  "Delete",
                ),
          ),
        );
      })
    : [
        h(
          "div",
          { className: "muted mail-empty", key: "empty" },
          "Your mailbox is empty.",
        ),
      ];
  return h(
    ModalWindow,
    {
      id: "mailModal",
      cardClassName: "large",
      title: "✉️ Mail",
      screenLabel: "MAIL",
      visible,
    },
    h(
      "div",
      { id: "mailList" },
      h(
        "div",
        { className: "mail-toolbar" },
        h(
          "div",
          null,
          h("b", null, `${mail.length}/100`),
          " messages • ",
          h("b", null, unread),
          " unread",
        ),
        mail.some((m: any) => m.payload?.items?.length || m.payload?.gold)
          ? Button(
              { className: "primary", "data-cmd": "claim_all_mail" },
              "Claim All Attachments",
            )
          : null,
      ),
      ...rows,
    ),
  );
}

export function AuctionModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const ui = (window as any).__ashenfallAuctionUi || {};
  if (!s)
    return h(
      ModalWindow,
      {
        id: "auctionModal",
        cardClassName: "xlarge",
        title: "⚖️ Auction House",
        screenLabel: "AUCTION HOUSE",
        visible,
      },
      h(
        "div",
        { id: "auctionList", "data-react-owned": "1" },
        h("div", { className: "muted" }, "Loading auction house..."),
      ),
    );
  const tab = ui.tab || "Market";
  const cat = ui.category || "All";
  const market = ui.market?.listings ? ui.market : null;
  const all = market ? market.listings : s.auctions || [];
  const mine = s.myAuctions || [];
  const mail = s.mail || [];
  const typeFor = (it: any) =>
    [
      "weapon",
      "shield",
      "helmet",
      "chest",
      "shoulders",
      "gloves",
      "boots",
      "neck",
      "ring",
      "relic",
    ].includes(it.type)
      ? "Equipment"
      : it.type === "consumable"
        ? "Consumables"
        : it.type === "material"
          ? "Materials"
          : "Misc";
  const filtered = all.filter((a: any) => {
    const it = s.catalog?.items?.[a.itemId] || {};
    return cat === "All" || typeFor(it) === cat;
  });
  const categories = ["All", "Equipment", "Consumables", "Materials", "Misc"];
  const rows = filtered.map((a: any) => {
    const it = s.catalog?.items?.[a.itemId] || {};
    const own = a.seller === s.player?.id;
    const bid = Number(a.currentBid || a.startPrice || a.price || 0);
    const bo = Number(a.buyout || 0);
    const ends = Math.max(
      0,
      Math.floor((Number(a.expiresAt || 0) - Date.now()) / 60000),
    );
    return h(
      "div",
      { key: a.id, className: "auction-row" },
      h("div", { className: "auction-item-icon" }, it.icon || "📦"),
      h(
        "div",
        { className: "auction-item-main" },
        h("b", null, a.itemName || it.name || a.itemId),
        h(
          "span",
          { className: "muted" },
          `${typeFor(it)} • Qty ${Number(a.qty || 1)} • ${own ? "You" : `Seller: ${a.sellerName || "Player"}`} • ${ends}m left`,
        ),
        h(
          "span",
          { className: "muted" },
          `Bid: 🪙 ${bid}${a.currentBidder ? " • Highest bidder set" : ""}${bo ? ` • Buyout: 🪙 ${bo}` : ""}`,
        ),
      ),
      own
        ? Button(
            { "data-cmd": "auction_cancel", "data-auction-id": a.id },
            "Cancel",
          )
        : Button(
            {
              "data-cmd": "auction_bid",
              "data-auction-id": a.id,
              "data-amount": String(bid + 1),
            },
            "Bid +1",
          ),
      !own && bo
        ? Button(
            {
              className: "primary",
              "data-cmd": "auction_buy",
              "data-auction-id": a.id,
            },
            "Buyout",
          )
        : null,
      !own
        ? Button(
            { "data-action": "auction-history", "data-item-id": a.itemId },
            "Market",
          )
        : null,
    );
  });
  const mineRows = mine.map((a: any) => {
    const it = s.catalog?.items?.[a.itemId] || {};
    return h(
      "div",
      { key: a.id, className: "auction-row" },
      h("div", { className: "auction-item-icon" }, it.icon || "📦"),
      h(
        "div",
        { className: "auction-item-main" },
        h("b", null, it.name || a.itemId),
        h(
          "span",
          { className: "muted" },
          `${typeFor(it)} • Qty ${Number(a.qty || 1)} • Bid ${Number(a.currentBid || a.startPrice || 0)} • Buyout ${Number(a.buyout || 0)}`,
        ),
      ),
      Button(
        { "data-cmd": "auction_cancel", "data-auction-id": a.id },
        "Cancel",
      ),
    );
  });
  const options = (s.player?.inventory || [])
    .filter(
      (x: any) =>
        x.qty > 0 &&
        !Object.values<any>(s.player?.equipment || {}).includes(x.itemId),
    )
    .map((x: any) => {
      const it = s.catalog?.items?.[x.itemId] || {};
      return h(
        "option",
        { key: x.itemId, value: x.itemId },
        `${it.name || x.itemId} • ${x.qty} available`,
      );
    });
  const mailRows = mail.map((m: any) => {
    const gold = Number(m.payload?.gold || 0);
    const items = m.payload?.items || [];
    return h(
      "div",
      { key: m.id, className: "auction-row" },
      h("div", { className: "auction-item-icon" }, "✉️"),
      h(
        "div",
        { className: "auction-item-main" },
        h("b", null, m.subject || "Ashenfall Mail"),
        h(
          "span",
          { className: "muted" },
          `${m.body || ""}${gold ? ` • 🪙 ${gold} gold` : ""}${items.length ? ` • ${items.map((x: any) => `${s.catalog?.items?.[x.itemId]?.name || x.itemId} ×${x.qty}`).join(", ")}` : ""}`,
        ),
      ),
      Button(
        {
          className: "primary",
          "data-cmd": "claim_mail",
          "data-mail-id": m.id,
        },
        "Claim",
      ),
    );
  });
  const stats = ui.stats?.stats;
  const statsPanel = stats
    ? h(
        "div",
        { className: "auction-preview" },
        h("b", null, s.catalog?.items?.[stats.itemId]?.name || stats.itemId),
        ` • ${stats.days}d • Avg 🪙 ${stats.average ?? " - "} • Low ${stats.lowest ?? " - "} • High ${stats.highest ?? " - "} • Volume ${stats.volume} • Sales ${stats.salesCount}`,
      )
    : null;
  const historyRows = (ui.sellerHistory || []).map((x: any, i: number) =>
    h(
      "div",
      { key: `${x.itemId}-${x.soldAt}-${i}`, className: "auction-row" },
      h("div", { className: "auction-item-icon" }, "📈"),
      h(
        "div",
        { className: "auction-item-main" },
        h("b", null, s.catalog?.items?.[x.itemId]?.name || x.itemId),
        h(
          "span",
          { className: "muted" },
          `Qty ${x.qty} • Gross 🪙 ${x.price} • Tax 🪙 ${x.tax} • Net 🪙 ${x.proceeds}`,
        ),
      ),
      h(
        "span",
        { className: "muted" },
        new Date(x.soldAt).toLocaleDateString(),
      ),
    ),
  );
  const search = h(
    "div",
    { className: "auction-create" },
    h(
      "div",
      null,
      h("label", { className: "muted" }, "Search"),
      h("input", {
        id: "auctionSearch",
        type: "text",
        placeholder: "Item name…",
        defaultValue: ui.query || "",
      }),
    ),
    h(
      "div",
      null,
      h("label", { className: "muted" }, "Rarity"),
      h(
        "select",
        { id: "auctionRarity", defaultValue: ui.rarity || "" },
        h("option", { value: "" }, "Any rarity"),
        ...["common", "uncommon", "rare", "epic", "legendary"].map((r) =>
          h("option", { key: r, value: r }, r),
        ),
      ),
    ),
    h(
      "div",
      null,
      h("label", { className: "muted" }, "Level"),
      h("input", {
        id: "auctionMinLevel",
        type: "number",
        min: 0,
        placeholder: "Min",
        defaultValue: ui.minLevel || "",
      }),
    ),
    h(
      "div",
      null,
      h("label", { className: "muted" }, "Sort"),
      h(
        "select",
        { id: "auctionSort", defaultValue: ui.sort || "newest" },
        ...[
          ["newest", "Newest"],
          ["price_asc", "Lowest price"],
          ["price_desc", "Highest price"],
          ["level_asc", "Lowest level"],
          ["level_desc", "Highest level"],
          ["ending", "Ending soon"],
        ].map(([v, l]) => h("option", { key: v, value: v }, l)),
      ),
    ),
    Button({ className: "primary", "data-action": "auction-search" }, "Search"),
  );
  let content: any;
  if (tab === "Market")
    content = h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "auction-subtabs" },
        ...categories.map((x) =>
          Button(
            {
              key: x,
              type: "button",
              className: cat === x ? "active" : "",
              "data-action": "auction-category",
              "data-category": x,
            },
            x,
          ),
        ),
      ),
      search,
      statsPanel,
      h(
        "div",
        { className: "auction-section" },
        h(
          "div",
          { className: "auction-section-head" },
          h("h3", null, "Market"),
          h(
            "span",
            { className: "muted" },
            `${market?.total ?? filtered.length} listings`,
          ),
        ),
        ...(rows.length
          ? rows
          : [
              h(
                "div",
                { className: "muted", key: "empty" },
                "There are no listings matching these filters.",
              ),
            ]),
      ),
    );
  else if (tab === "My Listings")
    content = h(
      "div",
      { className: "auction-section" },
      h(
        "div",
        { className: "auction-section-head" },
        h("h3", null, "My Listings"),
        h("span", { className: "muted" }, `${mine.length} active`),
      ),
      ...(mineRows.length
        ? mineRows
        : [
            h(
              "div",
              { className: "muted", key: "empty" },
              "You have no active listings.",
            ),
          ]),
    );
  else if (tab === "Sales History")
    content = h(
      "div",
      { className: "auction-section" },
      h(
        "div",
        { className: "auction-section-head" },
        h("h3", null, "Completed Sales"),
        Button({ "data-action": "auction-sales-refresh" }, "Refresh"),
      ),
      ...(historyRows.length
        ? historyRows
        : [
            h(
              "div",
              { className: "muted", key: "empty" },
              "No completed sales in the selected history window.",
            ),
          ]),
    );
  else if (tab === "Mailbox")
    content = h(
      "div",
      { className: "auction-section" },
      h(
        "div",
        { className: "auction-section-head" },
        h("h3", null, "Mailbox"),
        h("span", { className: "muted" }, `${mail.length} messages`),
      ),
      ...(mailRows.length
        ? mailRows
        : [
            h(
              "div",
              { className: "muted", key: "empty" },
              "Your mailbox is empty.",
            ),
          ]),
    );
  else
    content = h(
      "div",
      { className: "auction-section" },
      h(
        "div",
        { className: "auction-section-head" },
        h("h3", null, "List an Item"),
      ),
      h(
        "div",
        { className: "auction-create" },
        h(
          "div",
          null,
          h("label", { className: "muted" }, "Item"),
          h(
            "select",
            { id: "auctionItem", defaultValue: "" },
            h("option", { value: "" }, "Choose item"),
            ...options,
          ),
        ),
        h(
          "div",
          null,
          h(
            "label",
            { className: "muted" },
            "Quantity ",
            h("span", { className: "muted" }, "(split stack)"),
          ),
          h("input", {
            id: "auctionQty",
            type: "number",
            min: 1,
            defaultValue: 1,
          }),
        ),
        h(
          "div",
          null,
          h("label", { className: "muted" }, "Starting Bid"),
          h("input", {
            id: "auctionPrice",
            type: "number",
            min: 1,
            defaultValue: 10,
          }),
        ),
        h(
          "div",
          null,
          h("label", { className: "muted" }, "Buyout"),
          h("input", {
            id: "auctionBuyout",
            type: "number",
            min: 1,
            defaultValue: "",
          }),
        ),
        Button(
          { className: "primary", "data-action": "auction-submit" },
          "List Item",
        ),
      ),
      h(
        "div",
        { className: "auction-preview" },
        "Choose a stack and set the quantity you want to sell. The remainder stays in your bag.",
      ),
    );
  return h(
    ModalWindow,
    {
      id: "auctionModal",
      cardClassName: "xlarge",
      title: "⚖️ Auction House",
      screenLabel: "AUCTION HOUSE",
      visible,
    },
    h(
      "div",
      { id: "auctionList", "data-react-owned": "1" },
      h(
        "div",
        { className: "auction-shell" },
        h(
          "div",
          { className: "auction-tabs" },
          ...["Market", "My Listings", "Sell", "Sales History", "Mailbox"].map(
            (x) =>
              Button(
                {
                  key: x,
                  type: "button",
                  className: tab === x ? "active" : "",
                  "data-action": "auction-tab",
                  "data-tab": x,
                },
                x,
              ),
          ),
        ),
        content,
      ),
    ),
  );
}

export function ProfessionModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const levels = s?.professions?.levels || s?.player?.profession || {};
  const xp = s?.professions?.xp || s?.player?.professionXp || {};
  const known = s?.player?.professions || [];
  const recipes = s?.professions?.recipes || [];
  const names: any = {
    mining: "Mining",
    blacksmith: "Blacksmithing",
    skinning: "Skinning",
    alchemy: "Alchemy",
    cooking: "Cooking",
  };
  const icons: any = {
    mining: "⛏️",
    blacksmith: "⚒️",
    skinning: "🪶",
    alchemy: "⚗️",
    cooking: "🍲",
  };
  const specOptions: any = {
    mining: {
      prospector: "Prospector — extra ore chance",
      veinwalker: "Veinwalker — faster respawns",
      deepDelver: "Deep Delver — high-tier ore bonus",
    },
    blacksmith: {
      weaponsmith: "Weaponsmith — stronger weapon quality",
      armorsmith: "Armorsmith — stronger armor quality",
      efficientSmith: "Efficient Smith — material savings",
    },
    skinning: {
      hideworker: "Hideworker — extra hide yield",
      trophyHunter: "Trophy Hunter — rare trophy chance",
      fieldDresser: "Field Dresser — more skinning XP",
    },
    alchemy: {
      distiller: "Distiller — better quality odds",
      reagentSaver: "Reagent Saver — material savings",
      battleBrewer: "Battle Brewer — stronger consumables",
    },
    cooking: {
      campfireChef: "Campfire Chef — better quality odds",
      heartyMeals: "Hearty Meals — stronger meals",
      efficientCook: "Efficient Cook — material savings",
    },
  };
  const mats = (r: any) =>
    (r.materials || [])
      .map((m: any) => {
        const it = s?.catalog?.items?.[m.itemId] || {};
        const have = Number(
          (s?.player?.inventory || []).find((x: any) => x.itemId === m.itemId)
            ?.qty || 0,
        );
        return `${it.icon || "📦"} ${m.qty} ${it.name || m.itemId} (${have}/${m.qty})`;
      })
      .join(" • ");
  const cards = Object.keys(names).map((id) => {
    const learned = known.includes(id);
    const level = Number(levels[id] || 1);
    const cur =
      s?.player?.professionSpecializations?.[id] ||
      s?.professions?.specializations?.[id] ||
      null;
    const rs = recipes.filter((r: any) => r.profession === id);
    const options = specOptions[id] || {};
    return h(
      "section",
      { key: id, className: "profession-card" },
      h(
        "div",
        { className: "profession-card-head" },
        h(
          "div",
          null,
          h("h3", null, `${icons[id]} ${names[id]}`),
          h(
            "div",
            { className: "muted" },
            learned
              ? `Level ${level} • XP ${xp[id] || 0}/${Math.max(80, level * 100)}`
              : "Not learned",
          ),
        ),
        learned
          ? null
          : h("span", { className: "profession-locked" }, "Visit a trainer"),
      ),
      learned
        ? h(
            React.Fragment,
            null,
            h(
              "div",
              { className: "profession-spec" },
              h("b", null, "Specialization"),
              h(
                "div",
                { className: "muted" },
                cur
                  ? `Current: ${cur}`
                  : level >= 5
                    ? "Choose one specialization."
                    : "Specialization unlocks at level 5.",
              ),
              level >= 5
                ? h(
                    "div",
                    { className: "actions-inline" },
                    ...Object.entries(options).map(([key, label]: any) =>
                      Button(
                        {
                          key,
                          "data-cmd": "set_profession_specialization",
                          "data-profession": id,
                          "data-specialization": key,
                          disabled: !!cur,
                        },
                        `${cur === key ? "✓ " : ""}${label}`,
                      ),
                    ),
                  )
                : null,
            ),
            h(
              "div",
              { className: "profession-recipes" },
              rs.length
                ? rs.map((r: any) => {
                    const can =
                      level >= Number(r.level || 1) &&
                      (r.materials || []).every(
                        (m: any) =>
                          Number(
                            (s?.player?.inventory || []).find(
                              (x: any) => x.itemId === m.itemId,
                            )?.qty || 0,
                          ) >= Number(m.qty || 0),
                      );
                    return h(
                      "div",
                      { key: r.id, className: "profession-recipe" },
                      h(
                        "div",
                        null,
                        h("b", null, `${icons[id]} ${r.name}`),
                        h(
                          "div",
                          { className: "muted" },
                          `${names[id]} ${r.level} • ${mats(r)}`,
                        ),
                      ),
                      Button(
                        {
                          "data-cmd": "craft_recipe",
                          "data-recipe-id": r.id,
                          disabled: !can,
                        },
                        id === "blacksmith" ? "Forge" : "Craft",
                      ),
                    );
                  })
                : h(
                    "span",
                    { className: "muted" },
                    "No recipes discovered yet.",
                  ),
            ),
          )
        : h(
            "span",
            { className: "muted" },
            "Learn this profession from its trainer to unlock its recipes.",
          ),
    );
  });
  return h(
    ModalWindow,
    {
      id: "professionModal",
      cardClassName: "large",
      title: "🛠️ Professions",
      screenLabel: "PROFESSIONS",
      visible,
    },
    h(
      "div",
      { id: "professionList", "data-react-owned": "1" },
      h(
        "div",
        { className: "profession-hero" },
        h("div", { className: "menu-icon" }, "🛠️"),
        h(
          "div",
          null,
          h("h3", null, "Professions"),
          h(
            "p",
            { className: "muted" },
            "Choose two professions. Gather, craft, specialize and feed the player economy.",
          ),
        ),
        h("span", { className: "profession-slots" }, `${known.length}/2 slots`),
      ),
      ...cards,
      h(
        "div",
        { className: "profession-note" },
        "Crafting quality ranges from Poor → Standard → Fine → Masterwork. Higher profession skill improves difficult recipe quality.",
      ),
    ),
  );
}

export function PvpModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const ps = s?.pvpStats || {};
  const arena = ps.arena || {};
  const q = s?.pvpQueue || {};
  const party = s?.party;
  const partySize = Number(party?.members?.length || 0);
  const isLeader = !party || party.leader === s?.player?.id;
  const rank = (r: any) =>
    Number(r || 0) >= 2400
      ? "Gladiator"
      : Number(r || 0) >= 2100
        ? "Duelist"
        : Number(r || 0) >= 1800
          ? "Rival"
          : Number(r || 0) >= 1600
            ? "Challenger"
            : Number(r || 0) >= 1400
              ? "Combatant"
              : "Unranked";
  const rated = ["2v2", "3v3"].map((br: string) => {
    const size = br === "3v3" ? 3 : 2;
    const queued = !!(q.arena?.queued && q.arena.bracket === br);
    const solo = queued
      ? Button(
          { className: "primary", "data-cmd": "pvp_arena_leave_queue" },
          `Leave ${br} Queue`,
        )
      : Button(
          {
            className: "primary",
            "data-cmd": "pvp_arena_queue",
            "data-bracket": br,
            "data-solo": "true",
          },
          `Solo Queue ${br}`,
        );
    const premade = party
      ? party.members?.length === size && isLeader
        ? Button(
            { "data-cmd": "pvp_arena_queue", "data-bracket": br },
            `Queue Party ${br}`,
          )
        : Button({ disabled: true }, `Need ${size}-player party`)
      : null;
    return h("div", { key: br, className: "arena-actions" }, solo, premade);
  });
  const bg = s?.battleground;
  const bgActive = bg?.state === "active";
  return h(
    ModalWindow,
    {
      id: "pvpModal",
      cardClassName: "large",
      title: "⚔️ Player vs PvP",
      screenLabel: "PVP",
      visible,
    },
    h(
      "div",
      { id: "pvpList" },
      h(
        "div",
        { className: "menu-hero" },
        h("div", { className: "menu-icon" }, "⚔️"),
        h(
          "div",
          null,
          h("h3", null, "Player vs Player"),
          h(
            "p",
            { className: "muted" },
            "Honor, rated Arenas, Battlegrounds and open-world PvP. Solo queue fills the other side; a premade party queues only at the exact bracket size.",
          ),
        ),
      ),
      h(
        "div",
        { className: "party-summary" },
        h("b", null, "Honor & Season"),
        h(
          "div",
          { className: "muted" },
          `Honor ${ps.honor || 0} • Conquest ${ps.conquest || 0} • K/D ${ps.kills || 0}/${ps.deaths || 0}`,
        ),
        h(
          "div",
          { className: "muted" },
          `Battlegrounds ${ps.battlegroundWins || 0}W / ${ps.battlegroundLosses || 0}L`,
        ),
      ),
      h(
        "div",
        { className: "party-summary" },
        h("b", null, "Rated Arena"),
        h(
          "div",
          { className: "muted" },
          `2v2: ${rank(arena["2v2"]?.rating)} • ${arena["2v2"]?.rating || 0} rating • ${arena["2v2"]?.mmr || 1000} MMR • ${arena["2v2"]?.wins || 0}-${arena["2v2"]?.losses || 0}`,
        ),
        h(
          "div",
          { className: "muted" },
          `3v3: ${rank(arena["3v3"]?.rating)} • ${arena["3v3"]?.rating || 0} rating • ${arena["3v3"]?.mmr || 1000} MMR • ${arena["3v3"]?.wins || 0}-${arena["3v3"]?.losses || 0}`,
        ),
        q.arena?.queued
          ? h(
              "div",
              { className: "muted" },
              `Queued for rated ${q.arena.bracket || "2v2"} • searching for opponents`,
            )
          : h(
              "div",
              { className: "arena-queue-help" },
              party
                ? `Party: ${partySize} player(s) • 2v2 needs 2, 3v3 needs 3.`
                : "No party • solo queue is available.",
            ),
        !q.arena?.queued
          ? h("div", { className: "actions-inline" }, ...rated)
          : null,
      ),
      bgActive
        ? h(
            "div",
            { className: "party-summary" },
            h("b", null, `🏳️ Battleground • ${bg.bracket || "level bracket"}`),
            h(
              "div",
              { className: "muted" },
              `Red ${bg.score?.red || 0} - Blue ${bg.score?.blue || 0} • Ends in ${Math.max(0, Math.ceil((Number(bg.endsAt || 0) - Date.now()) / 1000))}s`,
            ),
            ActionRow(
              Button(
                { className: "primary", "data-cmd": "pvp_capture" },
                "Capture Objective",
              ),
              Button({ "data-cmd": "pvp_battleground_attack" }, "Attack Enemy"),
              Button(
                { "data-cmd": "pvp_leave_battleground" },
                "Leave Battleground",
              ),
            ),
          )
        : h(
            "div",
            { className: "party-summary" },
            h("b", null, "Unrated Battleground"),
            h(
              "p",
              { className: "muted" },
              "Queue for a 10-player battleground. Players are matched inside level brackets, with five per team.",
            ),
            q.queued
              ? h(
                  "div",
                  { className: "muted" },
                  `Queued • position ${q.position || 1} • searching`,
                )
              : null,
            Button(
              {
                className: "primary",
                "data-cmd": q.queued ? "pvp_leave_queue" : "pvp_queue",
              },
              q.queued ? "Leave Queue" : "Queue Battleground",
            ),
          ),
      s?.lastPvpResult
        ? h(
            "div",
            { className: "party-summary" },
            h("b", null, "Last Match"),
            h(
              "div",
              { className: "muted" },
              `${s.lastPvpResult.mode || "PvP"} • ${s.lastPvpResult.result || "complete"} • Rating ${s.lastPvpResult.rating ?? "-"} • Honor ${s.lastPvpResult.honor ?? ps.honor ?? 0} • Conquest ${s.lastPvpResult.conquest ?? ps.conquest ?? 0}`,
            ),
          )
        : null,
      h(
        "div",
        { className: "party-summary" },
        h("b", null, "World PvP"),
        h(
          "div",
          { className: "muted" },
          s?.pvp?.zoneEnabled
            ? "PvP is enabled in this zone."
            : "This is a safe zone.",
        ),
      ),
    ),
  );
}

function stateBossName(s: any, d: any, enemyId: string | null) {
  if (s?.encounter?.enemy?.name) return s.encounter.enemy.name;
  if (enemyId) {
    const enemy = Object.values<any>(s?.catalog?.enemies || {}).find(
      (x: any) => x.id === enemyId,
    );
    if (enemy?.name) return enemy.name;
  }
  const bossStage = (d?.stages || []).find((x: any) => x.type === "boss");
  return bossStage?.name || null;
}

export function DungeonModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const p = s?.player || {};
  const q = s?.dungeonQueue || {};
  const ds = s?.catalog?.dungeons || [];
  const party = s?.party;
  const options = ds.filter(
    (d: any) =>
      Number(p.level || 1) >= Number(d.level || 1) &&
      Number(p.storyChapter || 0) >= Number(d.requiresStoryChapter || 0),
  );
  const selectedRole = String(q.role || p.partyRole || "DPS").toUpperCase();
  const leader = party?.leader === p.id;
  const roleButtons = ["TANK", "HEALER", "DPS"].map((r) =>
    Button(
      {
        key: r,
        className: `role-pick ${selectedRole === r ? "active" : ""}`,
        "data-cmd": "dungeon_set_role",
        "data-role": r,
      },
      r === "TANK" ? "🛡️ TANK" : r === "HEALER" ? "💚 HEALER" : "⚔️ DPS",
    ),
  );
  const finder = h(
    "div",
    { className: "dungeon-finder-card dungeon-finder-v2" },
    h(
      "div",
      { className: "df-main" },
      h("div", { className: "eyebrow" }, "MATCHMAKING"),
      h("h3", null, "🧭 Dungeon Finder"),
      h(
        "p",
        { className: "muted" },
        "Queue solo or as a premade party. Pick your role, find a group, confirm the ready check, then enter the right dungeon for your level.",
      ),
      h(
        "div",
        { className: "df-controls" },
        h(
          "label",
          null,
          "Dungeon",
          h(
            "select",
            { id: "dungeonSelect", defaultValue: "random" },
            h(
              "option",
              { value: "random", disabled: !options.length },
              options.length ? "Random Dungeon" : "Unlocks at level 4",
            ),
            ...options.map((d: any) => {
              const r = d.levelRange || { min: d.level, max: 60 };
              return h(
                "option",
                { key: d.id, value: d.id },
                `${d.name} • Lv ${r.min}-${r.max}`,
              );
            }),
          ),
        ),
        h(
          "div",
          null,
          h("span", { className: "muted" }, "Your role"),
          h("div", { className: "role-picks" }, ...roleButtons),
        ),
      ),
      h(
        "div",
        { className: "role-coverage" },
        h("span", null, `Queue: ${q.roles?.TANK || 0} Tank`),
        h("span", null, `${q.roles?.HEALER || 0} Healer`),
        h("span", null, `${q.roles?.DPS || 0} DPS`),
      ),
      party
        ? h(
            "div",
            { className: "role-coverage" },
            h("span", null, `Party: ${party.members?.length || 0}/5`),
          )
        : null,
    ),
    h(
      "div",
      { className: "actions-inline" },
      q.queued
        ? Button({ "data-cmd": "dungeon_leave_queue" }, "Leave Queue")
        : party && leader
          ? Button(
              {
                className: "primary",
                "data-cmd": "dungeon_queue_party",
                "data-dungeon-id": "random",
                disabled: !options.length,
              },
              "Queue Party",
            )
          : Button(
              {
                className: "primary",
                "data-cmd": "dungeon_queue",
                "data-dungeon-id": "random",
                "data-role": selectedRole,
                disabled: !options.length,
              },
              options.length ? "Find Group" : "Unlocks at level 4",
            ),
    ),
  );
  const chests = (s?.dungeonRewardChests || []).filter(
    (c: any) => !c.claimedAt,
  );
  const chest = chests.length
    ? h(
        "div",
        { className: "dungeon-finder-card" },
        h("b", null, "🎁 Unclaimed Dungeon Rewards"),
        h(
          "div",
          { className: "muted" },
          ...chests.map((c: any) =>
            h(
              "div",
              { key: c.id },
              `${c.dungeonName || "Completed Dungeon"} • ${Number(c.rewards?.xp || 0)} XP • ${Number(c.rewards?.gold || 0)}g`,
            ),
          ),
        ),
        h(
          "div",
          { className: "actions-inline" },
          ...chests.map((c: any) =>
            Button(
              {
                key: c.id,
                className: "primary",
                "data-cmd": "claim_dungeon_reward",
                "data-chest-id": c.id,
              },
              "Open Chest",
            ),
          ),
        ),
      )
    : null;
  let activeView: any = null;
  if (p.dungeon) {
    const d = ds.find((x: any) => x.id === p.dungeon.id) || {};
    const stage = Number(p.dungeon.stage || 0);
    const room =
      d.rooms?.find((r: any) => Number(r.id) === Number(p.dungeon.roomId)) ||
      d.rooms?.[Math.min(stage, (d.rooms?.length || 1) - 1)];
    const routes = p.dungeon.roomCleared
      ? (d.routeChoices || []).filter(
          (r: any) =>
            Number(r.afterRoom) === Number(room?.id) &&
            (!p.dungeon.availableRoutes?.length ||
              p.dungeon.availableRoutes.includes(r.id)),
        )
      : [];
    const optional = p.dungeon.roomCleared
      ? (d.optionalRooms || []).filter(
          (r: any) =>
            Number(r.requiresRoom) === Number(room?.id) &&
            !(p.dungeon.optionalCleared || []).includes(r.id),
        )
      : [];
    const shortcuts = p.dungeon.roomCleared
      ? (d.shortcuts || []).filter(
          (r: any) =>
            Number(r.afterRoom) === Number(room?.id) &&
            !(p.dungeon.shortcutsUnlocked || []).includes(r.id),
        )
      : [];
    const event = s?.dungeon?.activeEvent;
    const bossArt = BOSS_VISUALS[d.baseDungeonId || d.id] || null;
    const bossEnemy =
      (d.stages || []).find((x: any) => x.type === "boss")?.enemyId || null;
    const activeBossName = stateBossName(s, d, bossEnemy);
    activeView = h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "dungeon-active-hero" },
        bossArt
          ? h("img", {
              className: "dungeon-active-boss-art",
              src: `/assets/ashenfall/bosses/${bossArt}`,
              alt: "",
              loading: "eager",
            })
          : h(
              "div",
              { className: "dungeon-active-boss-placeholder" },
              d.icon || "🏰",
            ),
        h(
          "div",
          { className: "dungeon-active-main" },
          h("div", { className: "eyebrow" }, "CURRENT DUNGEON"),
          h(
            "h3",
            null,
            ds.find((x: any) => x.id === p.dungeon.id)?.name || p.dungeon.id,
          ),
          h(
            "p",
            { className: "muted" },
            `Stage ${stage + 1}/${d.stages?.length || 0} • ${room?.name || "Unknown"}`,
          ),
          activeBossName
            ? h(
                "div",
                { className: "dungeon-active-boss-name" },
                h("span", null, "Final boss"),
                h("b", null, activeBossName),
              )
            : null,
        ),
        h(
          "div",
          { className: "actions-inline" },
          Button(
            { className: "primary", "data-action": "open-world-map" },
            "🗺️ Map",
          ),
          Button({ "data-cmd": "abandon_dungeon" }, "Leave"),
        ),
      ),
      h(
        "div",
        { className: "dungeon-run-grid" },
        h(
          "div",
          { className: "dungeon-room-card" },
          h("b", null, room?.name || "Current Area"),
          h(
            "div",
            { className: "muted" },
            p.dungeon.roomCleared
              ? "Area cleared • choose your next route."
              : event
                ? `Event active: ${event.name}`
                : "Objective active",
          ),
          event
            ? h(
                "div",
                { className: "dungeon-event-callout" },
                "⚠️ ",
                h("b", null, event.name),
                h("span", null, event.message || ""),
              )
            : null,
          routes.length
            ? h(
                "div",
                null,
                h("div", { className: "eyebrow" }, "ROUTE CHOICE"),
                ...routes.map((r: any) =>
                  h(
                    "button",
                    {
                      key: r.id,
                      className: "wide",
                      "data-cmd": "dungeon_choose_route",
                      "data-route-id": r.id,
                    },
                    h("b", null, r.label),
                    h("small", null, r.description || ""),
                  ),
                ),
              )
            : null,
          optional.length
            ? h(
                "div",
                null,
                h("div", { className: "eyebrow" }, "OPTIONAL AREA"),
                ...optional.map((r: any) =>
                  h(
                    "button",
                    {
                      key: r.id,
                      className: "wide",
                      "data-cmd": "dungeon_enter_optional",
                      "data-room-id": r.id,
                    },
                    `🔎 ${r.name} `,
                    h(
                      "small",
                      null,
                      `Bonus ${Number(r.reward?.xp || 0)} XP / ${Number(r.reward?.gold || 0)}g`,
                    ),
                  ),
                ),
              )
            : null,
          shortcuts.length
            ? h(
                "div",
                null,
                h("div", { className: "eyebrow" }, "SHORTCUT"),
                ...shortcuts.map((r: any) =>
                  h(
                    "button",
                    {
                      key: r.id,
                      className: "wide primary",
                      "data-cmd": "dungeon_unlock_shortcut",
                      "data-shortcut-id": r.id,
                    },
                    `↗ ${r.label} `,
                    h("small", null, r.description || ""),
                  ),
                ),
              )
            : null,
        ),
        h(
          "div",
          { className: "dungeon-run-sidebar" },
          h(
            "div",
            { className: "dungeon-summary-box" },
            h("b", null, "Party"),
            ...(party?.members || []).map((m: any) =>
              h(
                "div",
                { key: m.id, className: "dungeon-party-line" },
                h("span", null, m.name),
                h("span", null, `${m.role || "DPS"} • Lv ${m.level}`),
              ),
            ),
            !party ? h("span", { className: "muted" }, "Solo") : null,
          ),
          h(
            "div",
            { className: "dungeon-summary-box" },
            h("b", null, "Encounter structure"),
            h(
              "div",
              { className: "muted" },
              `${d.stages?.length || 0} encounters • ${d.rooms?.length || 0} rooms • ${(d.routeChoices || []).length} routes`,
            ),
          ),
          h(
            "div",
            { className: "dungeon-summary-box" },
            h("b", null, "Final rewards"),
            h(
              "div",
              { className: "muted" },
              `+${Number(d.reward?.xp || 0)} XP • +${Number(d.reward?.gold || 0)} gold`,
            ),
          ),
        ),
      ),
    );
  }
  const cards = ds.map((d: any) => {
    const range = d.levelRange || { min: d.level, max: 60 };
    const locked =
      Number(p.level || 1) < Number(range.min || d.level || 1) ||
      Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0);
    const active = p.dungeon?.id === d.id;
    const art = BOSS_VISUALS[d.baseDungeonId || d.id];
    return h(
      "div",
      { key: d.id, className: `dungeon-card ${locked ? "locked" : ""}` },
      h(
        "div",
        { className: "dungeon-card-head" },
        h("b", null, `${d.icon || "🏰"} ${d.name}`),
        h("span", null, `Lv ${range.min}-${range.max}`),
      ),
      art
        ? h("img", {
            className: "dungeon-boss-art",
            src: `/assets/ashenfall/bosses/${art}`,
            alt: "",
            loading: "lazy",
          })
        : null,
      h("p", null, d.description || "A dangerous party dungeon."),
      h(
        "div",
        { className: "dungeon-meta" },
        h("span", null, `⚔️ ${d.stages?.length || 0} encounters`),
        h("span", null, `🗺️ ${d.rooms?.length || 0} rooms`),
        h("span", null, `🔀 ${(d.routeChoices || []).length} routes`),
        h("span", null, `✨ ${(d.optionalRooms || []).length} optional`),
      ),
      locked
        ? h(
            "div",
            { className: "dungeon-lock" },
            `🔒 Unlocks at level ${range.min}${Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0) ? ` • Story Chapter ${d.requiresStoryChapter}` : ""}`,
          )
        : active
          ? h("div", { className: "dungeon-active-label" }, "IN PROGRESS")
          : party
            ? Button(
                {
                  className: "wide",
                  "data-cmd": "start_dungeon",
                  "data-dungeon-id": d.id,
                  disabled: party.leader !== p.id,
                },
                party.leader === p.id ? "Enter Dungeon" : "Party leader enters",
              )
            : h(
                "div",
                { className: "muted" },
                "Use Dungeon Finder above for a 5-player group.",
              ),
    );
  });
  return h(
    ModalWindow,
    {
      id: "dungeonModal",
      cardClassName: "xlarge",
      title: "🏰 Dungeon Finder",
      screenLabel: "DUNGEONS",
      visible,
    },
    h(
      "div",
      { id: "dungeonList" },
      finder,
      chest,
      activeView,
      h("div", { className: "dungeon-directory" }, ...cards),
    ),
  );
}

export function DungeonMatchModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const m = s?.dungeonMatch;
  if (!m)
    return h(
      ModalWindow,
      {
        id: "dungeonMatchModal",
        title: "🏰 Dungeon Ready",
        screenLabel: "READY CHECK",
        visible: false,
      },
      h("div", null),
    );
  const players = (m.playerIds || []).map(
    (id: any) =>
      (s.party?.members || []).find((x: any) => x.id === id) || {
        id,
        name: id,
        role: m.roles?.[id] || "DPS",
      },
  );
  return h(
    ModalWindow,
    {
      id: "dungeonMatchModal",
      title: "🏰 Dungeon Ready",
      screenLabel: "READY CHECK",
      visible,
    },
    h(
      "div",
      { id: "dungeonMatchContent" },
      h(
        "div",
        { className: "dungeon-ready-head" },
        h("div", { className: "dungeon-ready-icon" }, "🏰"),
        h(
          "div",
          null,
          h("h3", null, m.dungeonName || "Dungeon"),
          h(
            "p",
            { className: "muted" },
            `A full party has been found. Confirm within ${Math.max(0, Math.ceil((Number(m.expiresAt || 0) - Date.now()) / 1000))}s.`,
          ),
        ),
      ),
      h(
        "div",
        { className: "ready-group" },
        ...players.map((x: any) =>
          h(
            "div",
            { key: x.id, className: "ready-player" },
            h("span", null, x.name || "Player"),
            h("b", null, m.roles?.[x.id] || x.role || "DPS"),
            h(
              "span",
              {
                className: `ready-state ${x.id === s.player.id && m.accepted ? "ready" : ""}`,
              },
              x.id === s.player.id
                ? m.accepted
                  ? "READY"
                  : "WAITING"
                : "GROUP",
            ),
          ),
        ),
      ),
      ActionRow(
        m.accepted
          ? Button({ className: "primary", disabled: true }, "✓ Ready")
          : Button(
              { className: "primary", "data-cmd": "dungeon_accept_match" },
              "Accept",
            ),
        Button({ "data-cmd": "dungeon_decline_match" }, "Decline"),
      ),
    ),
  );
}

export function SocialInviteModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const cards: any[] = [];
  const pi = s?.pendingPartyInvite;
  const gi = s?.pendingGuildInvite;
  const pv = s?.pendingPvpInvite;
  if (pi)
    cards.push(
      h(
        "div",
        { key: "p", className: "social-invite-card" },
        h("div", { className: "social-invite-icon" }, "👥"),
        h(
          "div",
          { className: "social-invite-main" },
          h("h3", null, `${pi.fromName} invited you to a party`),
          h("p", { className: "muted" }, "Join their party and play together."),
          ActionRow(
            Button(
              {
                className: "primary",
                "data-cmd": "party_accept",
                "data-party-id": pi.partyId,
              },
              "Accept",
            ),
            Button(
              { "data-cmd": "party_decline", "data-party-id": pi.partyId },
              "Decline",
            ),
          ),
        ),
      ),
    );
  if (gi)
    cards.push(
      h(
        "div",
        { key: "g", className: "social-invite-card guild" },
        h("div", { className: "social-invite-icon" }, "⚔️"),
        h(
          "div",
          { className: "social-invite-main" },
          h("h3", null, `${gi.fromName} invited you to a guild`),
          h(
            "p",
            { className: "muted" },
            `Join ${gi.guildName || "their guild"}.`,
          ),
          ActionRow(
            Button(
              {
                className: "primary",
                "data-cmd": "guild_accept",
                "data-guild-id": gi.guildId,
              },
              "Accept",
            ),
            Button({ "data-cmd": "guild_decline" }, "Decline"),
          ),
        ),
      ),
    );
  if (pv)
    cards.push(
      h(
        "div",
        { key: "v", className: "social-invite-card pvp" },
        h("div", { className: "social-invite-icon" }, "⚔️"),
        h(
          "div",
          { className: "social-invite-main" },
          h("h3", null, `${pv.fromName} challenged you to PvP`),
          h(
            "p",
            { className: "muted" },
            "Accept to begin a duel in your current zone.",
          ),
          ActionRow(
            Button(
              {
                className: "primary",
                "data-cmd": "pvp_accept",
                "data-from-id": pv.fromId,
              },
              "Accept Duel",
            ),
            Button({ "data-cmd": "pvp_decline" }, "Decline"),
          ),
        ),
      ),
    );
  return h(
    ModalWindow,
    {
      id: "socialInviteModal",
      cardClassName: "large",
      title: "🔔 Invitations",
      screenLabel: "INVITES",
      visible: visible && cards.length,
    },
    h("div", { id: "socialInviteContent" }, ...cards),
  );
}

export function TradeModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const trade = s?.trade;
  const t = trade?.session;
  const pending = trade?.pending;
  if (!t)
    return h(
      ModalWindow,
      {
        id: "tradeModal",
        title: "🤝 Trade",
        screenLabel: "TRADE",
        visible: visible && !!pending,
      },
      pending
        ? h(
            "div",
            { id: "tradeBody", className: "party-invite" },
            h("b", null, pending.fromName || "Player"),
            " wants to trade with you.",
            h(
              "div",
              { className: "trade-actions" },
              Button({ "data-cmd": "trade_decline" }, "Decline"),
              Button(
                {
                  className: "primary",
                  "data-cmd": "trade_accept",
                  "data-from-id": pending.fromId,
                },
                "Accept Trade",
              ),
            ),
          )
        : null,
    );
  const fmt = (o: any) =>
    [
      o.gold ? `🪙 ${o.gold}` : "",
      o.items?.length
        ? o.items
            .map(
              (x: any) =>
                `${s.catalog?.items?.[x.itemId]?.icon || "📦"} ×${x.qty}`,
            )
            .join(" ")
        : "",
    ]
      .filter(Boolean)
      .join(" ") || "Nothing";
  return h(
    ModalWindow,
    {
      id: "tradeModal",
      cardClassName: "large",
      title: "🤝 Trade",
      screenLabel: "TRADE",
      visible,
    },
    h(
      "div",
      { id: "tradeBody" },
      h(
        "div",
        { className: "trade-grid" },
        h(
          "div",
          { className: "trade-side" },
          h("h3", null, "You"),
          h("div", null, "Gold offered: ", h("b", null, t.my.gold)),
          h(
            "div",
            { className: "trade-items" },
            ...(s.player.inventory || [])
              .filter((x: any) => x.qty > 0)
              .map((x: any) => {
                const it = s.catalog?.items?.[x.itemId] || {};
                const blocked = it.soulbound || it.tradeable === false;
                return Button(
                  {
                    key: x.itemId,
                    className: "trade-item",
                    "data-cmd": "trade_offer",
                    "data-item-id": x.itemId,
                    "data-qty": "1",
                    disabled: blocked,
                  },
                  `${it.icon || "📦"} ${x.qty}`,
                );
              }),
          ),
          h(
            "div",
            { className: "trade-offer" },
            "Your offer:",
            h("br"),
            fmt(t.my),
            ...(t.my.items || []).map((x: any) => {
              const it = s.catalog?.items?.[x.itemId] || {};
              return Button(
                {
                  key: `remove-${x.itemId}`,
                  className: "trade-item-remove",
                  "data-cmd": "trade_offer",
                  "data-item-id": x.itemId,
                  "data-qty": "-1",
                  disabled: !!t.myLocked,
                },
                `− ${it.icon || "📦"} ${it.name || x.itemId} (${x.qty})`,
              );
            }),
          ),
          h(
            "label",
            null,
            "Gold ",
            h("input", {
              id: "tradeGold",
              type: "number",
              min: 0,
              max: s.player.gold,
              defaultValue: t.my.gold,
            }),
          ),
          Button({ "data-action": "trade-set-gold" }, "Set Gold"),
        ),
        h(
          "div",
          { className: "trade-side" },
          h("h3", null, t.other?.name || "Player"),
          h("div", null, "Gold offered: ", h("b", null, t.their.gold)),
          h(
            "div",
            { className: "trade-offer" },
            "Their offer:",
            h("br"),
            fmt(t.their),
          ),
          h(
            "div",
            { className: "muted" },
            `${t.theirLocked ? "🔒 Offer locked" : "Offer open"} • ${t.theirConfirmed ? "✓ Confirmed" : "Waiting for confirmation"}`,
          ),
        ),
      ),
      h(
        "div",
        { className: "trade-actions" },
        Button({ "data-cmd": "trade_cancel" }, "Cancel"),
        Button(
          { "data-cmd": "trade_unlock", disabled: !t.myLocked },
          t.myLocked ? "Unlock Offer" : "Unlocked",
        ),
        Button(
          { "data-cmd": "trade_lock", disabled: t.myLocked },
          t.myLocked ? "🔒 Locked" : "Lock Offer",
        ),
        Button(
          {
            className: "primary",
            "data-cmd": "trade_confirm",
            disabled: !t.myLocked || !t.theirLocked || t.myConfirmed,
          },
          t.myConfirmed ? "Confirmed" : "Confirm Trade",
        ),
      ),
    ),
  );
}
