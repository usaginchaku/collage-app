import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};
const port = Number(process.env.PORT || 4173);
http
  .createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const file = resolve(
        root,
        "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
      );
      if (
        !file.startsWith(root + sep) ||
        pathname.split("/").some((part) => part.startsWith("."))
      ) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
        "Cache-Control": "no-cache",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
