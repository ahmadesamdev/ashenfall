export function rollbackOwnedChanges(
  target: any,
  before: any,
  attempted: any,
): void {
  if (
    !target ||
    !before ||
    !attempted ||
    typeof target !== "object" ||
    typeof before !== "object" ||
    typeof attempted !== "object"
  )
    return;
  for (const key of new Set([
    ...Object.keys(before),
    ...Object.keys(attempted),
  ])) {
    const current = target[key],
      expected = attempted[key],
      original = before[key];
    const isPlain = (v: any) =>
      !!v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      (Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null);
    if (isPlain(current) && isPlain(expected) && isPlain(original)) {
      rollbackOwnedChanges(current, original, expected);
      continue;
    }
    let matches = false;
    try {
      matches = JSON.stringify(current) === JSON.stringify(expected);
    } catch {
      matches = current === expected;
    }
    if (!matches) continue;
    if (Object.prototype.hasOwnProperty.call(before, key))
      target[key] = original;
    else delete target[key];
  }
}
