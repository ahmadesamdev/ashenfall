export function runtimeId(prefix: string): string {
  const clean =
    String(prefix || "id")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 32) || "id";
  return `${clean}_${globalThis.crypto.randomUUID()}`;
}
