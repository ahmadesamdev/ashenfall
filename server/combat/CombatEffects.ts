import { runtimeId } from "../shared/Ids.js";

export function pushFx(
  p: any,
  type: any,
  source: any,
  target: any,
  abilityId: any = null,
  extra: any = {},
) {
  p.combatFx = p.combatFx || [];
  const now = Date.now();
  p.combatFx.push({
    id: runtimeId("fx"),
    type,
    source,
    target,
    abilityId,
    ...extra,
    at: now,
    expiresAt: now + Number(extra?.durationMs || 900),
  });
  if (p.combatFx.length > 16) p.combatFx.splice(0, p.combatFx.length - 16);
}
