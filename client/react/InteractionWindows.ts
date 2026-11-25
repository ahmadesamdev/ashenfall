import * as React from "react";
import { ModalWindow } from "./ModalWindow.js";

const h = React.createElement;
const getState = () => (window as any).__ashenfallClientState ?? null;
const getUi = () => (window as any).__ashenfallReactUi ?? {};

function useUiVersion() {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const refresh = () => setVersion(Date.now());
    window.addEventListener("ashenfall-ui-state", refresh);
    window.addEventListener("ashenfall-react-ui-refresh", refresh);
    return () => {
      window.removeEventListener("ashenfall-ui-state", refresh);
      window.removeEventListener("ashenfall-react-ui-refresh", refresh);
    };
  }, []);
}

function itemTip(item: any): string {
  if (!item) return "Unknown item.";
  const lines = [String(item.name || "Unknown item.")];
  if (item.level) lines.push(`Required level: ${item.level}`);
  if (item.type) lines.push(`Type: ${String(item.type).replace(/_/g, " ")}`);
  if (item.power) lines.push(`Weapon Power: +${item.power}`);
  if (item.armor) lines.push(`Armor: +${item.armor}`);
  for (const affix of item.affixes || [])
    if (affix?.name) lines.push(String(affix.name));
  if (item.description)
    lines.push(
      `Effect: ${String(item.description)
        .replace(/^Use this consumable for its listed effect\.\s*/i, "")
        .trim()}`,
    );
  return lines.join("\n");
}

export function TrainerModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const cls = s?.catalog?.classes?.[s?.player?.classId] || {};
  const ids = new Set(s?.player?.abilityIds || []);
  const trainer = (s?.npcs || []).find(
    (n: any) => n.kind === "trainer" && n.classId === s?.player?.classId,
  );
  const near =
    !!trainer &&
    Math.hypot(
      Number(s?.player?.x) - Number(trainer.x),
      Number(s?.player?.y) - Number(trainer.y),
    ) <= 12;
  const entries = Object.entries(cls.abilityUnlocks || {});

  return h(
    ModalWindow,
    {
      id: "trainerModal",
      title: "🧙 Class Trainer",
      screenLabel: "TRAINER",
      visible,
    },
    h(
      "div",
      { id: "trainerList" },
      h(
        "div",
        { className: "trainer-hero" },
        h(
          "div",
          null,
          h("div", { className: "eyebrow" }, "CLASS TRAINER"),
          h(
            "h3",
            null,
            `${cls.name || s?.player?.classId || "Class"} Training`,
          ),
          h(
            "p",
            { className: "muted" },
            trainer
              ? near
                ? "You are within training range."
                : `Move to ${trainer.name || "your class trainer"} to learn abilities.`
              : "Your class trainer is not in this zone.",
          ),
        ),
      ),
      h(
        "div",
        { className: "trainer-skill-list" },
        entries.length
          ? entries.map(([id, lvl]: any) => {
              const ability = s?.catalog?.abilities?.[id] || {};
              const learned = ids.has(id);
              const canLearn =
                near &&
                Number(s?.player?.level || 0) >= Number(lvl || 1) &&
                !learned;
              return h(
                "div",
                {
                  key: id,
                  className: `trainer-skill-row ${learned ? "learned" : ""}`,
                },
                h(
                  "span",
                  { className: "trainer-skill-icon" },
                  ability.icon || "✦",
                ),
                h(
                  "div",
                  { className: "trainer-skill-main" },
                  h("b", null, ability.name || id),
                  h(
                    "span",
                    null,
                    learned ? "Learned" : `Unlocks at level ${lvl}`,
                  ),
                  h("small", null, ability.description || ""),
                ),
                learned
                  ? "✓"
                  : canLearn
                    ? h(
                        "button",
                        {
                          className: "primary",
                          "data-cmd": "learn_skill",
                          "data-ability-id": id,
                        },
                        "Learn",
                      )
                    : h(
                        "span",
                        { className: "muted" },
                        Number(s?.player?.level || 0) < Number(lvl || 1)
                          ? "🔒"
                          : "Visit trainer",
                      ),
              );
            })
          : h(
              "div",
              { className: "muted" },
              "No class abilities are currently defined.",
            ),
      ),
    ),
  );
}

