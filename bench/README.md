# bench — the real-browser measurement harness

`npm run bench` launches a real browser, measures real conditions from it, runs a
payload, and writes a `src/measurement.ts`-shaped result to `bench/results/`.

This exists to satisfy issue #1's definition of done: *"`npm run bench` runs in a
REAL browser and emits JSON carrying the machine's identity."* It deliberately ships
with a **trivial smoke payload**, not the real E1 bandwidth experiment — that's
issue #2, dropped into `bench/payloads/` without touching the launcher (see
"Adding a payload" below).

## Why this launch configuration

Everything below was **measured**, not assumed — see
`scratchpad/spike/FINDINGS.md` (the E1 de-risking spike) for the full evidence.
Summary of what it found and what this harness does about it:

- **Real Chrome (`channel: 'chrome'`), not Playwright's bundled Chromium.**
  Real Chrome needed zero WebGPU flags; bundled Chromium needs
  `--enable-unsafe-webgpu` or `requestAdapter()` returns `null`. Using the real,
  shipping browser also means bandwidth numbers generalize to what an actual user's
  Chrome would see.
- **Headless.** No observed difference from headed for WebGPU adapter, limits, or
  compute correctness on this machine, and headless is what CI will actually run —
  see the "Headless in CI" note below for the one real caveat this introduces.
- **Served over `http://localhost:<port>`, never `file://`.** Two independent,
  measured reasons:
  - `navigator.gpu` is `undefined` on a fresh, unserved page (not a secure
    context) until you navigate to something served.
  - `navigator.storage.getDirectory()` (OPFS) throws `SecurityError` on `file://`.
    `http://localhost` needs no TLS — Chrome treats `localhost` as a "potentially
    trustworthy origin".

  `bench/server.mjs` is a ~30-line hand-rolled `http.createServer` (no `serve`/
  `http-server` dependency) that only ever returns one static HTML shell; every
  payload runs via `page.evaluate()` (a function is serialized from Node and
  executed in-page), so nothing needs to be served from disk beyond that shell.
- **OPFS, never File System Access (`showOpenFilePicker`).** The spike tried every
  automation angle it could find (real synthetic click, with/without Playwright's
  file-chooser interception, headed vs. headless, direct CDP `Browser.setPermission`)
  and confirmed FSA cannot be driven from an automated script: it either
  self-aborts or opens a real native OS dialog that blocks forever waiting for a
  human. This is expected, spec-mandated behavior (FSA requires transient user
  activation), not a bug to work around. **`WeightSource` implementations for FSA
  may still exist** (see `src/weights/`) for real interactive/manual use — they are
  just not what this automated harness measures.

### Headless in CI

Headless Chrome's UA string reports a masked version (e.g.
`HeadlessChrome/151.0.0.0` instead of the real `151.0.7922.138`), and
`navigator.hardwareConcurrency` was observed returning `8` on a 10-core machine —
both are Chrome's own headless/automation privacy reductions, not bugs in this
harness. They're recorded faithfully in the output JSON (`conditions.browser.version`,
`environment.cpuCoreCount`) exactly as the browser reports them — this harness
never guesses a "real" value behind what the browser exposes.

## Running it

```bash
npm run bench                          # 3 trials, 256 MiB payload, smoke payload, headless
npm run bench -- --trials=10           # more trials
npm run bench -- --size=64m --chunk=8m # smaller payload / chunk size
npm run bench -- --headed              # watch it run in a real window
npm run bench -- --out=/tmp/result.json
npm run bench -- --payload=smoke       # select a payload by name (bench/payloads/<name>.mjs)
```

Flags are parsed by `src/bench/args.ts` (unit-tested; see `src/bench/args.test.ts`).
Byte sizes accept a `k`/`m`/`g` suffix (binary multiples) or a bare integer.

Output is written to `bench/results/<ISO-timestamp>.json` by default (gitignored —
see `.gitignore`'s comment: raw runs are data, not source, until a curation step
promotes a result into `CHANGELOG.md`/`README.md`).

If WebGPU is unavailable in the launched browser, `npm run bench` **fails loudly**
(non-zero exit, an error naming the reason — e.g. `requestAdapter() returned null`)
instead of writing a result with zeroed-out trials. See `src/bench/environment.ts`'s
`requireGpu()`.

## Output shape

```jsonc
{
  "measurement": { /* exactly src/measurement.ts's Measurement<number> */ },
  "environment": {
    "platform": "...",        // navigator.platform
    "cpuCoreCount": 8,        // navigator.hardwareConcurrency
    "storageQuotaBytes": ..., // navigator.storage.estimate().quota, or null
    "gpuLimits": { "maxBufferSize": ..., "maxStorageBufferBindingSize": ..., ... }
  }
}
```

