# Measurement Protocol

This document operationalizes CLAUDE.md rule 7: "record measurements together with their conditions." Every result this repository produces must follow this protocol so that numbers taken months apart remain comparable and reproducible.

## Required Conditions

Every measurement must capture these fields. A number missing any of them is not a result and cannot be acted on.

### Browser (`browser`)
- **name**: exact browser name (e.g., "Chrome", "Firefox", "Safari")
- **version**: version string as reported by the browser (e.g., "128.0.6613.137")
- **userAgent**: full `navigator.userAgent` string

**Why this matters**: Browser versions ship with different WebGPU implementations, File System Access behavior, and OPFS stability. A measurement taken in Chrome 128 may not hold in Chrome 129. Without the version, you cannot know whether a performance change is real or a browser regression.

### GPU (`gpu`)
A discriminated union: either full adapter info or an explicit statement that no GPU was involved.

**If GPU was used** (`available: true`):
- **vendor**: e.g., "apple", "nvidia", "intel"
- **architecture**: e.g., "metal-3", "ampere", "xe"
- **device**: specific GPU model or blank if not available
- **description**: human-readable name (e.g., "Apple M3")

**If no GPU was involved** (`available: false`):
- **reason**: why GPU was not involved (e.g., "storage-only measurement, no WebGPU calls made")

**Why this matters**: GPU capabilities vary wildly. A 3GB unified-memory M3 will show different bottlenecks than a 24GB discrete RTX 4090. Storage bandwidth to GPU depends on the interconnect (PCIe lanes, unified memory, etc.). Without this, you cannot tell whether your optimization worked or you just changed which machine it ran on.

### Storage (`storage`)
One of: `"opfs"`, `"file-system-access"`, `"http-range"`, `"memory"`.

**Why this matters**: Each storage source has different latency characteristics, caching behavior, and throughput. OPFS is memory-mapped by the browser, File System Access goes through system calls, HTTP Range may trigger server-side seeks. The storage source is the measurement itself — you must record it.

### File size and chunk size (`fileSizeBytes`, `chunkSizeBytes`)
Both strictly positive integers. Units: bytes.

- **fileSizeBytes**: total size of the test file or buffer
- **chunkSizeBytes**: size of each read operation in the measurement

**Why this matters**: Throughput depends on request size. Reading 1 MB at a time is not the same as reading 100 KB at a time, especially with syscall overhead. Storage bandwidth also bottlenecks differently depending on whether the file fits in OS page cache or not. Without these, you cannot reproduce the workload.

### Trial count (`trialCount`)
Positive integer. The number of times the measurement was repeated.

**Why this matters**: This field is a contract — `trialCount` must equal the actual length of the `trials` array. If you say trialCount=5 but only provide 3 trials, `createMeasurement()` rejects it at runtime and fails type-check if someone removes the validation.

---

## Trial count and warm-up

**Minimum: 3 trials.** A single trial could be an outlier. Two trials cannot give you a median.

**Recommended: 5–10 trials for storage measurements.** More is not always better — if you are watching the page cache problem below, adding more trials will eventually fill the cache and all later trials will be artifactually fast. Three trials is the honest minimum to surface variability; more than 10 typically adds noise on macOS without adding signal.

**Warm-up**: Run 1–2 measurements before the trials you record. Discard them. Do not include them in your trials array.
- This lets the browser initialize WebGPU resources, warm filesystem caches, and stabilize.
- However, see the page cache section below: warm-up is **not** a substitute for understanding what the cache did.

---

## The page cache: your biggest adversary on macOS

On macOS (and Linux), the filesystem caches recently-read data in RAM. A file read twice will read from memory the second time, not storage. This is invisible to your code — both read operations report completion times as if storage were accessed.

**Consequence**: If you are measuring storage-bandwidth throughput for E1 (the bandwidth denominator for all downstream calculations), a page-cache-warm read will report memory bandwidth (tens of GB/s) while claiming to be storage bandwidth. This silently invalidates the entire E1 experiment and everything built on it.

### Detecting page cache effects

**The honest test**: Clear the page cache between trials.

On macOS:
```bash
# Flush the filesystem cache before each trial (requires sudo; add to your measurement harness or document it in the run script)
sudo purge
```

If you measure without purging, you will see:
- Trial 1: ~2–4 GB/s (first time, cache cold)
- Trial 2: ~30–50 GB/s (file is now in page cache, memory speed)
- Trial 3: ~30–50 GB/s (still in cache)

**This distribution is the page cache at work.** The reported median will be the wrong number entirely, and you will not catch it without showing the min/max/count.

### Defeating page cache effects

**Option A (preferred): Clear between trials** — run `sudo purge` before each trial. Document this as a prerequisite in your measurement harness.

**Option B (if automation is blocked)**: Accept the cache and measure carefully.
- Run only 1 trial per test run (so the cache state is always the same — empty or populated from the previous test).
- Run the full test suite multiple times, observing the spread.
- Report the min/max/count explicitly in results.
- Note in your conditions that "page cache was not purged" so a future reader knows to expect this pattern.

**Option C (cold-cache only)**: Unmount and remount the filesystem between trials, or restart the browser process. This is the gold standard but rarely automatable.

### Why median-over-mean matters here

Storage-bandwidth trials are not normally distributed. They are drawn from a heavy-tailed distribution with multiple modes:
- Cold reads: ~2–4 GB/s (real storage)
- Warm reads: ~30–50 GB/s (page cache)
- Outliers during OS Spotlight indexing or other background I/O: ~500 MB/s (much slower)