function ShopRow({
  item,
  children,
  className = "",
}: {
  item: any;
  children: any;
  className?: string;
}) {
  return h(
    "div",
    { className: `shop-row ${className}`.trim(), "data-tip": itemTip(item) },
    children,
  );
}

export function ShopModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const id = getUi().selectedShopId || s?.shops?.[0]?.id;
  const shop = (s?.shops || []).find((x: any) => x.id === id);
  const inventory = (s?.player?.inventory || []).filter((x: any) => x.qty > 0);
  const gold = Number(s?.player?.gold || 0);

  const buyRows = (shop?.items || []).map((line: any) => {
    const item = {
      ...(s?.catalog?.items?.[line.itemId] || {}),
      itemId: line.itemId,
    };
    return h(
      ShopRow,
      { key: line.itemId, item },
      h(
        "div",
        null,
        h(
          "div",
          null,
          h("b", null, `${item.icon || "📦"} ${item.name || line.itemId}`),
          h(
            "div",
            { className: "muted" },
            `${item.rarity || "common"} • ${item.type || "misc"}`,
          ),
        ),
        h(
          "button",
          {
            type: "button",
            "data-cmd": "buy_shop",
            "data-shop-id": shop?.id,
            "data-item-id": line.itemId,
          },
          `🪙 ${line.price} Buy`,
        ),
      ),
    );
  });

  const sellRows = inventory.map((entry: any) => {
    const item = {
      ...(s?.catalog?.items?.[entry.itemId] || {}),
      itemId: entry.itemId,
    };
    const equipped = Object.values(s?.player?.equipment || {}).includes(
      entry.itemId,
    );
    const price = Number(
      s?.vendorPrices?.[entry.itemId] || item.vendorPrice || 1,
    );
    return h(
      ShopRow,
      { key: entry.itemId, item, className: "sell-row" },
      h(
        "div",
        null,
        h(
          "div",
          null,
          h("b", null, `${item.icon || "📦"} ${item.name || entry.itemId}`),
          h(
            "div",
            { className: "muted" },
            `×${entry.qty} • Sell value ${price}g each${equipped ? " • Equipped" : ""}`,
          ),
        ),
        h(
          "button",
          {
            type: "button",
            "data-cmd": "sell_shop",
            "data-item-id": entry.itemId,
            disabled: equipped,
          },
          `🪙 ${price} Sell 1`,
        ),
      ),
    );
  });

  const buybacks = (s?.player?.recentSales || []).filter(
    (x: any) => Number(x.soldAt || 0) > Date.now() - 30 * 60 * 1000,
  );
  const buybackRows = buybacks.map((entry: any) => {
    const item = s?.catalog?.items?.[entry.itemId] || {};
    const price = Math.max(1, Math.ceil(Number(entry.unitPrice || 1) * 1.5));
    return h(
      "div",
      { key: entry.itemId, className: "shop-row" },
      h(
        "div",
        null,
        h("b", null, `${item.icon || "📦"} ${item.name || entry.itemId}`),
        h(
          "div",
          { className: "muted" },
          `×${entry.qty} • Buyback ${price}g each`,
        ),
      ),
      h(
        "button",
        {
          type: "button",
          "data-cmd": "buyback_shop",
          "data-item-id": entry.itemId,
        },
        "Buy Back",
      ),
    );
  });

  const forge =
    shop?.id === "stonehold_armory" || shop?.id === "citadel_armory"
      ? h(
          "div",
          { className: "card forge-pane" },
          h("h3", null, "⚒️ Forge"),
          h(
            "p",
            { className: "muted" },
            "Forge at the blacksmith using your learned Blacksmithing profession.",
          ),
          [
            ["iron_sword", "Copper Sword", "3 Copper Ore", 1],
            ["grave_steel_blade", "Grave Steel Blade", "5 Umbral Iron Ore", 3],
            ["blacksteel_blade", "Blacksteel Blade", "6 Blacksteel Ore", 6],
          ].map((r: any[]) =>
            h(
              "div",
              { key: r[0], className: "shop-row" },
              h(
                "div",
                null,
                h("b", null, r[1]),
                h(
                  "div",
                  { className: "muted" },
                  `${r[2]} • Blacksmithing ${r[3]}`,
                ),
              ),
              h(
                "button",
                {
                  type: "button",
                  "data-cmd": "craft_blacksmith",
                  "data-item-id": r[0],
                },
                "Forge",
              ),
            ),
          ),
        )
      : null;

  return h(
    ModalWindow,
    {
      id: "shopModal",
      cardClassName: "xlarge",
      title: "🛒 Shop & Sell",
      screenLabel: "VENDOR",
      visible,
    },
    h(
      "div",
      { id: "shopList", className: "shop-layout" },
      h(
        "div",
        { className: "shop-pane" },
        h(
          "div",
          { className: "shop-pane-head" },
          h("h3", null, `${shop?.icon || "🛒"} ${shop?.name || "Shop"}`),
          h("span", null, `🪙 ${gold}`),
        ),
        buyRows.length
          ? buyRows
          : h("div", { className: "muted" }, "This shop has no stock."),
      ),
      h(
        "div",
        { className: "shop-pane" },
        h(
          "div",
          { className: "shop-pane-head" },
          h("h3", null, "↩️ Buyback"),
          h("span", null, "30 min"),
        ),
        buybackRows.length
          ? buybackRows
          : h("div", { className: "muted" }, "No recent sales to recover."),
      ),
      h(
        "div",
        { className: "shop-pane" },
        h(
          "div",
          { className: "shop-pane-head" },
          h("h3", null, "🎒 Your Bag"),
          h(
            "span",
            null,
            `${inventory.reduce((n: number, x: any) => n + x.qty, 0)} items`,
          ),
        ),
        h(
          "p",
          { className: "muted" },
          "Sell individual items here. Equipped items must be unequipped first.",
        ),
        sellRows.length
          ? sellRows
          : h("div", { className: "muted" }, "Your bag is empty."),
        forge,
      ),
    ),
  );
}

