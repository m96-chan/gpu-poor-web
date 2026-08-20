#!/usr/bin/env node
// The `npm run bench` launcher: real Chrome (Playwright, channel 'chrome',
// headless) navigated to a locally-served page, gathers real conditions
// from the running browser, runs a pluggable payload, and writes a
// src/measurement.ts-shaped result to bench/results/.
//
// See bench/README.md for *why* this launch configuration (real Chrome
// channel, headless, http://localhost, OPFS-not-FSA) — it is not guessed,
// it is what scratchpad/spike/FINDINGS.md measured to actually work on
// this machine.
//
// This file is intentionally an orchestrator only: argument parsing
// (src/bench/args.ts), interpreting the environment probe
// (src/bench/environment.ts), and assembling the output record
// (src/bench/report.ts) are pure, unit-tested modules under src/ — this
// file just wires real browser/filesystem calls to them. It is excluded
// from coverage (vitest.config.ts) because it needs a real browser to run
// honestly. Imports below use the repo's normal NodeNext ".js" specifiers
// (matching what those files are imported as everywhere else, e.g. from
// their own *.test.ts); bench/ts-loader.mjs (registered by the "bench" npm
// script, see package.json and bench/README.md) is what lets Node resolve
// those specifiers to the actual *.ts files with no build step and no
// added runtime dependency beyond Playwright.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { parseArgs } from "../src/bench/args.js";
import { buildEnvironmentExtras, parseBrowserVersion, requireGpu, toGpuAdapterInfo } from "../src/bench/environment.js";
import { buildBenchOutput } from "../src/bench/report.js";
import { summarizeTrials } from "../src/measurement.js";

import { ENVIRONMENT_PROBE_SRC } from "./environment-probe.mjs";
import { startServer } from "./server.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Flags the E1 spike found necessary/worthwhile for real Chrome
// (FINDINGS.md §1): `--enable-unsafe-webgpu` costs nothing on real Chrome
// (only Playwright's bundled Chromium strictly needs it) and keeps this
// working if CI ever runs against a different channel;
// `--enable-webgpu-developer-features` is required to get non-blank
// `adapter.device`/`adapter.description` (vendor/architecture are present
// either way).
const CHROME_FLAGS = ["--enable-unsafe-webgpu", "--enable-webgpu-developer-features"];

async function loadPayload(name) {
  const path = join(REPO_ROOT, "bench", "payloads", `${name}.mjs`);
  try {
    return await import(path);
  } catch (e) {
    throw new Error(`bench: could not load payload "${name}" from ${path}: ${(e && e.message) || e}`);
  }
}

async function defaultOutFile() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(REPO_ROOT, "bench", "results", `${timestamp}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const server = await startServer(args.port);
  let browser;
  try {
    browser = await chromium.launch({ headless: args.headless, channel: "chrome", args: CHROME_FLAGS });
    const page = await browser.newPage();
    await page.goto(server.url);

    const probe = await page.evaluate(ENVIRONMENT_PROBE_SRC);

    const gpu = toGpuAdapterInfo(probe);
    // Fails loudly here, before ever running the payload, rather than
    // letting a GPU-dependent payload quietly report zeros (issue #1).
    requireGpu(gpu);

    const browserInfo = {
      ...parseBrowserVersion(probe.userAgent),
      userAgent: probe.userAgent,
    };
    const environment = buildEnvironmentExtras(probe);

    const payload = await loadPayload(args.payload);
    const payloadResult = await page.evaluate(payload.runPayload, {
      fileSizeBytes: args.fileSizeBytes,
      chunkSizeBytes: args.chunkSizeBytes,
      trialCount: args.trials,
    });

    const output = buildBenchOutput({
      label: payload.PAYLOAD_LABEL,
      unit: payload.PAYLOAD_UNIT,
      trials: payloadResult.trials,
      browser: browserInfo,
      gpu,
      storage: payload.PAYLOAD_STORAGE,
      fileSizeBytes: args.fileSizeBytes,
      chunkSizeBytes: args.chunkSizeBytes,
      environment,
    });

    const outFile = args.outFile ?? (await defaultOutFile());
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(output, null, 2) + "\n", "utf8");

    const summary = summarizeTrials(output.measurement.trials);
    console.log(`\n${output.measurement.label}`);
    console.log(
      `  median ${summary.median.toFixed(3)} ${output.measurement.unit}` +
        `  (min ${summary.min.toFixed(3)}, max ${summary.max.toFixed(3)}, n=${summary.count})`,
    );
    console.log(`  browser: ${browserInfo.name} ${browserInfo.version}`);
    console.log(`  gpu: ${gpu.available ? `${gpu.vendor} / ${gpu.architecture} / ${gpu.description}` : "unavailable"}`);
    console.log(`  wrote ${outFile}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.close();
  }
}

main().catch((err) => {
  console.error(`\nbench failed: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
