import { test, expect } from "@playwright/test";
import { fixtures, png } from "../fixtures.mjs";

async function start(page, count = 3) {
  await page.goto("./");
  await expect(page.locator("[data-add]").first()).toBeEnabled();
  await page.locator("#file-input").setInputFiles(fixtures.slice(0, count));
  await expect(page.locator("#photo-count")).toHaveText(String(count));
  await expect(page.locator("#export-open")).toBeEnabled();
}
async function range(page, id, value) {
  await page.locator(`#${id}`).fill(String(value));
  await page.locator(`#${id}`).dispatchEvent("change");
}
async function draft(page) {
  await expect(page.locator("#local-status")).toHaveText("端末内に自動保存");
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("naraberu-collage", 1);
        open.onsuccess = () => {
          const get = open.result
            .transaction("draft")
            .objectStore("draft")
            .get("current");
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result.state);
          };
          get.onerror = reject;
        };
      }),
  );
}
async function exportedPixel(page, x, y) {
  return page.locator("#export-image").evaluate(
    async (img, [x, y]) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixel: [...ctx.getImageData(x, y, 1, 1).data],
      };
    },
    [x, y],
  );
}

test("add, layout, frame, preview, export and actual download", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const remoteRequests = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !==
        new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:4173").origin
    )
      remoteRequests.push(request.url());
  });
  await start(page);
  await page.getByRole("tab", { name: "レイアウト", exact: true }).click();
  await page.getByRole("button", { name: "左を大きく", exact: true }).click();
  await range(page, "split", 55);
  await page.getByRole("button", { name: "縦横比 4:5", exact: true }).click();
  await page.getByRole("tab", { name: "フレーム", exact: true }).click();
  await range(page, "gap", 2);
  await range(page, "radius", 3);
  await page
    .getByRole("button", { name: "背景色 ラベンダー", exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("editor.png"),
    fullPage: true,
  });
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  const result = await exportedPixel(page, 0, 0);
  expect(result.width).toBe(1638);
  expect(result.height).toBe(2048);
  expect(result.pixel).toEqual([232, 222, 239, 255]);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadPromise;
  await download.saveAs(info.outputPath("collage.png"));
  expect(download.suggestedFilename()).toMatch(/^collage-\d{8}\.png$/);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test("transparent PNG and white JPEG preserve dimensions and photo pixels", async ({
  page,
}) => {
  await start(page, 1);
  await page.getByRole("tab", { name: "フレーム", exact: true }).click();
  await page.getByRole("button", { name: "背景色 透明", exact: true }).click();
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  expect((await exportedPixel(page, 0, 0)).pixel[3]).toBe(0);
  expect((await exportedPixel(page, 1000, 1000)).pixel).toEqual([
    230, 60, 70, 255,
  ]);
  await page.locator("#export-format").selectOption("image/jpeg");
  await page.locator("#export-size").selectOption("1080");
  await expect(page.locator("#export-info")).toContainText("1080 × 1080");
  expect((await exportedPixel(page, 0, 0)).pixel).toEqual([255, 255, 255, 255]);
  await page.locator("#export-size").selectOption("4096");
  await expect(page.locator("#export-info")).toContainText("4096 × 4096");
  expect((await exportedPixel(page, 0, 0)).width).toBe(4096);
});