function questData(s: any, npc: any) {
  const classAllowed = (quest: any) => {
    const classId = String(s?.player?.classId || "");
    const allowed = quest?.classIds || quest?.classes || quest?.class;
    if (Array.isArray(allowed) && allowed.length)
      return allowed.map(String).includes(classId);
    return typeof quest?.classId === "string" && quest.classId
      ? quest.classId === classId
      : true;
  };
  const offers = (npc?.questIds || [])
    .map((id: any) => s.catalog?.quests?.find((q: any) => q.id === id))
    .filter(Boolean)
    .filter((q: any) => {
      const progress = s.player?.quests?.[q.id] || {};
      return (
        !progress.claimed &&
        !progress.accepted &&
        classAllowed(q) &&
        (!q.minLevel || s.player.level >= q.minLevel) &&
        (q.requires || []).every((id: any) => s.player.quests?.[id]?.claimed)
      );
    })
    .map((quest: any) => ({ quest }));
  const active = (npc?.questIds || [])
    .map((id: any) => s.catalog?.quests?.find((q: any) => q.id === id))
    .filter(Boolean)
    .map((quest: any) => ({ quest, state: s.player?.quests?.[quest.id] || {} }))
    .filter((x: any) => x.state.accepted && !x.state.claimed);
  return {
    offers,
    activeQuests: active.filter((x: any) => !x.state.complete),
    turnins: active.filter((x: any) => x.state.complete),
  };
}

