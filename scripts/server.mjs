import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { root, publicFiles } from "./build.mjs";

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};
const html = await readFile(resolve(root, "index.html"), "utf8");
const policy = html.match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)[1];
export function createAppServer() {
  return http.createServer(async (request, response) => {
    const host = request.headers.host;
    const expectedPort = response.socket.localPort;
    if (
      ![`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`].includes(host)
    ) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      `${policy}; frame-ancestors 'none'`,
    );
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!publicFiles.includes(file)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(resolve(root, file));
      response.writeHead(200, {
        "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  createAppServer().listen(port, "127.0.0.1", () =>
    console.log(`http://127.0.0.1:${port}`),
  );
}