test("free layout, keyboard movement, undo, redo, removal and persisted restoration", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("tab", { name: "レイアウト", exact: true }).click();
  await page.locator("#mode-free").click();
  await page.getByRole("tab", { name: /^画像/ }).click();
  await page.locator(".photo-thumb").first().click();
  await range(page, "photo-angle", 27);
  await range(page, "photo-zoom", 0.65);
  const before = await draft(page);
  await page.locator("#collage").focus();
  await page.keyboard.press("ArrowRight");
  const moved = await draft(page);
  expect(moved.photos[0].free.x).toBeCloseTo(before.photos[0].free.x + 0.02);
  await page.locator("#undo").click();
  expect((await draft(page)).photos[0].free.x).toBeCloseTo(
    before.photos[0].free.x,
  );
  await page.locator("#redo").click();
  expect((await draft(page)).photos[0].free.x).toBeCloseTo(
    moved.photos[0].free.x,
  );
  await page.locator("#remove-photo").click();
  await expect(page.locator("#photo-count")).toHaveText("2");
  await page.locator("#undo").click();
  await expect(page.locator("#photo-count")).toHaveText("3");
  const saved = await draft(page);
  await page.reload();
  await expect(page.locator("#photo-count")).toHaveText("3");
  expect(await draft(page)).toEqual(saved);
  await page.locator("#new-collage").click();
  await page.locator("#new-dialog [data-close]").last().click();
  await expect(page.locator("#photo-count")).toHaveText("3");
  await page.locator("#new-collage").click();
  await page.locator("#confirm-new").click();
  await expect(page.locator("#photo-count")).toHaveText("0");
  await draft(page);
  await page.reload();
  await expect(page.locator("#photo-count")).toHaveText("0");
});

test("corrupt input and 12 image limit report clear errors without losing existing work", async ({
  page,
}) => {
  await start(page, 1);
  await page.locator("#file-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#error-banner")).toContainText(
    "読み込めませんでした",
  );
  await expect(page.locator("#photo-count")).toHaveText("1");
  await page.locator("#file-input").setInputFiles(
    Array.from({ length: 12 }, (_, i) => ({
      ...fixtures[i % 3],
      name: `${i}.png`,
    })),
  );
  await expect(page.locator("#photo-count")).toHaveText("12");
  await expect(page.locator("#error-banner")).toContainText("超えた分");
  await expect(page.locator("#export-open")).toBeEnabled();
  await expect(page.locator("#panel-photos [data-add]")).toBeDisabled();
});

test("storage failure remains editable and exportable with a visible warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new Error("Storage unavailable");
    };
  });
  await start(page, 1);
  await expect(page.locator("#error-banner")).toBeVisible();
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
});

test("tabs and main controls stay inside phone viewport through repeated tab switches", async ({
  page,
}, info) => {
  await start(page);
  if (info.project.name.startsWith("mobile")) {
    for (const size of [
      { width: 390, height: 664 },
      { width: 390, height: 844 },
      { width: 360, height: 740 },
    ]) {
      await page.setViewportSize(size);
      const positions = [];
      for (const tab of [
        "レイアウト",
        "フレーム",
        "画像 3",
        "レイアウト",
        "画像 3",
      ]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const rect = await page.locator(".tabs").boundingBox();
        positions.push(Math.round(rect.y));
        expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1);
        const overflow = await page.evaluate(() => ({
          x: document.documentElement.scrollWidth > innerWidth,
          y: document.documentElement.scrollHeight > innerHeight,
        }));
        expect(overflow).toEqual({ x: false, y: false });
      }
      expect(new Set(positions).size).toBe(1);
    }
  }
  await page.locator("#help-open").click();
  await page.getByText("下書き・プライバシー", { exact: true }).click();
  await expect(page.getByText(/画像はサーバーに送らず/)).toBeVisible();
  await page.locator("#help-dialog [data-close]").click();
  await expect(page.locator("#export-open")).toBeVisible();
});

