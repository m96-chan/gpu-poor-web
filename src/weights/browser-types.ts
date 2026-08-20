/**
 * Minimal structural ambient types for the browser Web APIs the
 * implementations in this directory wrap. `tsconfig.json`'s `lib` is
 * `["ES2022"]` only — no `"DOM"` — the same choice `web-xpu-ops`'s own
 * `idb-chunk-store.ts` and `storage-quota.ts` make and document, so that
 * code meant to run in a browser is checked against exactly the ambient
 * surface it will actually have (nothing Node-specific — see
 * `tsconfig.build.json`), and code meant to run in Node never silently
 * starts depending on a `lib.dom.d.ts` global Node doesn't provide.
 *
 * Every name here is prefixed `Minimal` so it can never collide with the
 * real `lib.dom.d.ts` declarations a consumer with `"DOM"` in its own `lib`
 * already has in scope (this package's own `examples`/demo consumers, were
 * any to exist, per `idb-chunk-store.ts`'s identical reasoning). These are
 * structurally compatible with the real Web API shapes — a real
 * `Blob`/`Response`/`FileSystemFileHandle`/`fetch` satisfies the
 * corresponding `Minimal*` type below with no cast — never nominally
 * related to them. Each type is checked, in its own doc comment, against
 * `node_modules/typescript/lib/lib.dom.d.ts` in this repository as it
 * exists today (TypeScript 5.9.3): read, not guessed, per CLAUDE.md rule 2.
 *
 * `MinimalFileSystemSyncAccessHandle` is the one exception: that
 * `lib.dom.d.ts` does not declare `FileSystemSyncAccessHandle` or
 * `FileSystemFileHandle.createSyncAccessHandle()` at all (grepped for both
 * — no match), so that type is hand-written from the File System Access
 * spec and MDN's documentation of it instead of cross-checked against
 * `lib.dom.d.ts`. Per CLAUDE.md rule 2 that makes it unverified against a
 * real browser; `opfs-sync-weight-source.ts` says so again at its actual
 * point of use, since that is the file whose correctness depends on it.
 */

/** Checked against `lib.dom.d.ts`'s `interface Blob`: `size: number`,
 * `slice(start?, end?, contentType?): Blob`, `arrayBuffer(): Promise<ArrayBuffer>`.
 * `File extends Blob` there with no change to these three members, so a
 * real `File` (what `FileSystemFileHandle.getFile()` actually resolves to)
 * satisfies this type unchanged. `contentType` is omitted here — nothing in
 * this package ever sets or reads a MIME type. */
export interface MinimalBlob {
  readonly size: number;
  slice(start?: number, end?: number): MinimalBlob;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Checked against `lib.dom.d.ts`'s `interface FileSystemFileHandle`:
 * `getFile(): Promise<File>`. */
export interface MinimalFileSystemFileHandle {
  getFile(): Promise<MinimalBlob>;
}

/** Checked against `lib.dom.d.ts`'s `interface FileSystemDirectoryHandle`:
 * `getFileHandle(name, options?): Promise<FileSystemFileHandle>`. `options`
 * (only ever `{ create?: boolean }` there) is omitted — this package never
 * creates OPFS files, only opens ones a producer step already wrote. */
export interface MinimalFileSystemDirectoryHandle {
  getFileHandle(name: string): Promise<MinimalFileSystemFileHandle>;
}

/** Checked against `lib.dom.d.ts`'s `StorageManager`: `getDirectory():
 * Promise<FileSystemDirectoryHandle>`. */
export interface MinimalStorageManager {
  getDirectory(): Promise<MinimalFileSystemDirectoryHandle>;
}

/**
 * NOT checked against `lib.dom.d.ts` — see this file's header doc for why.
 * Hand-written from the File System Access spec's
 * `FileSystemSyncAccessHandle` and MDN's documentation of it: a
 * synchronous, positional read/write handle, available (per spec, and
 * every current implementation this doc's author is aware of — not
 * verified empirically here) only inside a dedicated Worker, and — per
 * every current implementation, though the spec text itself does not scope
 * it this way, and this repository has not verified the restriction
 * empirically (no browser automation available in this environment; see
 * README's E1) — usable only for files inside the origin private file
 * system, never for a handle obtained from `showOpenFilePicker()`. That
 * restriction, real or not, doesn't block anything this repository builds
 * on top of this type: the only `WeightSource` that uses it
 * (`opfs-sync-weight-source.ts`) is the OPFS one, never the File System
 * Access one.
 *
 * `read`/`getSize`/`close` are the only members this package touches;
 * `write`/`truncate`/`flush` exist on the real interface but have no
 * caller here (this package only ever reads weights, never writes them),
 * so they are left off this minimal type rather than declared unused.
 */
export interface MinimalFileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { readonly at?: number }): number;
  getSize(): number;
  close(): void;
}

/** A `MinimalFileSystemFileHandle` that also exposes
 * `createSyncAccessHandle()` — real OPFS handles do; handles from
 * `showOpenFilePicker()` are not expected to (see
 * `MinimalFileSystemSyncAccessHandle`'s own doc). Kept as a separate type
 * (rather than folded into `MinimalFileSystemFileHandle` itself) so a
 * `FileSystemAccessWeightSource`, which only ever needs plain `getFile()`,
 * is never typed as if it could call a method it must not rely on. */
export interface MinimalSyncAccessFileHandle extends MinimalFileSystemFileHandle {
  createSyncAccessHandle(): Promise<MinimalFileSystemSyncAccessHandle>;
}

/** Checked against `lib.dom.d.ts`'s `interface Headers`: `get(name):
 * string | null`. */
export interface MinimalHeaders {
  get(name: string): string | null;
}

/** Checked against `lib.dom.d.ts`'s `interface ReadableStreamDefaultReader`:
 * `read(): Promise<ReadableStreamReadResult<R>>`, where
 * `ReadableStreamReadResult` is `{done: false; value: R} | {done: true;
 * value?: undefined}`. Collapsed to one shape with an optional `value`
 * here — narrower than the real discriminated union, but every caller in
 * this package only ever reads `done` and then conditionally `value`,
 * never relies on the type system to forbid reading `value` when `done` is
 * `true`. */
export interface MinimalStreamReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
}

/** Checked against `lib.dom.d.ts`'s `interface Response extends Body`
 * (`headers: Headers`, `status: number`, `arrayBuffer(): Promise<ArrayBuffer>`,
 * inherited `body: ReadableStream<Uint8Array> | null`) and
 * `interface ReadableStream` (`getReader(): ReadableStreamDefaultReader`). */
export interface MinimalResponse {
  readonly status: number;
  readonly headers: MinimalHeaders;
  readonly body: { getReader(): MinimalStreamReader } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Checked against `lib.dom.d.ts`'s ambient `declare function fetch(input,
 * init?): Promise<Response>` and `interface RequestInit` (`headers` /
 * `method`, the only two members any caller in this package sets). Node 24
 * (this repository's `engines.node`) has a global `fetch` with this shape
 * too (WHATWG-compatible, via `undici`), so `HttpRangeWeightSource` needs
 * no browser-only glue function the way the OPFS/File-System-Access
 * sources do — see that file's own doc — a fake satisfying this type is
 * enough to unit-test it fully in Node. */
export type MinimalFetch = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> },
) => Promise<MinimalResponse>;
