export function normalizePlayerClassState(player: any, classes: any) {
  if (!player || !classes) return null;
  const cls =
    classes[player.classId] ||
    (Array.isArray(classes)
      ? classes.find((x: any) => String(x?.id) === String(player.classId))
      : null);
  if (!cls) return null;
  player.icon = cls.icon || player.icon;
  player.role = cls.role || player.role || "Adventurer";
  player.partyRole =
    cls.partyRole ||
    player.partyRole ||
    (["vanguard"].includes(cls.id)
      ? "Tank"
      : cls.id === "hierophant"
        ? "Healer"
        : cls.id === "warden"
          ? "Support"
          : "DPS");
  player.secondaryRole = cls.secondaryRole || player.secondaryRole || null;
  player.resourceName = cls.resource || player.resourceName || "Resolve";
  player.resourceIcon = cls.resourceIcon || player.resourceIcon || "🔥";
  player.resourceSpec = cls.resourceSpec || player.resourceSpec || null;
  if (Number(player.baseHp || 0) <= 0) player.baseHp = Number(cls.baseHp || 1);
  if (Number(player.baseAttack || 0) <= 0)
    player.baseAttack = Number(cls.baseAttack || 0);
  if (Number(player.baseArmor || 0) < 0)
    player.baseArmor = Number(cls.baseArmor || 0);
  if (Number(player.baseResolve || 0) <= 0)
    player.baseResolve = Number(cls.baseResolve || 0);
  const allowed = new Set(Array.isArray(cls.abilities) ? cls.abilities : []);
  const starter =
    Array.isArray(cls.startSkills) && cls.startSkills.length
      ? cls.startSkills
      : (cls.abilities || [])
          .filter((id: any) => Number((cls.abilityUnlocks || {})[id]) <= 1)
          .slice(0, 3);
  const existing = Array.isArray(player.abilityIds) ? player.abilityIds : [];
  const valid = existing.filter((id: any) => allowed.has(id));
  for (const id of starter) {
    if (valid.length >= 3) break;
    if (!valid.includes(id)) valid.push(id);
  }
  player.abilityIds = valid;
  player.learnedSkills = [
    ...new Set(
      (Array.isArray(player.learnedSkills) ? player.learnedSkills : [])
        .filter((id: any) => allowed.has(id))
        .concat(valid),
    ),
  ];
  player.knownAbilities = valid.slice();
  if (Number(player.maxHp || 0) <= 0) player.maxHp = Number(cls.baseHp || 1);
  if (Number(player.hp || 0) <= 0 && !player.dead) player.hp = player.maxHp;
  if (Number(player.maxResolve || 0) <= 0)
    player.maxResolve = Number(cls.baseResolve || 1);
  if (Number(player.resolve || 0) < 0) player.resolve = 0;
  return cls;
}