A mean averages these modes together and hides which is which. A median + min/max + count shows all three at once:
- If median ≈ min, the cache is cold (good).
- If median ≈ max, the cache is warm (bad).
- If min is much smaller than median, you hit an outlier on one trial.

Always report median, min, max, and count. Never report mean alone. The whole point of this repository is to establish a floor, not a flattering average.

---

## Recording refuted hypotheses

Do not delete code or measurements from dead-end branches. Record them in the same format as successful results.

**Hypothetical example** — invented numbers, no such comparison has been run: suppose you
hypothesized that streaming weights via HTTP Range would be 2× faster than OPFS, measured it,
and found the opposite. You would record it like this:

```json
{
  "label": "EXAMPLE-ONLY illustration, not a measurement: http-range vs opfs (hypothesis: http-range faster)",
  "unit": "GB/s",
  "conditions": {
    "browser": { "name": "Chrome", "version": "EXAMPLE-0.0.0.0", "userAgent": "..." },
    "gpu": { "available": false, "reason": "storage-only measurement" },
    "storage": "http-range",
    "fileSizeBytes": 1_000_000_000,
    "chunkSizeBytes": 4_194_304,
    "trialCount": 5
  },
  "trials": [1.8, 1.9, 1.7, 1.8, 1.9],
  "timestamp": "2026-08-21T14:32:10.000Z"
}
```

Then in a separate record, capture the OPFS result for the same conditions so the comparison is clear in the data. Include a comment or separate metadata field noting the hypothesis and outcome.

This keeps the experiment log honest. Next year, when someone asks "why didn't we use HTTP Range?", the answer is in the data.

---

## Worked example

> **Every number below is INVENTED, for illustrating the shape of a record only.**
> E1 (#2) has not been run. This repository has no storage-bandwidth result yet, and
> nothing here may be cited as one. The only real numbers taken so far are a 3-trial
> smoke measurement recorded in the E1 de-risking spike, and they are explicitly not
> a result either. Placeholder fields are written as `EXAMPLE-*` so that a copied
> record cannot silently pass itself off as measured.

```json
{
  "label": "EXAMPLE-ONLY illustration, not a measurement: opfs sequential read (cache cold)",
  "unit": "GB/s",
  "conditions": {
    "browser": {
      "name": "Chrome",
      "version": "EXAMPLE-0.0.0.0",
      "userAgent": "EXAMPLE-ONLY placeholder; the real harness copies navigator.userAgent verbatim"
    },
    "gpu": {
      "available": false,
      "reason": "storage-only measurement; no WebGPU calls made (E1 is throughput, not yet GPU integration)"
    },
    "storage": "opfs",
    "fileSizeBytes": 1_000_000_000,
    "chunkSizeBytes": 4_194_304,
    "trialCount": 5
  },
  "trials": [2.1, 2.4, 2.2, 2.3, 2.2],
  "timestamp": "2026-08-21T14:32:10.000Z"
}
```

Again: those five trial values were made up to show what a tight cold-cache spread looks
like. They are not this machine's OPFS throughput and no one has measured that yet.

Breaking this down:

- **label**: Concise description, including the key variable (cache cold? GPU? model?).
- **unit**: "GB/s" so anyone reading trials=[2.1, 2.4, ...] immediately knows the unit.
- **conditions**: Every field filled in, no guessing.
  - Browser: exact version and user agent, copied from `navigator.userAgent` or logged by Puppeteer at measurement time.
  - GPU: explicitly marked `available: false` with the reason, not omitted.
  - Storage: "opfs" — OPFS is memory-mapped by the browser, so it's the most "browser-native" starting point.
  - Files: 1 GB test file, 4 MB chunks (4194304 bytes = 4 × 1024²). These are placeholders; pick sizes that match your LLM weights and realistic streaming patterns.
  - trialCount: 5, matching the length of the trials array.
- **trials**: Five values, cache-cold reads. Notice the median is 2.2 GB/s, between min (2.1) and max (2.4), with consistent spread — this is what a cold cache looks like.
- **timestamp**: ISO 8601, so git diffs and sorting are unambiguous.

### Anatomy of a bad record (what not to do)

```json
{
  "label": "opfs read fast",
  "unit": "GB/s",
  "conditions": { "fileSizeBytes": 1000000000 },
  "trials": [15.2]
}
```

Problems:
- Label is vague ("fast" tells you nothing).
- Missing browser, GPU, storage kind.
- Missing chunkSizeBytes, trialCount.
- Only 1 trial (no median, no spread to show instability).
- 15.2 GB/s on macOS is almost certainly a page-cache hit, but there's no way to know because GPU and storage conditions are missing.
- This record cannot be reproduced and cannot be acted on.

---

## Storing results

All result records (JSON files, one per measurement or series of measurements) live in `docs/results/`. Organize by experiment:

```
docs/results/
  e1-storage-bandwidth/
    opfs-chrome-128-2026-08-21.json
    file-system-access-firefox-128-2026-08-21.json
    ...
  e2-layer-paging-skeleton/
    ...
```

Each filename should include enough context to find it without opening the file: experiment, storage method, browser, date. Use ISO 8601 dates (YYYY-MM-DD) so sorting by filename gives chronological order.

Commit these files to git. Do not delete them even if they are outdated or disproven — they are part of the experiment log.
