import { test, expect } from "@playwright/test";
import { fixtures } from "../fixtures.mjs";

async function emptyBounds(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    };
    return {
      area: box("#preview-area"),
      empty: box("#empty-state"),
      art: box(".art-front"),
      button: box("#empty-state button"),
      copy: box("#empty-state p"),
      footer: box(".workspace-footer"),
    };
  });
}

test("empty-screen illustration and text fit during phone height and orientation changes", async ({
  page,
}, info) => {
  await page.goto("./");
  await expect(page.locator("#empty-state button")).toBeEnabled();
  // Safari's address bar changes the available height without changing width.
  for (const size of [
    { width: 390, height: 844 },
    { width: 390, height: 664 },
    { width: 390, height: 600 },
    { width: 390, height: 550 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 664 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const b = await emptyBounds(page);
        return (
          b.empty.top >= b.area.top - 1 && b.empty.bottom <= b.area.bottom + 1
        );
      })
      .toBe(true);
    const b = await emptyBounds(page);
    expect(b.art.bottom).toBeLessThanOrEqual(b.button.top + 1);
    expect(b.button.bottom + 5).toBeLessThanOrEqual(b.copy.top);
    expect(b.copy.bottom + 4).toBeLessThanOrEqual(b.footer.top);
    for (const tab of ["レイアウト", "フレーム", "画像 0"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const after = await emptyBounds(page);
      expect(after.copy.bottom + 4).toBeLessThanOrEqual(after.footer.top);
    }
  }
  await page.screenshot({
    path: info.outputPath("mobile-empty-fixed.png"),
    scale: "css",
  });
  await page.locator("#file-input").setInputFiles(fixtures[0]);
  await expect(page.locator("#empty-state")).toBeHidden();
  await expect(page.locator("#collage")).toBeVisible();
  await page.locator("#remove-photo").click();
  await expect(page.locator("#empty-state")).toBeVisible();
  const restored = await emptyBounds(page);
  expect(restored.copy.bottom + 4).toBeLessThanOrEqual(restored.footer.top);
});
