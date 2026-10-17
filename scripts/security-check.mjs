import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publicFiles, root } from "./build.mjs";

const html = await readFile(resolve(root, "index.html"), "utf8");
for (const rule of [
  "default-src 'none'",
  "connect-src 'none'",
  "script-src-attr 'none'",
  "style-src-attr 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
])
  assert.ok(html.includes(rule), `Missing CSP rule: ${rule}`);
assert.ok(!html.includes("unsafe-inline") && !html.includes("unsafe-eval"));
assert.ok(html.includes('name="referrer" content="no-referrer"'));
assert.ok(html.includes('src="./src/bootstrap.js"'));
assert.ok(
  !/\son[a-z]+\s*=|\sstyle\s*=/.test(html),
  "Inline handlers/styles must not be introduced",
);
const secrets =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|AIza[a-zA-Z0-9_-]{30,})/;
for (const file of publicFiles) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.ok(!secrets.test(source), `Possible secret in ${file}`);
  assert.ok(
    !/[A-Z]:[\\/]Users[\\/]|[A-Z]:[\\/]MadeByMySelf[\\/]/i.test(source),
    `Local path in ${file}`,
  );
  if (file.endsWith(".js"))
    assert.ok(
      !/\b(?:eval|fetch|WebSocket|XMLHttpRequest)\s*\(|\bnew\s+Function\s*\(|sendBeacon\s*\(/.test(
        source,
      ),
      `Unexpected execution/network API in ${file}`,
    );
}
const workflow = await readFile(
  resolve(root, ".github/workflows/pages.yml"),
  "utf8",
);
for (const action of workflow.matchAll(/uses:\s*(\S+)/g))
  assert.match(action[1], /^actions\/[a-z-]+@[a-f0-9]{40}$/);
assert.ok(workflow.includes("persist-credentials: false"));
console.log(
  `Security policy and ${publicFiles.length} public files checked; no matching credential or local-path patterns`,
);
