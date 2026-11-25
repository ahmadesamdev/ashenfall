const BUYBACK_WINDOW_MS = 30 * 60 * 1000;

function addId(target: Set<string>, value: unknown) {
  if (typeof value === "string" && value.length > 0) target.add(value);
}

function addItemRows(target: Set<string>, rows: unknown) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (row && typeof row === "object") addId(target, (row as any).itemId);
  }
}

function playerItemReferences(player: any, now: number): Set<string> {
  const refs = new Set<string>();
  if (!player || typeof player !== "object") return refs;
  addItemRows(refs, player.inventory);
  for (const id of Object.values(player.equipment || {})) addId(refs, id);
  for (const roll of Array.isArray(player.pendingLootRolls)
    ? player.pendingLootRolls
    : []) {
    addId(refs, roll?.itemId);
    addId(refs, roll?.baseItemId);
  }
  for (const chest of Array.isArray(player.dungeonRewardChests)
    ? player.dungeonRewardChests
    : []) {
    addItemRows(refs, chest?.rewards?.items);
  }
  for (const sale of Array.isArray(player.recentSales)
    ? player.recentSales
    : []) {
    if (
      Number(sale?.qty || 0) > 0 &&
      Number(sale?.soldAt || 0) > now - BUYBACK_WINDOW_MS
    )
      addId(refs, sale?.itemId);
  }
  return refs;
}

function economyItemReferences(economy: any): Set<string> {
  const refs = new Set<string>();
  const auctions = economy?.auctions;
  const auctionRows =
    auctions instanceof Map
      ? [...auctions.values()]
      : Array.isArray(auctions)
        ? auctions
        : [];
  for (const auction of auctionRows) addId(refs, auction?.itemId);
  const mail = economy?.mail;
  const mailRows =
    mail instanceof Map
      ? [...mail.values()].flat()
      : mail && typeof mail === "object"
        ? Object.values(mail).flat()
        : [];
  for (const message of mailRows) addItemRows(refs, message?.payload?.items);
  return refs;
}

export function sweepGeneratedItemRegistry({
  players,
  items,
  economy,
  now = Date.now(),
}: any) {
  if (!items || typeof items !== "object")
    return {
      removedDefinitions: 0,
      prunedPlayerDefinitions: 0,
      changedPlayers: [],
    };
  const playerRows = Array.isArray(players)
    ? players
    : players instanceof Map
      ? [...players.values()]
      : [];
  const economyRefs = economyItemReferences(economy);
  const ownRefs = new Map<any, Set<string>>();
  const changedPlayers = new Set<any>();
  const onlineRefs = new Set<string>(economyRefs);

  for (const player of playerRows) {
    const refs = playerItemReferences(player, now);
    ownRefs.set(player, refs);
    if (player?.online) for (const id of refs) onlineRefs.add(id);
  }

  const knownDefinitions = new Map<string, any>();
  for (const [id, definition] of Object.entries(items))
    if ((definition as any)?.generated) knownDefinitions.set(id, definition);
  for (const player of playerRows)
    for (const [id, definition] of Object.entries(
      player?.generatedItems || {},
    )) {
      if ((definition as any)?.generated && !knownDefinitions.has(id))
        knownDefinitions.set(id, definition);
    }
  for (const id of onlineRefs)
    if (!items[id] && knownDefinitions.has(id))
      items[id] = knownDefinitions.get(id);

  for (const player of playerRows) {
    const refs = ownRefs.get(player) || new Set<string>();
    for (const id of refs) {
      const definition = items[id] || knownDefinitions.get(id);
      if (!definition?.generated || player.generatedItems?.[id]) continue;
      if (!player.generatedItems || typeof player.generatedItems !== "object")
        player.generatedItems = {};
      player.generatedItems[id] = definition;
      changedPlayers.add(player);
    }
  }

  let prunedPlayerDefinitions = 0;
  for (const player of playerRows) {
    const generated = player?.generatedItems;
    if (!generated || typeof generated !== "object") continue;
    const refs = ownRefs.get(player) || new Set<string>();
    for (const id of Object.keys(generated)) {
      if (!refs.has(id) && !economyRefs.has(id)) {
        delete generated[id];
        changedPlayers.add(player);
        prunedPlayerDefinitions++;
      }
    }
  }

  let removedDefinitions = 0;
  for (const [id, definition] of Object.entries(items)) {
    if ((definition as any)?.generated && !onlineRefs.has(id)) {
      delete items[id];
      removedDefinitions++;
    }
  }
  return {
    removedDefinitions,
    prunedPlayerDefinitions,
    changedPlayers: [...changedPlayers],
  };
}
