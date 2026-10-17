import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixtures } from "../fixtures.mjs";

async function start(page) {
  await page.goto("./");
  await expect(page.locator("[data-add]").first()).toBeEnabled();
}

test("image bytes are validated and filenames never become executable markup", async ({
  page,
}) => {
  await start(page);
  const name = '<img src=x onerror="window.filenameExecuted=true">.png';
  await page
    .locator("#file-input")
    .setInputFiles({ ...fixtures[0], name, mimeType: "text/html" });
  await expect(page.locator("#photo-count")).toHaveText("1");
  expect(await page.evaluate(() => window.filenameExecuted)).toBeUndefined();
  await expect(page.locator("img[onerror]")).toHaveCount(0);
  await page.locator("#file-input").setInputFiles({
    name: "disguised.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
  });
  await expect(page.locator("#error-banner")).toContainText(
    "SVGやHTMLは使用できません",
  );
  await expect(page.locator("#photo-count")).toHaveText("1");
  const huge = Buffer.from(fixtures[0].buffer);
  huge.writeUInt32BE(100000, 16);
  await page
    .locator("#file-input")
    .setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: huge });
  await expect(page.locator("#error-banner")).toContainText("大きすぎ");
  await expect(page.locator("#photo-count")).toHaveText("1");
  // A real browser-encoded WebP must pass the same parser as imported photos.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 6;
    canvas.getContext("2d").fillRect(0, 0, 8, 6);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp"),
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.locator("#file-input").setInputFiles({
    name: "photo.webp",
    mimeType: "image/webp",
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator("#photo-count")).toHaveText("2");
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
});

test("CSP blocks injected scripts, inline handlers, eval, external resources and network requests", async ({
  page,
  browserName,
}) => {
  const outgoing = [];
  await page.route("https://security-probe.invalid/**", (route) => {
    outgoing.push(route.request().url());
    return route.fulfill({ status: 200, body: "" });
  });
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.violations.push({
        directive: e.violatedDirective,
        source: e.sourceFile,
        line: e.lineNumber,
      }),
    );
  });
  // DevTools evaluation bypasses unsafe-eval restrictions. Execute this probe
  // as a real same-origin script instead, under the page's actual CSP.
  await page.route("**/security-eval-probe.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'window.evalBlocked = false; try { Function("return 1")(); } catch { window.evalBlocked = true; }',
    }),
  );
  await start(page);
  await page.locator("#file-input").setInputFiles(fixtures[0]);
  await expect(page.locator("#photo-count")).toHaveText("1");
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  const html = await readFile(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  const nativeSelectLines = html
    .split("\n")
    .flatMap((line, index) => (line.includes("<select") ? [index + 1] : []));
  // Windows WebKit reports its own native select shadow-DOM styles against
  // style-src-attr (empty source, HTML select line). Keep the policy strict;
  // app-created styles must not produce any violation.
  const ordinary = await page.evaluate(() => window.violations);
  expect(
    ordinary.filter(
      (v) =>
        !(
          browserName === "webkit" &&
          v.directive === "style-src-attr" &&
          v.source === "" &&
          nativeSelectLines.includes(v.line)
        ),
    ),
  ).toEqual([]);
  await page.evaluate(() => {
    window.violations = [];
  });
  const blocked = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.injectedExecuted = true";
    document.body.append(script);
    const button = document.createElement("button");
    button.setAttribute("onclick", "window.handlerExecuted = true");
    document.body.append(button);
    button.click();
    const evalProbe = document.createElement("script");
    evalProbe.src = "./security-eval-probe.js";
    const loaded = new Promise((resolve) => {
      evalProbe.onload = resolve;
    });
    document.body.append(evalProbe);
    await loaded;
    const remote = document.createElement("script");
    remote.src = "https://security-probe.invalid/script.js";
    document.body.append(remote);
    const image = new Image();
    image.src = "https://security-probe.invalid/image.png";
    document.body.append(image);
    const frame = document.createElement("iframe");
    frame.src = "https://security-probe.invalid/frame";
    document.body.append(frame);
    const calls = await Promise.all(
      ["./index.html", "https://security-probe.invalid/upload"].map(
        async (url) => {
          try {
            await fetch(url);
            return false;
          } catch {
            return true;
          }
        },
      ),
    );
    return { evalBlocked: window.evalBlocked, calls };
  });
  expect(blocked).toEqual({ evalBlocked: true, calls: [true, true] });
  await expect
    .poll(() => page.evaluate(() => window.violations.length))
    .toBeGreaterThanOrEqual(7);
  expect(
    await page.evaluate(() => [
      window.injectedExecuted,
      window.handlerExecuted,
    ]),
  ).toEqual([undefined, undefined]);
  expect(outgoing).toEqual([]);
});

