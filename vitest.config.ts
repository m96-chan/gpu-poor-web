import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",

        // `bench/` (owned by a separate ticket) is the measurement harness
        // CLAUDE.md rule 1 exempts explicitly: its numbers are only
        // meaningful when run against real storage/GPU hardware in a real
        // browser, so a coverage run on this machine's CI (headless, no
        // adapter) cannot exercise it honestly. Forcing coverage on it
        // would only reward writing it in a way that's easy to fake-run
        // in Node, which is the opposite of what this repo needs.
        "bench/**",

        // `src/env/**` (owned by a separate ticket) is where the
        // `navigator.gpu` / File System Access / OPFS adapters live per
        // the "inject everything through interfaces" rule in CLAUDE.md's
        // architecture principles. Those adapters are thin wrappers whose
        // entire job is to call a real browser API; unit-testing them
        // would mean mocking the browser API and asserting the mock was
        // called, which proves nothing about real behavior. The
        // *interfaces* they implement (in src/, not src/env/) are pure
        // and stay covered; only the concrete browser-calling
        // implementations are excluded here.
        "src/env/**",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
