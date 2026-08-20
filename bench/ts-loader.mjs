// A minimal Node module-resolution hook: when a relative "*.js" specifier
// fails to resolve (because, per this repo's NodeNext convention, the
// source file is actually "*.ts" — see tsconfig.json), retry as "*.ts".
//
// Why this exists: bench/run.mjs needs to import the pure, unit-tested
// logic in src/bench/*.ts and src/measurement.ts directly (no build step
// exists — tsconfig.build.json is noEmit, "no build script yet"). Node
// v24's built-in TypeScript support (process.features.typescript) strips
// types from a *.ts file you import directly, but it does NOT do the
// NodeNext ".js" -> ".ts" specifier remapping tsc does at typecheck time —
// confirmed empirically (a plain `import "./foo.js"` from a directly-run
// .ts/.mjs file throws ERR_MODULE_NOT_FOUND if only foo.ts exists on
// disk). This hook is the fix, and it is the only thing that makes
// `node bench/run.mjs` work without either (a) adding a TS runtime
// dependency (tsx/ts-node — out of scope: this ticket may only add the
// browser automation dependency) or (b) rewriting src/**/*.ts to use
// non-standard ".ts" import specifiers, which would break
// `npm run typecheck`'s NodeNext resolution for everyone else.
//
// Registered via bench/register-ts-loader.mjs (`node --import`); see
// bench/README.md.
import { extname } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND" && extname(specifier) === ".js") {
      const tsSpecifier = `${specifier.slice(0, -".js".length)}.ts`;
      return nextResolve(tsSpecifier, context);
    }
    throw err;
  }
}
