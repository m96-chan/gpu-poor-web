# Changelog

All notable changes to this project are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This is a research repository — refuted hypotheses and dead branches are recorded here too,
not deleted, so the same road is not walked twice (see CLAUDE.md rule 7).

## Unreleased

### Added

- Base project scaffold (#1): TypeScript strict config, vitest with v8 coverage
  (90% statements/branches/functions/lines threshold), CI workflow running
  `npm ci` / `npm run typecheck` / `npm test` on `ubuntu-latest` / Node 24.
- `src/measurement.ts` — the measurement record format required by CLAUDE.md
  rule 7: a `Measurement<T>` cannot be constructed without its `Conditions`
  (browser + version, GPU/adapter, storage, file size, chunk size, trial
  count), and stores raw per-trial values rather than only a mean. Includes
  `summarizeTrials`, which reports median/min/max (not mean — see the
  in-code justification).
- `src/index.ts` — public entry point, currently re-exporting only the
  measurement types/helpers.
- Dependency on `web-xpu-ops@0.1.0` (ops only; the resident LLM engine and
  real-GPU harness in that repo are not published to npm and are out of
  scope until an upstream packaging decision — see the project briefing).
- `npm run bench` (#1): a real-browser measurement harness. Launches real
  Chrome (Playwright, `channel: 'chrome'`, headless) against a page served
  over `http://localhost` (OPFS and WebGPU both require a secure context —
  `file://` does not qualify, see `bench/README.md`), measures conditions
  live from the running browser (browser name/version, WebGPU adapter info
  and device limits, platform, CPU core count, storage quota estimate),
  runs a pluggable payload (`bench/payloads/`), and writes a
  `src/measurement.ts`-shaped `Measurement<number>` to
  `bench/results/<timestamp>.json`. Fails loudly (non-zero exit, named
  reason) if WebGPU is unavailable rather than reporting zeroed trials.
  Ships with a trivial OPFS-write → OPFS-read → `GPUQueue.writeBuffer`
  smoke payload for this issue; the real E1 bandwidth experiment is #2 and
  drops in as a new payload file without touching the launcher.
  Argument parsing, raw-probe interpretation, and result assembly are pure,
  unit-tested modules under `src/bench/`; only the browser/filesystem
  orchestration in `bench/` itself is excluded from coverage, per
  CLAUDE.md rule 1.
  Config informed by empirical findings recorded in the E1 de-risking
  spike (real Chrome needs no WebGPU flags where Playwright's bundled
  Chromium does; File System Access cannot be automated under any tried
  configuration, so this harness measures OPFS).
- `playwright@^1.62.1` added as a devDependency for the above.
- `src/weights/` (#1) — the `WeightSource` abstraction and four implementations
  (`InMemoryWeightSource`, `OpfsSyncWeightSource`, `FileSystemAccessWeightSource`,
  `HttpRangeWeightSource`). `read(destination, offset)` fills a **caller-supplied**
  buffer rather than returning a fresh `ArrayBuffer`: a source exists to serve the
  same large ranges once per layer per token, and allocating per call would add
  exactly the cost this repository is trying to measure. Each browser-backed source
  takes an already-obtained handle, so all offset arithmetic, chunk splitting and
  bounds behaviour is unit-tested in Node; only the thin factory that calls
  `showOpenFilePicker()` / `navigator.storage.getDirectory()` is excluded from
  coverage, with the reason inline.
- `docs/measurement-protocol.md` — how a number must be recorded to count as a
  result, including how the macOS page cache can turn a storage-bandwidth
  measurement into a memory-bandwidth measurement without anything appearing to
  go wrong.

### Refuted / closed off

- **File System Access cannot be automated**, so it cannot carry E1. Measured, not
  assumed: with no user gesture `showOpenFilePicker()` rejects; under Playwright's
  file-chooser interception Chrome aborts the call outright; headless with no
  interception it self-aborts in ~50 ms; headed it opens a real native macOS dialog
  that blocks forever on a human. `Browser.setPermission` has no
  `file-system-access` descriptor to grant. OPFS carries the automated measurement;
  FSA is reachable only from a manual smoke test.
