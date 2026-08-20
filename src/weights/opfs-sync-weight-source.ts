import type { MinimalFileSystemSyncAccessHandle, MinimalStorageManager, MinimalSyncAccessFileHandle } from "./browser-types.js";
import { clampRead, type WeightSource } from "./weight-source.js";

/**
 * The OPFS implementation (issue #1's second named backend). Uses
 * `FileSystemSyncAccessHandle.read(buffer, {at})`, not `getFile()`/`Blob`
 * (the path `FileSystemAccessWeightSource` is forced into — see that
 * file's own doc on why): a sync access handle writes directly into the
 * caller-supplied buffer, with ZERO intermediate allocation, and is the
 * one backend in this directory that can fully honor
 * `WeightSource.read`'s contract with no compromise — see
 * `weight-source.ts`'s header doc on why that contract is shaped the way
 * it is in the first place.
 *
 * Only usable inside a dedicated Worker: sync access handles are, per the
 * File System Access spec, unavailable on the main thread (their
 * synchronous `read`/`write` would otherwise block it). This class itself
 * doesn't care what thread it runs on — it only ever touches the handle
 * it's given — but `openOpfsSyncWeightSource` below, which is what
 * actually creates one via `createSyncAccessHandle()`, would reject
 * outside a Worker in a real browser. Neither claim (the Worker
 * restriction, or the further restriction to OPFS-only files noted on
 * `MinimalFileSystemSyncAccessHandle` in `browser-types.ts`) has been
 * verified empirically in this environment — no browser automation is
 * available here (this task's briefing) — so E1's real-browser
 * measurement work is what actually confirms or refutes them, not this
 * file's doc comments.
 */
export class OpfsSyncWeightSource implements WeightSource {
  constructor(private readonly handle: MinimalFileSystemSyncAccessHandle) {}

  async size(): Promise<number> {
    return this.handle.getSize();
  }

  /**
   * No `await` anywhere in this method body: `getSize()` and `read()` on a
   * `FileSystemSyncAccessHandle` are both synchronous by design (that is
   * the entire point of the "sync" in its name), and `clampRead` is a pure
   * function. That means one call to this `async` method runs to
   * completion — including the underlying `this.handle.read()` — before
   * JavaScript's single-threaded event loop can start a second call, even
   * if a caller kicks off several `read()`s at once via `Promise.all`.
   * Concurrent overlapping reads are therefore automatically serialized
   * against this one handle with no locking code of our own to write —
   * proven, not just asserted, by
   * `opfs-sync-weight-source.test.ts`'s `maxConcurrentReads` assertion
   * against a fake handle that would fail it if this method awaited
   * anything between `getSize()` and `read()`.
   */
  async read(destination: Uint8Array, offset: number): Promise<number> {
    const sizeBytes = this.handle.getSize();
    const { offset: at, length } = clampRead(offset, destination.byteLength, sizeBytes);
    if (length === 0) return 0;

    const view = length === destination.byteLength ? destination : destination.subarray(0, length);
    const bytesRead = this.handle.read(view, { at });
    if (bytesRead !== length) {
      throw new Error(
        `OpfsSyncWeightSource: expected to read ${length} byte(s) at offset ${at} but the handle reported ${bytesRead} — a sync access handle returning fewer bytes than a plan already clamped to its own getSize() indicates the file changed size out from under this read, or a non-conformant handle.`,
      );
    }
    return bytesRead;
  }

  /** Delegates to the handle's own `close()`, releasing its exclusive
   * lock on the file — the one resource any `WeightSource` in this
   * directory actually needs to release (contrast the in-memory and HTTP
   * Range sources, which have none). */
  async close(): Promise<void> {
    this.handle.close();
  }
}

/**
 * The thin, UNVERIFIABLE-IN-CI glue: opens `fileName` inside the origin
 * private file system (`navigator.storage.getDirectory()` →
 * `getFileHandle()` → `createSyncAccessHandle()`) and wraps the resulting
 * handle in an `OpfsSyncWeightSource`. Requires a real browser with OPFS
 * support, running inside a dedicated Worker (per the class doc above) —
 * this task's briefing states plainly that "OPFS and File System Access do
 * not exist in Node/Dawn", and no browser automation driver is installed
 * in this environment to exercise a real one. The one behavior that *can*
 * be asserted honestly without a real browser — a clean, specific error
 * rather than a confusing one when `navigator.storage` simply does not
 * exist (true of every environment `npm test` runs in) — is covered by
 * `opfs-sync-weight-source.test.ts`; the ignore below covers only the
 * unreachable-in-Node branch where OPFS actually exists and is opened.
 */
export async function openOpfsSyncWeightSource(fileName: string): Promise<OpfsSyncWeightSource> {
  const storage = (globalThis as { navigator?: { storage?: MinimalStorageManager } }).navigator?.storage;
  if (!storage) {
    throw new Error("openOpfsSyncWeightSource: navigator.storage is not available in this environment (requires a browser with OPFS support)");
  }
  /* v8 ignore start -- unverifiable in CI: reaching this line requires a real browser's OPFS (navigator.storage.getDirectory()) running inside a dedicated Worker; see this function's own doc above. */
  const root = await storage.getDirectory();
  const handle = (await root.getFileHandle(fileName)) as MinimalSyncAccessFileHandle;
  if (typeof handle.createSyncAccessHandle !== "function") {
    throw new Error(
      `openOpfsSyncWeightSource: the handle for "${fileName}" has no createSyncAccessHandle() — this must run inside a dedicated Worker, where OPFS's sync access handle API is available`,
    );
  }
  const syncHandle = await handle.createSyncAccessHandle();
  return new OpfsSyncWeightSource(syncHandle);
}
/* v8 ignore stop */
