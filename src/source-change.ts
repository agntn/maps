import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Newest ctime under `directory`, in milliseconds. Unlike mtime, nobody backdates it. */
export function lastSourceChange(directory: string): number {
  let newest = statSync(directory).ctimeMs;
  for (const entry of readdirSync(directory, { encoding: "utf8", recursive: true })) {
    const stats = statSync(join(directory, entry), { throwIfNoEntry: false });
    if (stats && stats.ctimeMs > newest) newest = stats.ctimeMs;
  }
  return newest;
}

/** Tells whether `directory` changed after `since`. A tree gone mid-scan counts too. */
export function sourceChangeCheck(directory: string, since: number): () => boolean {
  return () => {
    try {
      return lastSourceChange(directory) > since;
    } catch {
      return true;
    }
  };
}
