export function dynamicItemsForPlayer(
  player: any,
  items: Record<string, any>,
  lootPiles: Iterable<any> = [],
): Record<string, any> {
  const ids = new Set<string>();
  for (const entry of player.inventory || [])
    if (entry?.itemId) ids.add(entry.itemId);
  for (const id of Object.values(player.equipment || {}))
    if (id) ids.add(String(id));
  for (const roll of player.pendingLootRolls || [])
    if (roll?.itemId) ids.add(roll.itemId);
  for (const pile of lootPiles) {
    if (!pile?.eligible?.includes(player.id)) continue;
    for (const item of pile.items || []) if (item?.itemId) ids.add(item.itemId);
  }
  const result: Record<string, any> = {};
  for (const id of ids) {
    const item = items[id];
    if (item?.generated) result[id] = item;
  }
  return result;
}