export function NpcModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const id = getUi().openNpcId;
  const npc = (s?.npcs || []).find((x: any) => x.id === id);
  if (!npc)
    return h(
      ModalWindow,
      { id: "npcModal", title: "NPC", screenLabel: "NPC", visible },
      h("div", { className: "detail-panel" }, "Select an NPC."),
    );
  const detail = questData(s, npc);
  const cls = s?.catalog?.classes?.[npc.classId] || {};
  const mismatch = npc.kind === "trainer" && npc.classId !== s?.player?.classId;
  const playerClass = s?.catalog?.classes?.[s?.player?.classId] || {};
  const professionLabels: Record<string, string> = {
    mining: "⛏️ Mining",
    blacksmith: "⚒️ Blacksmithing",
    skinning: "🪶 Skinning",
    alchemy: "⚗️ Alchemy",
    cooking: "🍲 Cooking",
  };
  const professionNode =
    npc.kind === "profession_trainer" && getUi().npcService
      ? (() => {
          const service = getUi().npcService;
          return h(
            "div",
            { className: "npc-service-menu" },
            h(
              "div",
              { className: "service-choice" },
              h("b", null, professionLabels[service.id] || service.id),
              h(
                "span",
                { className: "muted" },
                service.known ? `Level ${service.level || 0}` : "Not learned",
              ),
              service.known
                ? h(
                    "button",
                    {
                      type: "button",
                      "data-cmd": "drop_profession",
                      "data-profession": service.id,
                    },
                    "Forget Profession",
                  )
                : h(
                    "button",
                    {
                      type: "button",
                      className: "primary",
                      "data-cmd": "select_profession",
                      "data-profession": service.id,
                    },
                    "Learn Profession",
                  ),
            ),
          );
        })()
      : null;

  const offerNodes = detail.offers.length
    ? h(
        React.Fragment,
        null,
        h("h3", null, "❗ Quests"),
        ...detail.offers.map((x: any) =>
          h(
            "div",
            { key: x.quest.id, className: "quest-offer" },
            h("b", null, `❗ ${x.quest.name}`),
            h("p", null, x.quest.description),
            h(
              "div",
              { className: "muted" },
              `✨ ${x.quest.xp || 0} XP • 🪙 ${x.quest.gold || 0} gold`,
            ),
            h(
              "button",
              {
                type: "button",
                "data-cmd": "accept_quest",
                "data-quest-id": x.quest.id,
              },
              "Accept Quest",
            ),
          ),
        ),
      )
    : null;
  const activeNodes = detail.activeQuests.length
    ? h(
        React.Fragment,
        null,
        h("h3", null, "📜 Active quest"),
        ...detail.activeQuests.map((x: any) =>
          h(
            "div",
            { key: x.quest.id, className: "quest-offer" },
            h("b", null, `📜 ${x.quest.name}`),
            h("p", null, x.quest.description),
            h(
              "div",
              { className: "muted" },
              `Progress: ${x.state.progress || 0}/${x.quest.amount || 1} • In progress`,
            ),
          ),
        ),
      )
    : null;
  const turninNodes = detail.turnins.length
    ? h(
        React.Fragment,
        null,
        h("h3", null, "❓ Ready to turn in"),
        ...detail.turnins.map((x: any) =>
          h(
            "div",
            { key: x.quest.id, className: "quest-offer" },
            h("b", null, `❓ ${x.quest.name}`),
            h("p", null, x.quest.description),
            h(
              "button",
              {
                type: "button",
                className: "primary",
                "data-cmd": "turnin_quest",
                "data-quest-id": x.quest.id,
              },
              "Turn In & Receive Reward",
            ),
          ),
        ),
      )
    : null;
  const serviceNodes =
    (npc.kind === "shop" || npc.kind === "blacksmith") && npc.shopId
      ? h(
          React.Fragment,
          null,
          h("h3", null, "Services"),
          h(
            "div",
            { className: "npc-service-menu" },
            h(
              "button",
              {
                type: "button",
                "data-action": "npc-shop",
                "data-shop-id": npc.shopId,
              },
              "🛒 Open Shop",
            ),
            npc.kind === "blacksmith"
              ? h(
                  "button",
                  {
                    type: "button",
                    "data-action": "npc-craft",
                    "data-shop-id": npc.shopId,
                  },
                  "⚒️ Open Forge",
                )
              : null,
          ),
        )
      : null;
  const auctionNode =
    npc.kind === "auctioneer"
      ? h(
          React.Fragment,
          null,
          h("h3", null, "Services"),
          h(
            "div",
            { className: "npc-service-menu" },
            h(
              "button",
              { type: "button", "data-action": "npc-auction" },
              "⚖️ Auction House",
            ),
          ),
        )
      : null;

  return h(
    ModalWindow,
    {
      id: "npcModal",
      title: `${npc.icon || "👤"} ${npc.name || "NPC"}`,
      subtitle: npc.title || npc.kind || "NPC",
      screenLabel: "NPC",
      visible,
    },
    h(
      "div",
      { id: "npcBody", className: "detail-panel" },
      h("p", null, npc.title || "A citizen of Ashenfall."),
      professionNode,
      npc.kind === "trainer"
        ? h(
            "div",
            { className: "trainer-note" },
            mismatch
              ? h(
                  React.Fragment,
                  null,
                  h(
                    "b",
                    null,
                    `${npc.name} only trains ${cls.name || "this class"} adventurers.`,
                  ),
                  h(
                    "p",
                    { className: "muted" },
                    `You are a ${playerClass.name || s?.player?.classId}. Seek your own class trainer.`,
                  ),
                )
              : h(
                  React.Fragment,
                  null,
                  h("h3", null, `${cls.name || "Class"} Training`),
                  h("p", { className: "muted" }, "Your class trainer."),
                ),
          )
        : null,
      offerNodes,
      activeNodes,
      turninNodes,
      serviceNodes,
      auctionNode,
      !detail.offers.length &&
        !detail.activeQuests.length &&
        !detail.turnins.length &&
        npc.kind === "quest"
        ? h(
            "p",
            { className: "muted" },
            "No quests are currently available here. Complete the previous chapter first.",
          )
        : null,
    ),
  );
}

