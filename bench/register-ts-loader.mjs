// Installs bench/ts-loader.mjs via Node's module-customization API. Loaded
// with `node --import ./bench/register-ts-loader.mjs bench/run.mjs` (see
// the "bench" script in package.json) — `register()` must run from a
// module Node imports before the entry point, it cannot be called from
// within run.mjs itself.
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
