export const AUDIO_CUES = Object.freeze({
  ability_press: "placeholder://combat/ability-press",
  ability_cast: "placeholder://combat/ability-cast",
  ability_confirmed: "placeholder://combat/ability-confirmed",
  ability_rejected: "placeholder://combat/ability-rejected",
  ability_hit: "placeholder://combat/ability-hit",
  ability_crit: "placeholder://combat/ability-crit",
  ability_impact: "placeholder://combat/ability-impact",
  mob_alert: "placeholder://world/mob-alert",
  mob_reinforce: "placeholder://world/mob-reinforce",
  mob_flee: "placeholder://world/mob-flee",
  mob_investigate: "placeholder://world/mob-investigate",
});
export function emitAudioCue(cue: string, detail?: string) {
  const key = String(cue || "");
  const asset =
    (AUDIO_CUES as any)[key] || `placeholder://combat/${key || "unknown"}`;
  const event = {
    cue: key,
    asset,
    detail: detail ? String(detail) : "",
    at: Date.now(),
  };
  try {
    window.dispatchEvent(
      new CustomEvent("ashenfall:audio-cue", { detail: event }),
    );
  } catch {}
  const q = (window as any).__ashenfallAudioCues || [];
  q.push(event);
  (window as any).__ashenfallAudioCues = q.slice(-64);
}