export function LootModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const s = getState();
  const pile = getUi().lootPile;
  return h(
    ModalWindow,
    { id: "lootModal", title: "👜 Loot", screenLabel: "LOOT", visible },
    h(
      "div",
      { id: "lootText" },
      h("h3", null, pile?.name || "Loot"),
      h("p", null, `🪙 ${pile?.gold || 0} gold`),
      h(
        "p",
        null,
        (pile?.items || []).length
          ? (pile.items || []).map((item: any, index: number) =>
              h(
                "span",
                { key: index, style: { display: "block" } },
                `${s?.catalog?.items?.[item.itemId]?.icon || "📦"} ${s?.catalog?.items?.[item.itemId]?.name || item.itemId} ×${item.qty}`,
              ),
            )
          : "No extra items",
      ),
    ),
  );
}

export function LevelUpModal({ visible }: { visible: boolean }) {
  useUiVersion();
  const data = getUi().levelUp || {};
  const levels = data.levels || [];
  return h(
    "div",
    {
      id: "levelUpModal",
      className: `modal${visible ? "" : " hidden"}`,
      "aria-hidden": visible ? "false" : "true",
    },
    h(
      "div",
      { className: "modal-card level-up-card" },
      h("div", { className: "level-up-glow" }, "✦"),
      h("div", { className: "eyebrow" }, "CHARACTER PROGRESSION"),
      h(
        "h1",
        { id: "levelUpTitle" },
        levels.length > 1
          ? `Levels ${levels[0]}–${levels[levels.length - 1]}!`
          : `Level ${levels[0] || 1}!`,
      ),
      h(
        "div",
        { id: "levelUpSummary" },
        data.summary ||
          "Your character has reached a new stage of progression.",
      ),
      h(
        "div",
        { id: "levelUpRewards", className: "level-up-rewards" },
        (data.rewards || []).map((reward: any, index: number) =>
          h(
            "div",
            { className: "reward", key: index },
            h("b", null, reward.title),
            h("span", null, reward.detail),
          ),
        ),
      ),
      h(
        "button",
        {
          className: "primary wide",
          "data-action": "close-modal",
          "data-modal": "levelUpModal",
        },
        "Continue",
      ),
    ),
  );
}
