/**
 * Pure CLI-argument parsing for `bench/run.mjs`.
 *
 * This is the "argument parsing" module CLAUDE.md's "extract side-effect-free
 * logic and unit-test it" principle asks for: no `process.argv`, no
 * filesystem, no browser — just `string[] -> BenchArgs | throw`. `bench/`
 * itself is excluded from coverage (see vitest.config.ts) because it needs a
 * real browser to run honestly; this file exists specifically so the *logic*
 * inside the harness (as opposed to its browser/GPU/storage calls) still
 * gets tested and counted.
 */

/** Fully-resolved bench run configuration, after defaults are applied. */
export interface BenchArgs {
  /** Number of trials the selected payload should run. */
  readonly trials: number;
  /** Size in bytes of the payload's test file / buffer. */
  readonly fileSizeBytes: number;
  /** Size in bytes of each streaming chunk the payload writes/reads. */
  readonly chunkSizeBytes: number;
  /** Name of the payload module to load from `bench/payloads/<name>.mjs`. */
  readonly payload: string;
  /** Output JSON path. `undefined` means "let the launcher pick a default
   * timestamped path under bench/results/". */
  readonly outFile: string | undefined;
  /** Whether to launch the browser headless (default) or headed. */
  readonly headless: boolean;
  /** Port for the local static server. `0` means "let the OS pick a free
   * port", which is the default — avoids port collisions between runs. */
  readonly port: number;
}

/**
 * Defaults chosen from what the E1 spike (see the FINDINGS.md the launcher
 * README links to) proved this machine's WebGPU adapter allows, not
 * measured values: 256 MiB is `maxBufferSize` on the M3's Metal backend (the
 * largest single `GPUBuffer` it permits), and 16 MiB matches the chunk size
 * the spike's OPFS writer used. Both are overridable via `--size`/`--chunk`
 * for a different machine's limits.
 */
export const DEFAULT_BENCH_ARGS: BenchArgs = {
  trials: 3,
  fileSizeBytes: 256 * 1024 * 1024,
  chunkSizeBytes: 16 * 1024 * 1024,
  payload: "smoke",
  outFile: undefined,
  headless: true,
  port: 0,
};

const BYTE_SIZE_PATTERN = /^(-?\d+(?:\.\d+)?)([kmg]?)$/i;
const BINARY_MULTIPLIERS: Record<string, number> = {
  "": 1,
  k: 1024,
  m: 1024 * 1024,
  g: 1024 * 1024 * 1024,
};

/**
 * Parses a byte-size CLI value like `"1024"`, `"16k"`, `"256M"`, `"1G"` into
 * a positive integer number of bytes. Suffixes are binary multiples (1k =
 * 1024 bytes), case-insensitive.
 */
export function parseByteSize(raw: string): number {
  const match = BYTE_SIZE_PATTERN.exec(raw.trim());
  if (!match) {
    throw new Error(`invalid byte size: ${JSON.stringify(raw)} (expected e.g. "1024", "16k", "256M", "1G")`);
  }
  // `suffix`'s own group (`[kmg]?`) always matches — as "" when no letter
  // is present, never as `undefined` — so `digits`/`suffix` are always
  // plain strings here; every value `suffix.toLowerCase()` can produce is a
  // key in BINARY_MULTIPLIERS, so this is a direct lookup, not a guarded
  // "unknown suffix" branch (there is no reachable case to guard).
  const [, digits, suffix] = match as unknown as [string, string, string];
  const multiplier = BINARY_MULTIPLIERS[suffix.toLowerCase()] as number;
  const bytes = Number(digits) * multiplier;
  if (!(bytes > 0)) {
    throw new Error(`invalid byte size: ${JSON.stringify(raw)} must be positive, got ${bytes}`);
  }
  return bytes;
}

function parsePositiveInteger(raw: string, flagName: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${flagName} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseNonNegativeInteger(raw: string, flagName: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${flagName} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * Parses `bench/run.mjs`'s CLI arguments (e.g. `process.argv.slice(2)`) into
 * a `BenchArgs`. Unknown flags and malformed values throw with a message
 * naming the offending flag, rather than silently falling back to a
 * default — a mistyped `--trials` should not quietly turn into "3 trials".
 */
export function parseArgs(argv: readonly string[]): BenchArgs {
  let trials = DEFAULT_BENCH_ARGS.trials;
  let fileSizeBytes = DEFAULT_BENCH_ARGS.fileSizeBytes;
  let chunkSizeBytes = DEFAULT_BENCH_ARGS.chunkSizeBytes;
  let payload = DEFAULT_BENCH_ARGS.payload;
  let outFile = DEFAULT_BENCH_ARGS.outFile;
  let headless = DEFAULT_BENCH_ARGS.headless;
  let port = DEFAULT_BENCH_ARGS.port;

  for (const arg of argv) {
    if (arg === "--headed") {
      headless = false;
      continue;
    }

    const eq = arg.indexOf("=");
    if (!arg.startsWith("--") || eq === -1) {
      const flagName = arg.startsWith("--") ? arg.slice(2) : arg;
      throw new Error(`expected --${flagName}=<value>, got ${JSON.stringify(arg)}`);
    }
    const flag = arg.slice(2, eq);
    const value = arg.slice(eq + 1);

    switch (flag) {
      case "trials":
        trials = parsePositiveInteger(value, "trials");
        break;
      case "size":
        fileSizeBytes = parseByteSize(value);
        break;
      case "chunk":
        chunkSizeBytes = parseByteSize(value);
        break;
      case "payload":
        payload = value;
        break;
      case "out":
        outFile = value;
        break;
      case "port":
        port = parseNonNegativeInteger(value, "port");
        break;
      default:
        throw new Error(`unrecognized flag: --${flag}`);
    }
  }

  return { trials, fileSizeBytes, chunkSizeBytes, payload, outFile, headless, port };
}