test("pointer dragging and mode switches retain freeform edits", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page, 1);
  await page.getByRole("tab", { name: "レイアウト", exact: true }).click();
  await page.locator("#mode-free").click();
  await page.getByRole("tab", { name: /^画像/ }).click();
  await range(page, "photo-angle", 32);
  const before = await draft(page);
  const box = await page.locator("#collage").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.58, {
    steps: 8,
  });
  await page.mouse.up();
  const after = await draft(page);
  expect(after.photos[0].free.x).toBeCloseTo(before.photos[0].free.x + 0.1, 2);
  expect(after.photos[0].free.y).toBeCloseTo(before.photos[0].free.y + 0.08, 2);
  await page.locator("#undo").click();
  expect((await draft(page)).photos[0].free).toEqual(before.photos[0].free);
  await page.getByRole("tab", { name: "レイアウト", exact: true }).click();
  await page.locator("#mode-grid").click();
  await page.locator("#mode-free").click();
  expect((await draft(page)).photos[0].free.rotation).toBe(32);
  await page.locator("#file-input").setInputFiles([fixtures[1]]);
  await expect(page.locator("#photo-count")).toHaveText("2");
  expect(
    (await draft(page)).photos.every((photo) =>
      Number.isFinite(photo.free.rotation),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("free-layout.png"),
    fullPage: true,
  });
});

test("touch pinch scales and rotates without zooming the document", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "mobile-chromium",
    "CDP touch input is Chromium-only; other projects test drag and sliders.",
  );
  await start(page, 1);
  await page.getByRole("tab", { name: "レイアウト", exact: true }).click();
  await page.locator("#mode-free").click();
  const before = await draft(page);
  const box = await page.locator("#collage").boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 30, y: cy, id: 1 },
      { x: cx + 30, y: cy, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - 45, y: cy - 25, id: 1 },
      { x: cx + 45, y: cy + 25, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const after = await draft(page);
  expect(after.photos[0].free.w).toBeGreaterThan(before.photos[0].free.w * 1.5);
  expect(after.photos[0].free.rotation).toBeGreaterThan(20);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  await page.locator("#undo").click();
  expect((await draft(page)).photos[0].free).toEqual(before.photos[0].free);
});

test("phone JPEG EXIF orientation is normalized and survives reload", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("[data-add]").first()).toBeEnabled();
  const jpeg = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#e63c46";
      ctx.fillRect(0, 0, 60, 80);
      ctx.fillStyle = "#2878dc";
      ctx.fillRect(60, 0, 60, 80);
      return c.toDataURL("image/jpeg", 1).split(",")[1];
    }),
    "base64",
  );
  // EXIF orientation 6: the stored landscape pixels should display 90 degrees clockwise.
  const exif = Buffer.from(
    "ffe1002245786966000049492a0008000000010012010300010000000600000000000000",
    "hex",
  );
  const oriented = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "phone-portrait.jpg",
      mimeType: "image/jpeg",
      buffer: oriented,
    });
  await expect(page.locator("#photo-count")).toHaveText("1");
  await page.locator("#fit-photo").click();
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  const top = (await exportedPixel(page, 1024, 400)).pixel;
  const bottom = (await exportedPixel(page, 1024, 1600)).pixel;
  expect(top[0]).toBeGreaterThan(200);
  expect(top[2]).toBeLessThan(100);
  expect(bottom[2]).toBeGreaterThan(180);
  expect(bottom[0]).toBeLessThan(100);
  await page.locator("#export-dialog [data-close]").click();
  await draft(page);
  await page.reload();
  await expect(page.locator("#photo-count")).toHaveText("1");
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  expect((await exportedPixel(page, 1024, 400)).pixel).toEqual(top);
});

test("large images are bounded on import and alpha is preserved", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("[data-add]").first()).toBeEnabled();
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "large-alpha.png",
      mimeType: "image/png",
      buffer: png(5000, 2000, [200, 100, 50], 128),
    });
  await expect(page.locator("#photo-count")).toHaveText("1");
  const imageSize = await page
    .locator(".photo-thumb img")
    .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  expect(imageSize).toEqual([4096, 1638]);
  await page.getByRole("tab", { name: "フレーム", exact: true }).click();
  await page.getByRole("button", { name: "背景色 透明", exact: true }).click();
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  expect((await exportedPixel(page, 1024, 1024)).pixel[3]).toBe(128);
});