test("embedded editor stops before opening storage even without frame response headers", async ({
  page,
}) => {
  const html = await readFile(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  await page.route("**/security-parent.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<iframe src="./security-embedded.html"></iframe>',
    }),
  );
  await page.route("**/security-embedded.html", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.addInitScript(() => {
    window.storageOpened = 0;
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      window.storageOpened++;
      return original(...args);
    };
  });
  await page.goto("./security-parent.html");
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByText("このアプリは単独の画面で開いてください。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(frame.locator("#collage")).toHaveCount(0);
  expect(await frame.locator("body").evaluate(() => window.storageOpened)).toBe(
    0,
  );
  await expect(frame.getByRole("link")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
});

async function storedRatio(page, replacement = null) {
  return page.evaluate(
    (replacement) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("naraberu-collage", 1);
        open.onerror = reject;
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction(
              "draft",
              replacement !== null ? "readwrite" : "readonly",
            ),
            store = tx.objectStore("draft");
          const get = store.get("current");
          let ratio;
          get.onsuccess = () => {
            const saved = get.result;
            if (replacement !== null) {
              saved.state.ratio = replacement;
              store.put(saved, "current");
            }
            ratio = saved.state.ratio;
          };
          tx.oncomplete = () => {
            db.close();
            resolve(ratio);
          };
          tx.onerror = reject;
        };
      }),
    replacement,
  );
}

for (const failure of ["invalid state", "temporary storage failure"])
  test(`${failure} preserves the original draft while editing and export remain usable`, async ({
    page,
  }) => {
    await start(page);
    await page.locator("#file-input").setInputFiles(fixtures[0]);
    await expect(page.locator("#photo-count")).toHaveText("1");
    await expect(page.locator("#local-status")).toHaveText("下書き保存済み");
    const originalRatio = failure === "invalid state" ? 0 : 0.8;
    await storedRatio(page, originalRatio);
    if (failure === "temporary storage failure")
      await page.addInitScript(() => {
        const original = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function () {
          IDBFactory.prototype.open = original;
          throw new Error("Temporary storage read failure");
        };
      });
    await page.reload();
    await expect(page.locator("#error-banner")).toContainText("自動保存を停止");
    await page.locator("#file-input").setInputFiles(fixtures[1]);
    await expect(page.locator("#photo-count")).toHaveText("1");
    await expect(page.locator("#local-status")).toContainText(
      "元の下書きを保護中",
    );
    await page.locator("#export-open").click();
    await expect(page.locator("#download")).toBeEnabled();
    expect(await storedRatio(page)).toBe(originalRatio);
    await page.locator("#export-dialog [data-close]").click();
    await page.locator("#new-collage").click();
    await page.locator("#confirm-new").click();
    await page.locator("#file-input").setInputFiles(fixtures[0]);
    await expect(page.locator("#photo-count")).toHaveText("1");
    await expect(page.locator("#local-status")).toHaveText("下書き保存済み");
    expect(await storedRatio(page)).toBe(1);
  });
