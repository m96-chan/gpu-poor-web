# CLAUDE.md

Development rules that every agent / developer working in this repository must follow.

## Development rules

### 1. Practice TDD

- Write the test before the implementation (Red → Green → Refactor).
- Do not commit code without tests.
- **Coverage must be 90% or above** (statements / branches / functions / lines).
  The threshold is configured in `vitest.config.ts`; falling below it fails the test run.
- Do not write meaningless tests just to satisfy coverage. Verify behavior.
- Exception: measurement code that is only meaningful against a real GPU / real storage
  (benchmark harnesses) may be excluded from coverage. If you exclude it,
  **write the reason next to the code**.

### 2. Do not write code from guesswork — read the code

- Do not implement against an API or a behavior you assumed without reading the existing
  implementation, types, and tests.
- When an external library's behavior is unclear, check its type definitions, its documentation,
  and its actual output before using it.
- Do not open a PR on "this should probably work". Run it and confirm.
- In this repository in particular, **do not guess at WebGPU / File System Access / OPFS behavior**.
  Read the spec and `lib.dom.d.ts`, measure in a real browser, and only then write a conclusion.

### 3. Practice TiDD (ticket-driven development)

- **No implementation without an ISSUE.** Create the ISSUE before starting work.
- One ISSUE maps to one branch and one PR.
- If the spec changes or extra work surfaces mid-flight, update the ISSUE or cut a new one.
- Exception: the initial setup may be a single coarse-grained epic ticket.

### 4. Manage the ISSUE lifecycle

- Before starting: **create** the ISSUE (background / scope / out of scope / definition of done).
- While working: **update** the ISSUE with what you found and any change of direction.
- On completion: write `Closes #<issue number>` in the PR body and **let the merge close it**.
  As a rule, do not close ISSUEs by hand — so that nothing unimplemented gets closed.

### 5. Write commit messages in English

- Subject and body both in English. Use an imperative, present-tense subject (`Add …` / `Fix …`).
- Write **why** you made the change in the body. The diff already shows what changed.
- Do not rewrite commits already merged into `main`. Rewriting history requires a force-push,
  breaks existing clones, and invalidates commit links already referenced from ISSUEs.
  That is not a price worth paying merely to make message languages consistent.
- ISSUE / PR bodies are out of scope for this rule (currently a mix of Japanese and English).

### 6. Update the CHANGELOG in the same PR

- A PR containing user-observable changes (new API / breaking change / behavior change / bug fix)
  adds an entry under `Unreleased` in `CHANGELOG.md`.
- Do not write it all up at release time. Write it **while the reason for the change is fresh**.
  Reconstructing it later from the diff only restates what changed.
- When cutting a release, turn `Unreleased` into a version heading.
- Internal refactors, test-only changes, and docs-only changes are out of scope.

### 7. Record measurements together with their conditions

- This is a research repository; the primary artifact is **measured numbers**.
- Do not write "fast" or "slow". Attach GB/s, s/token, the number of trials, browser and version,
  GPU / storage model, and file size.
- A number without its conditions cannot be reproduced, so it does not count as a result.
- Record refuted hypotheses in the same format. **Do not delete dead branches** —
  so that the same road is not walked twice.

## Commands

No build setup exists yet (#1 creates it). Once it does, use:

```bash
npm install          # install dependencies
npm test             # run tests (with the 90% coverage threshold)
npm run test:watch   # watch mode
npm run typecheck    # type check
npm run bench        # run the measurement harness in a real browser
```

## Architecture principles

- **Never depend directly** on browser APIs (`navigator.gpu` / File System Access / OPFS).
  Inject everything through interfaces so tests can substitute them.
- Hide the source of weights behind a `WeightSource` abstraction (FSA / OPFS / HTTP Range / memory),
  so that comparing streaming strategies is just a matter of swapping the implementation.
- Do not carry our own compute kernels; depend on
  [web-xpu-ops](https://github.com/m96-chan/web-xpu-ops).
  This repository's responsibility is **an execution scheduler whose weights are not resident**,
  not a reimplementation of WGSL.
- Extract side-effect-free logic (layout computation / scheduling / LRU) as pure functions and
  unit-test it. Always keep it in separate files from code that touches the GPU.
