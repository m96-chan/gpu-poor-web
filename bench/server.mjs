// Minimal static server so the bench page loads over http://localhost
// instead of file://. Required because:
//   - OPFS (navigator.storage.getDirectory()) throws SecurityError on
//     file:// and only works over http(s) (no TLS needed for localhost,
//     Chrome treats it as a secure context).
//   - navigator.gpu is undefined on a fresh about:blank/file:// page in
//     Playwright until navigating to a served, secure-context origin.
// Both facts were verified empirically in the E1 spike
// (scratchpad/spike/FINDINGS.md, sections 1 and 3) — see bench/README.md.
//
// No static files are actually served from disk: every payload runs via
// page.evaluate() (a function is serialized from Node and executed
// in-page), so the page itself only needs to exist as a secure-context
// document. Keeping this as a single hand-rolled http.createServer (no
// `serve`/`http-server` dependency) matches the spike's recommendation to
// keep the whole `npm run bench` pipeline dependency-free beyond Playwright.
import { createServer } from "node:http";

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>gpu-poor-web bench</title></head>
<body>gpu-poor-web bench harness page — see bench/README.md</body>
</html>
`;

/**
 * Starts the static server on `127.0.0.1`. `port: 0` (the default) asks the
 * OS for a free port, avoiding collisions between concurrent runs.
 * Returns the base URL to navigate to and a `close()` to tear it down.
 */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(INDEX_HTML);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server.address() did not return a bound TCP address"));
        return;
      }
      resolve({
        port: address.port,
        // "localhost", not "127.0.0.1": matches what the spike verified as
        // a secure context for both WebGPU and OPFS (FINDINGS.md §1, §3).
        url: `http://localhost:${address.port}/`,
        close: () => new Promise((res) => server.close(() => res(undefined))),
      });
    });
  });
}
