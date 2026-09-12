export function formatDistance(mm: number): string {
  if (!mm) return "—";
  const meters = mm / 1000;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
}

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

export function formatTinybars(value: number): string {
  if (!value) return "—";
  const hbar = value / 100_000_000;
  if (hbar < 0.001) return `${value.toLocaleString()} tinybar`;
  return `${hbar.toFixed(4)} HBAR`;
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