`measurement` conforms exactly to `src/measurement.ts`'s `Measurement<number>` —
that's the "result JSON must use the record type from src/measurement.ts"
requirement from issue #1, and it's built through `createMeasurement()` (the only
sanctioned constructor), so its own runtime validation (trial count matches
conditions, positive file/chunk sizes, non-empty trials) always runs.

`environment` carries machine-identity facts issue #1 also asks this harness to
capture (platform, CPU core count, storage quota estimate, GPU device limits) that
aren't part of `Conditions` today — that type is owned by a different ticket
(`src/measurement.ts`), and this ticket's scope is `bench/` plus wiring
`package.json`'s bench script, not extending that record format. If a future issue
wants `platform`/`cpuCoreCount`/`gpuLimits` folded into `Conditions` itself, this is
where the field list to fold in lives.

## Adding a payload

A payload is a `.mjs` module in `bench/payloads/` exporting:

```js
export const PAYLOAD_LABEL = "human-readable label for the Measurement";
export const PAYLOAD_UNIT = "GB/s"; // or "s/token", etc.
export const PAYLOAD_STORAGE = "opfs"; // a StorageKind from src/measurement.ts

// Runs INSIDE the browser page via page.evaluate(runPayload, params) — only
// in-page globals are available (navigator, GPUBufferUsage, performance, ...),
// no Node scope, no imports.
export async function runPayload({ fileSizeBytes, chunkSizeBytes, trialCount }) {
  // ... return { trials: [/* trialCount raw numbers */] };
}
```

Select it with `--payload=<name>` (default `smoke`). `bench/run.mjs` does not need
to change — it loads `bench/payloads/${name}.mjs` dynamically and reads exactly
those four exports. This is how issue #2's real E1 experiment is meant to land.

## Architecture

- `bench/run.mjs` — the orchestrator: parses args, starts the server, launches
  Playwright, gathers conditions, requires WebGPU, runs the selected payload,
  writes the result. Excluded from coverage (`vitest.config.ts`) because it needs a
  real browser to run honestly.
- `bench/server.mjs` — the static server.
- `bench/environment-probe.mjs` — the in-page function that reads
  `navigator.gpu`/`navigator.storage`/`navigator.hardwareConcurrency` etc. and
  hands back plain JSON. Also excluded from coverage for the same reason.
- `bench/payloads/smoke.mjs` — this issue's trivial payload (OPFS write → OPFS
  read → `GPUQueue.writeBuffer`, byte-correctness verified every trial).
- `src/bench/args.ts`, `src/bench/environment.ts`, `src/bench/report.ts` — all the
  *pure* logic pulled out of the above (argument parsing, interpreting the raw
  probe into `GpuAdapterInfo`/`EnvironmentExtras`, assembling the final
  `Measurement`+`environment` output). These live under `src/`, are unit-tested,
  and count toward the repository's 90% coverage threshold — per CLAUDE.md's
  "extract side-effect-free logic ... and unit-test it" architecture principle.
- `bench/ts-loader.mjs` / `bench/register-ts-loader.mjs` — a small Node
  module-resolution hook (`node --import`) that lets `bench/run.mjs` import
  `src/bench/*.ts` and `src/measurement.ts` using this repo's normal NodeNext
  `"./foo.js"` specifiers, with no build step and no dependency beyond Playwright.
  See the comment at the top of `bench/ts-loader.mjs` for why this is necessary
  (Node's native TypeScript support strips types but does not do NodeNext's
  `.js` → `.ts` specifier remapping on its own).

## Known limitations (see FINDINGS.md for the full picture)

- The smoke payload's numbers are exactly that — a smoke check that the pipeline
  works end-to-end, byte-correct, with real conditions attached. They are **not**
  the E1 bandwidth result (issue #2). The spike's own 3-trial run of this same
  shape showed roughly 50% trial-to-trial spread on the GPU-write leg; treat any
  single `npm run bench` run the same way until #2 adds proper statistical rigor
  (more trials, cache-state control).
- `createSyncAccessHandle` (the Worker-thread OPFS sync API, possibly faster than
  the main-thread `createWritable`/`getFile` path used here) was not evaluated —
  flagged in FINDINGS.md as an open question for #2.
- This harness has only been run against `http://localhost`. Non-localhost HTTP
  origins (e.g. a LAN-reachable CI runner) were not tested for secure-context
  behavior — untested, likely needs HTTPS or
  `--unsafely-treat-insecure-origin-as-secure`.
