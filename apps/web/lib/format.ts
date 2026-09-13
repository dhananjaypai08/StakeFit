export function formatDistance(mm: number): string {
  if (!mm) return "—";
  const meters = mm / 1000;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min === 0) return `${rem}s`;
  return `${min}:${String(rem).padStart(2, "0")}`;
}

/** Hedera's smallest HBAR unit. 1 HBAR = 100_000_000 tinybars. Never show "tinybar" in UI. */
export function formatTinybars(value: number): string {
  if (!value) return "—";
  const hbar = value / 100_000_000;
  if (hbar < 0.0001) return `${hbar.toFixed(8).replace(/0+$/, "0")} HBAR`;
  if (hbar < 1) return `${hbar.toFixed(4)} HBAR`;
  return `${hbar.toFixed(2)} HBAR`;
}

export function formatActivityName(displayName?: string, exerciseType?: string): string {
  const source = displayName?.trim() && !/^(UNKNOWN|OTHER)$/i.test(displayName.trim())
    ? displayName.trim()
    : exerciseType || "Workout";
  const spaced = source.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "Workout";
  if (!/[a-z]/.test(spaced)) {
    return spaced.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return spaced;
}
