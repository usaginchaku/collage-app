import test from "node:test";
import assert from "node:assert/strict";
import { inspectRaster, checkDimensions } from "../src/image-input.js";
import { validateState, validateDraft } from "../src/draft-validation.js";
import { initialState, newPhoto, resizeFrame } from "../src/layouts.js";
import { fixtures } from "./fixtures.mjs";
import { createAppServer } from "../scripts/server.mjs";
import { publicFiles, build, root } from "../scripts/build.mjs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { request } from "node:http";

test("raster preflight recognizes actual bytes and rejects disguised active content", () => {
  assert.deepEqual(inspectRaster(fixtures[0].buffer), {
    type: "image/png",
    width: 600,
    height: 400,
  });
  for (const input of [
    "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    "<!doctype html><script>alert(1)</script>",
    "%PDF-1.4 fake PNG",
  ])
    assert.throws(() => inspectRaster(Buffer.from(input)));
  assert.throws(() => inspectRaster(Buffer.from([1, 2, 3])));
  const large = Buffer.from(fixtures[0].buffer);
  large.writeUInt32BE(100000, 16);
  assert.throws(() => inspectRaster(large), /大きすぎ/);
  large.writeUInt32BE(12000, 16);
  large.writeUInt32BE(12000, 20);
  assert.throws(() => inspectRaster(large), /大きすぎ/);
  checkDimensions(8000, 6000);
});

test("JPEG segment bounds, GIF and WebP dimensions are read without decoding", () => {
  const jpeg = Buffer.from(
    "ffd8ffe1000645786966ffc0000b08028003c003011100ffd9",
    "hex",
  );
  assert.deepEqual(inspectRaster(jpeg), {
    type: "image/jpeg",
    width: 960,
    height: 640,
  });
  const corrupt = Buffer.from(jpeg);
  corrupt.writeUInt16BE(65535, 4);
  assert.throws(() => inspectRaster(corrupt));
  const gif = Buffer.from("4749463839618002e001800000", "hex");
  assert.deepEqual(inspectRaster(gif), {
    type: "image/gif",
    width: 640,
    height: 480,
  });
  const webp = Buffer.alloc(30);
  webp.write("RIFF");
  webp.writeUInt32LE(22, 4);
  webp.write("WEBPVP8X", 8);
  webp.writeUInt32LE(10, 16);
  webp.writeUIntLE(639, 24, 3);
  webp.writeUIntLE(479, 27, 3);
  assert.deepEqual(inspectRaster(webp), {
    type: "image/webp",
    width: 640,
    height: 480,
  });
  webp.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => inspectRaster(webp));
});

function box(name, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(name, 4);
  return Buffer.concat([header, data]);
}
test("AVIF/HEIF property parsing is bounded and ignores media payload signatures", () => {
  for (const brand of ["avif", "heic"]) {
    const props = Buffer.alloc(12);
    props.writeUInt32BE(800, 4);
    props.writeUInt32BE(600, 8);
    const file = Buffer.concat([
      box("ftyp", Buffer.from(brand + "\0\0\0\0")),
      box(
        "meta",
        Buffer.concat([
          Buffer.alloc(4),
          box("iprp", box("ipco", box("ispe", props))),
        ]),
      ),
    ]);
    assert.deepEqual(inspectRaster(file), {
      type: brand === "avif" ? "image/avif" : "image/heic",
      width: 800,
      height: 600,
    });
    const fake = Buffer.concat([
      box("ftyp", Buffer.from(brand + "\0\0\0\0")),
      box("mdat", box("ispe", props)),
    ]);
    assert.throws(() => inspectRaster(fake));
  }
});

function validState() {
  return {
    ...initialState(),
    photos: [newPhoto("a", "one.png"), newPhoto("b", "two.png")],
    layout: "rows-1",
  };
}
test("draft validation rejects dangerous shapes, nonfinite values, duplicates and extreme render loops", () => {
  for (const mutate of [
    (s) => (s.ratio = 0),
    (s) => (s.ratio = Infinity),
    (s) => (s.gap = "2"),
    (s) => (s.margin = -1),
    (s) => (s.watermark.text = "x".repeat(61)),
    (s) => (s.watermark.opacity = NaN),
    (s) => (s.photos[0].zoom = 1e20),
    (s) => (s.photos[1].id = "a"),
    (s) => (s.backgroundImage = "a"),
    (s) => (s.mode = "free"),
    (s) => (s.photos[0].rotation = 19),
    (s) => (s.background = "url(https://example.invalid/)"),
    (s) =>
      (s.frameLayout = {
        key: "rows-1:2:0.6",
        cells: [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 0, y: 0, w: 1, h: 1 },
        ],
      }),
  ]) {
    const state = validState();
    mutate(state);
    assert.throws(() => validateState(state));
  }
  const source = validState();
  resizeFrame(source, 0, "w", 0.65);
  assert.deepEqual(validateState(source), source);
  const unknown = { ...source, unexpected: { script: "ignored" } };
  assert.equal(validateState(unknown).unexpected, undefined);
});

test("draft images must match references, use bounded binary data and retain legacy blobs", () => {
  const state = validState();
  const draft = {
    state,
    images: ["a", "b"].map((id) => ({
      id,
      blob: new Blob([fixtures[0].buffer], { type: "image/png" }),
    })),
  };
  assert.equal(validateDraft(draft).images.length, 2);
  assert.throws(() =>
    validateDraft({ ...draft, images: [...draft.images, draft.images[0]] }),
  );
  assert.throws(() =>
    validateDraft({
      ...draft,
      images: [{ id: "a", blob: "https://example.invalid/" }, draft.images[1]],
    }),
  );
  assert.throws(() =>
    validateDraft({
      ...draft,
      images: [{ ...draft.images[0], id: "other" }, draft.images[1]],
    }),
  );
});

test("only allowlisted static files are served; rebinding hosts, writes and private paths fail", async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    for (const path of [
      "/.git/config",
      "/.local/fixtures/red-landscape.png",
      "/package.json",
      "/docs/VERIFICATION.md",
      "/tests/fixtures.mjs",
      "/node_modules/@playwright/test/package.json",
      "/%2e%2e/%2e%2e/Windows/win.ini",
      "/src%5c..%5cpackage.json",
    ])
      assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal(
      (await fetch(base, { method: "POST", body: "test" })).status,
      405,
    );
    // Fetch may replace a caller-supplied Host. Use HTTP directly to exercise
    // the actual Host header a DNS-rebinding request would send.
    const spoofed = await new Promise((resolve, reject) => {
      request(base, { headers: { Host: "attacker.invalid" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on("error", reject)
        .end();
    });
    assert.equal(spoofed, 403);
    assert.equal((await fetch(base, { method: "HEAD" })).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("deployment output contains exactly the allowlist and matches source bytes", async () => {
  await build();
  const list = await readdir(resolve(root, "dist"), {
    recursive: true,
    withFileTypes: true,
  });
  assert.equal(
    list.filter((entry) => entry.isFile()).length,
    publicFiles.length,
  );
  for (const file of publicFiles)
    assert.deepEqual(
      await readFile(resolve(root, "dist", file)),
      await readFile(resolve(root, file)),
    );
});
