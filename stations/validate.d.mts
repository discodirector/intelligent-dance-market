// Types for validate.mjs (the registry rules shared by check-stations, the bot and the site).
export declare const SUPPORTED_CHAINS: string[];
export declare const KINDS: string[];
export declare const STATUSES: ("live" | "paused" | "pending" | "preview")[];
export declare function isDate(v: unknown): boolean;
export interface ValidateOptions {
  /** Whether a program other than "idm" has a pack (baked or runtime). Default: always. */
  packExists?: (program: string) => boolean;
}
export declare function chainsProblems(chains: unknown): string[];
export declare function stationProblems(s: unknown, chains: unknown, opts?: ValidateOptions): string[];
export declare function registryProblems(reg: unknown, opts?: ValidateOptions): string[];
export declare function mergeRegistry<R extends { chains: unknown; stations: S[] }, S>(
  baked: R,
  runtime: { stations?: unknown[] } | null | undefined,
  opts?: ValidateOptions,
): { registry: R; skipped: { key: string; reasons: string[] }[] };
