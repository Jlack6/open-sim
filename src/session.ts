/** Tracks the last app launched via MCP so UI tools work without repeating bundle IDs. */
let lastBundleId: string | undefined;

export function setLastBundleId(bundleId: string): void {
  lastBundleId = bundleId;
}

/**
 * Resolve which app UI commands should target.
 * Explicit bundleId > last launched app > undefined (driver uses home screen).
 */
export function resolveBundleId(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return lastBundleId;
}
