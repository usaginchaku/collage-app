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
    };
  });
}

test("empty-screen illustration and add button fit during phone height and orientation changes", async ({
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
    expect(b.button.bottom).toBeLessThanOrEqual(b.area.bottom);
    for (const tab of ["レイアウト", "フレーム", "画像 0"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const after = await emptyBounds(page);
      expect(after.button.bottom).toBeLessThanOrEqual(after.area.bottom);
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
  expect(restored.button.bottom).toBeLessThanOrEqual(restored.area.bottom);
});

test("help stays readable and returns to the export without losing the image", async ({
  page,
}, info) => {
  await page.goto("./");
  // Focus restoration applies when the dialog was opened from the keyboard.
  await page.locator("#help-open").focus();
  await page.locator("#help-open").press("Enter");
  const help = page.locator("#help-dialog");
  const close = help.getByRole("button", { name: "閉じる", exact: true });
  for (const size of [
    { width: 390, height: 664 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    for (const detail of await help.locator("details").all()) {
      if (!(await detail.evaluate((el) => el.open)))
        await detail.locator("summary").click();
      await detail.locator("p").last().scrollIntoViewIfNeeded();
      await expect(close).toBeInViewport();
      await expect(detail.locator("p").last()).toBeInViewport();
      expect(
        await help.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
  }
  await close.click();
  await expect(page.locator("#help-open")).toBeFocused();
  await page.locator("#file-input").setInputFiles(fixtures[0]);
  await page.locator("#export-open").click();
  await expect(page.locator("#download")).toBeEnabled();
  const imageBefore = await page.locator("#export-image").getAttribute("src");
  await page.locator("#save-help").focus();
  await page.locator("#save-help").press("Enter");
  await expect(help).toBeVisible();
  await expect(page.locator("#help-saving summary")).toBeInViewport();
  await expect(page.locator("#help-saving p").last()).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("save-help.png"),
    scale: "css",
  });
  await close.click();
  await expect(page.locator("#save-help")).toBeFocused();
  await expect(page.locator("#download")).toBeEnabled();
  await expect(page.locator("#export-image")).toHaveAttribute(
    "src",
    imageBefore,
  );
});
