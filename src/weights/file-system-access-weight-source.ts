import type { MinimalBlob, MinimalFileSystemFileHandle } from "./browser-types.js";
import { clampRead, planChunkedRead, type WeightSource } from "./weight-source.js";

/**
 * The "whatever the spike found viable for local files" backend (issue
 * #1). File System Access (`showOpenFilePicker`) requires a user gesture
 * and — per this task's briefing — cannot be driven from an automated page
 * without a permission/picker workaround this environment doesn't have: no
 * browser automation driver is installed here, and there is no way to
 * grant that gesture from a script. `pickLocalFileSystemAccessSource`
 * below (the one function in this file that actually calls
 * `showOpenFilePicker`) is UNVERIFIABLE IN CI for exactly that reason, and
 * is marked with an inline `v8 ignore` immediately above it — one function,
 * not this whole file, per CLAUDE.md rule 1's "write the reason next to
 * the code".
 *
 * Everything else here — the actual read logic, `FileSystemAccessWeightSource`
 * — takes an already-obtained `MinimalFileSystemFileHandle` as a plain
 * constructor argument instead of calling `showOpenFilePicker` itself, so
 * it is fully unit-testable against a fake handle honoring the real
 * interface (checked against `lib.dom.d.ts`, see `browser-types.ts`),
 * exactly like every other `WeightSource` in this directory.
 *
 * Reads go through `handle.getFile()` → `Blob.slice().arrayBuffer()`, not
 * a sync access handle: `createSyncAccessHandle()` is, per every current
 * browser implementation this doc's author is aware of (not verified
 * empirically here — see `browser-types.ts`'s own note on
 * `MinimalFileSystemSyncAccessHandle`), restricted to files inside the
 * origin private file system, which a `showOpenFilePicker()`-obtained
 * handle is not. `Blob.slice().arrayBuffer()` is the one read path the
 * File System Access spec guarantees for a handle like this, at the cost
 * of one intermediate allocation per underlying slice `read()` cannot
 * avoid (`Blob` has no "read into my buffer" primitive, per
 * `lib.dom.d.ts`) — chunked via `planChunkedRead` so that allocation is
 * bounded by `chunkSizeBytes`, not by the size of whatever the caller
 * asked to read in one `read()` call. This is the one honest cost of the
 * File System Access backend relative to OPFS's sync-access-handle path
 * (`opfs-sync-weight-source.ts`), and it is exactly the kind of thing E1's
 * bench harness exists to measure rather than assume.
 */
export class FileSystemAccessWeightSource implements WeightSource {
  constructor(
    private readonly handle: MinimalFileSystemFileHandle,
    private readonly chunkSizeBytes: number = DEFAULT_FSA_CHUNK_SIZE_BYTES,
  ) {
    if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
      throw new RangeError(`FileSystemAccessWeightSource: chunkSizeBytes must be a positive integer, got ${chunkSizeBytes}`);
    }
  }

  /** Re-fetches the handle's current `File` snapshot. Called by both
   * `size()` and `read()` rather than cached permanently at construction:
   * the file on disk can change between calls (the whole reason
   * `getFile()` is a method returning a fresh snapshot rather than a
   * static property), and a permanently cached size would make later
   * `read()` bounds-checks silently wrong instead of reflecting a file a
   * user edited externally between reads. */
  private currentFile(): Promise<MinimalBlob> {
    return this.handle.getFile();
  }

  async size(): Promise<number> {
    const file = await this.currentFile();
    return file.size;
  }

  async read(destination: Uint8Array, offset: number): Promise<number> {
    const file = await this.currentFile();
    const { offset: at, length } = clampRead(offset, destination.byteLength, file.size);
    if (length === 0) return 0;

    let written = 0;
    for (const part of planChunkedRead(at, length, this.chunkSizeBytes)) {
      const chunkBuffer = await file.slice(part.offset, part.offset + part.length).arrayBuffer();
      destination.set(new Uint8Array(chunkBuffer), written);
      written += part.length;
    }
    return written;
  }

  // No `close()`: a plain `FileSystemFileHandle` read through `getFile()`
  // holds no resource open between calls (unlike a sync access handle's
  // exclusive lock — see `opfs-sync-weight-source.ts`).
}

/** Bytes per `Blob.slice().arrayBuffer()` call. 8 MiB — chosen, not
 * measured against other in-range sizes (the same honest caveat
 * `weight-cache.ts#DEFAULT_CHUNK_SIZE_BYTES` states about its own default):
 * small enough to keep the intermediate allocation this backend cannot
 * avoid from scaling with an arbitrarily large `read()` destination, large
 * enough that a multi-gigabyte weight file isn't split into an
 * unreasonable number of separate `slice()`/`arrayBuffer()` round trips.
 * Nothing in this file's logic depends on the exact value; it stayed a
 * named, overridable constructor default rather than a magic number for
 * the same reason. */
export const DEFAULT_FSA_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * The thin, UNVERIFIABLE-IN-CI glue: calls `showOpenFilePicker()` (a real
 * user gesture; no ambient type for it here, since `lib.dom.d.ts` is not
 * in this project's `lib` — see `browser-types.ts`) and wraps whatever
 * handle comes back in a `FileSystemAccessWeightSource`. Nothing exercises
 * the picker call itself; there is no way to grant it a gesture from
 * Node or from an unattended/headless browser context, and this
 * repository has no browser-automation driver installed (per this task's
 * briefing) that could even attempt one. The one behavior that *can* be
 * asserted honestly without a real browser — that this throws a clear
 * error rather than a confusing one when `showOpenFilePicker` simply does
 * not exist (true of every environment `npm test` runs in) — is covered by
 * `file-system-access-weight-source.test.ts`; the ignore below covers only
 * the unreachable-in-Node branch where the picker exists and is called.
 */
export async function pickLocalFileSystemAccessSource(chunkSizeBytes?: number): Promise<FileSystemAccessWeightSource> {
  const picker = (globalThis as { showOpenFilePicker?: () => Promise<MinimalFileSystemFileHandle[]> }).showOpenFilePicker;
  if (!picker) {
    throw new Error(
      "pickLocalFileSystemAccessSource: showOpenFilePicker is not available in this environment (requires a browser with File System Access support and a real user gesture)",
    );
  }
  /* v8 ignore start -- unverifiable in CI: reaching this line requires a real browser's showOpenFilePicker() and a user gesture; see this function's own doc above. */
  const [handle] = await picker();
  if (!handle) {
    throw new Error("pickLocalFileSystemAccessSource: no file was selected");
  }
  return new FileSystemAccessWeightSource(handle, chunkSizeBytes);
}
/* v8 ignore stop */
