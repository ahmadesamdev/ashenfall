import * as React from "react";
import { ModalWindow } from "./ModalWindow.js";

type Item = { itemId: string; qty: number };

type ClientState = {
  player?: {
    inventory?: Item[];
    equipment?: Record<string, string>;
    itemCooldowns?: Record<string, number>;
  };
  catalog?: { items?: Record<string, any> };
};

function readState(): ClientState | null {
  return (window as any).__ashenfallClientState ?? null;
}

function itemTip(item: any): string {
  if (!item) return "Unknown item.";
  const lines = [String(item.name || "Unknown item.")];
  if (item.level) lines.push(`Required level: ${item.level}`);
  if (item.itemLevel || item.level)
    lines.push(`Item level: ${item.itemLevel || item.level}`);
  if (item.type) lines.push(`Type: ${String(item.type).replace(/_/g, " ")}`);
  if (item.power) lines.push(`Weapon Power: +${item.power}`);
  if (item.armor) lines.push(`Armor: +${item.armor}`);
  for (const affix of item.affixes || [])
    if (affix?.name) lines.push(String(affix.name));
  const description = String(item.description || "")
    .replace(/^Use this consumable for its listed effect\.\s*/i, "")
    .trim();
  if (description) lines.push(`Effect: ${description}`);
  if (item.setName) lines.push(`Set: ${item.setName}`);
  if (item.setBonusSummary) lines.push(`Set bonuses: ${item.setBonusSummary}`);
  if (Array.isArray(item.buildIds) && item.buildIds.length)
    lines.push(`Designed for: ${item.buildIds.join(", ")}`);
  if (item.uniqueGroup) lines.push(`Unique group: ${item.uniqueGroup}`);
  if (item.cooldown) lines.push(`Cooldown: ${item.cooldown}s`);
  return lines.join("\n");
}

function BagSlot({
  item,
  index,
  state,
}: {
  item: Item | null;
  index: number;
  state: ClientState;
}) {
  if (!item) {
    return React.createElement("div", {
      key: `empty-${index}`,
      className: "bag-row bag-slot empty-bag-slot",
      "data-drag-kind": "empty",
      "aria-hidden": "true",
    });
  }

  const catalogItem = state.catalog?.items?.[item.itemId] || {};
  const player = state.player || {};
  const equipped = Object.values(player.equipment || {}).some(
    (id) => id === item.itemId,
  );
  const cooldownUntil = Number(player.itemCooldowns?.[item.itemId] || 0);
  const cooldown = Math.max(0, cooldownUntil - Date.now());
  const rarityClass = `rarity-${String(catalogItem.rarity || "common")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")}`;
  const tip = itemTip(catalogItem);

  return React.createElement(
    "div",
    {
      key: item.itemId,
      className: `bag-row bag-slot ${rarityClass}`,
      "data-drag-kind": "item",
      "data-drag-id": item.itemId,
      "data-bag-item": item.itemId,
      "data-item-tip": item.itemId,
      "data-tip": tip,
      "data-item-type": catalogItem.type || "",
      "data-equipped": equipped ? "1" : "0",
    },
    React.createElement(
      "span",
      { className: "bag-icon" },
      catalogItem.icon || "📦",
    ),
    React.createElement(
      "span",
      { className: "bag-count" },
      item.qty > 1 ? item.qty : "",
    ),
    cooldown > 0
      ? React.createElement(
          "span",
          { className: "bag-cooldown" },
          Math.ceil(cooldown / 1000),
        )
      : null,
  );
}

function bagSignature(state: ClientState | null): string {
  const player = state?.player;
  const inventory = (player?.inventory || [])
    .filter((item) => Number(item?.qty || 0) > 0)
    .slice(0, 30);
  return JSON.stringify({
    inventory,
    equipment: player?.equipment || {},
    cooldowns: Object.fromEntries(
      inventory.map((item) => [
        item.itemId,
        Math.ceil(
          Math.max(
            0,
            Number(player?.itemCooldowns?.[item.itemId] || 0) - Date.now(),
          ) / 1000,
        ),
      ]),
    ),
  });
}

export function BagModal({ visible }: { visible: boolean }) {
  const [snapshot, setSnapshot] = React.useState(() => ({
    state: readState(),
    signature: bagSignature(readState()),
  }));

  React.useEffect(() => {
    const onUiState = () => {
      const nextState = readState();
      const nextSignature = bagSignature(nextState);
      setSnapshot((previous) =>
        previous.signature === nextSignature
          ? previous
          : { state: nextState, signature: nextSignature },
      );
    };
    window.addEventListener("ashenfall-ui-state", onUiState);
    return () => window.removeEventListener("ashenfall-ui-state", onUiState);
  }, []);

  const state = snapshot.state;
  const inventory = (state?.player?.inventory || [])
    .filter((item) => Number(item?.qty || 0) > 0)
    .slice(0, 30);
  const slots = Array.from(
    { length: 30 },
    (_, index) => inventory[index] || null,
  );

  return React.createElement(
    ModalWindow,
    {
      id: "bagModal",
      cardClassName: "bag-card",
      title: "🎒 Bag",
      screenLabel: "INVENTORY",
      visible,
    },
    React.createElement(
      "div",
      { id: "bagList", className: "bag-list" },
      slots.map((item, index) =>
        React.createElement(BagSlot, {
          key: item ? item.itemId : `empty-${index}`,
          item,
          index,
          state: state || {},
        }),
      ),
    ),
  );
}
