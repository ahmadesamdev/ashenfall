export class ClientPresentationUtils {
  constructor(private readonly getState: () => any) {}
  escapeHtml(value: any) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c: string) =>
        (
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }) as Record<string, string>
        )[c],
    );
  }
  pct(a: number, b: number) {
    return b ? Math.max(0, Math.min(100, (a / b) * 100)) + "%" : "0%";
  }
  skillTip(a: any) {
    if (!a) return "Unknown ability.";
    const parts = [a.description || "Use this ability against your target."];
    const scaling =
      a.scaling === "spell" ? "Spell Power" : a.power ? "Attack" : "Utility";
    if (a.power)
      parts.push(`Damage: ${Number(a.power).toFixed(2)}× ${scaling}`);
    if (a.heal)
      parts.push(
        `Healing: ${(Number(a.heal) * 100).toFixed(0)}% of the target's maximum health`,
      );
    if (a.hot)
      parts.push(
        `HoT: ${(Number(a.hot.tickHeal || 0) * 100).toFixed(1)}% max health per second for ${Number(a.hot.duration || 0).toFixed(1)}s`,
      );
    const st = a.status || a.debuff;
    if (st) {
      const id = String(st.id || "").replace(/_/g, " "),
        dur = Number(st.duration || 0),
        dmg = Number(st.damage || 0),
        percent = Number(
          st.percent || st.damagePercent || st.weaponDamagePercent || 0,
        );
      if (percent)
        parts.push(
          `${id}: ${percent}% of weapon damage each second for ${dur}s`,
        );
      else if (dmg) parts.push(`${id}: ${dmg} damage per second for ${dur}s`);
      else if (dur) parts.push(`${id}: ${dur}s`);
    }
    if (a.stun) parts.push(`Control: ${Number(a.stun).toFixed(1)}s stun`);
    if (a.executeThreshold)
      parts.push(
        `Execute: +${Math.round((Number(a.executeMultiplier || 1) - 1) * 100)}% power below ${(Number(a.executeThreshold) * 100).toFixed(0)}% target health`,
      );
    if (a.aoe?.radius)
      parts.push(
        `Area: ${a.aoe.radius}m radius • ${a.aoe.center === "self" ? "hits every enemy inside the circle" : "area target"}`,
      );
    if (a.partyBuff)
      parts.push(
        `Party effect: ${Object.entries(a.partyBuff.modifiers || {})
          .map(([k, v]) => `${k} ${v}%`)
          .join(", ")} for ${a.partyBuff.duration || 0}s`,
      );
    const state = this.getState();
    parts.push(
      `${a.cost || 0} ${state?.player?.resourceName || "Resource"} • ${a.cooldown || 0}s cooldown • ${a.gcd || 0}s GCD • ${a.range || 0}m range`,
    );
    return `${a.name}: ${parts.join(" • ")}`;
  }
  roundedRectPath(
    ctx: any,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
