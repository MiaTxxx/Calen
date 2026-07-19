/** Cosmetic path display for UI: never surface the legacy LiveAgent data dir. */
const LEGACY_DATA_DIR = ".liveagent";
const CALEN_DATA_DIR = ".calen";

export function displayAppDataPath(path: string): string {
  if (!path) return path;
  return path.split(LEGACY_DATA_DIR).join(CALEN_DATA_DIR);
}
