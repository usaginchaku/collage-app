import test from "node:test";
import assert from "node:assert/strict";
import {
  getLayouts,
  gridRects,
  initialState,
  newPhoto,
  outputSize,
} from "../src/layouts.js";
import { imagePlacement, hitTest, arrangeFree } from "../src/render.js";

test("all 1–12 photo templates partition the canvas without overlaps or omissions", () => {
  for (let count = 1; count <= 12; count++)
    for (const split of [0.3, 0.6, 0.75]) {
      for (const layout of getLayouts(count, split)) {
        assert.equal(layout.cells.length, count);
        let area = 0;
        layout.cells.forEach((a, i) => {
          assert.ok(a.w > 0 && a.h > 0);
          assert.ok(
            a.x >= 0 &&
              a.y >= 0 &&
              a.x + a.w <= 1.000001 &&
              a.y + a.h <= 1.000001,
          );
          area += a.w * a.h;
          for (const b of layout.cells.slice(i + 1)) {
            const overlap =
              Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
              Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            assert.ok(overlap < 1e-10, `${count} / ${layout.id} overlaps`);
          }
        });
        assert.ok(Math.abs(area - 1) < 1e-10);
      }
    }
});

test("large margins and gaps stay valid for every template at portrait and landscape extremes", () => {
  for (let count = 1; count <= 12; count++)
    for (const ratio of [9 / 16, 1, 16 / 9]) {
      const state = {
        ...initialState(),
        photos: Array.from({ length: count }, (_, i) =>
          newPhoto(String(i), "test"),
        ),
        gap: 6,
        margin: 10,
        ratio,
      };
      for (const layout of getLayouts(count)) {
        state.layout = layout.id;
        for (const rect of gridRects(state, 1080, 1080 / ratio)) {
          assert.ok(rect.w > 0 && rect.h > 0);
          assert.ok(rect.x >= 0 && rect.y >= 0);
          assert.ok(
            rect.x + rect.w <= 1080.0001 &&
              rect.y + rect.h <= 1080 / ratio + 0.0001,
          );
        }
      }
    }
});

test("cover crop remains filled at pan extremes and every quarter turn", () => {
  const rect = { x: 20, y: 30, w: 240, h: 400 };
  for (const rotation of [0, 90, 180, 270, -90])
    for (const offset of [-1, 0, 1])
      for (const zoom of [1, 3]) {
        const photo = {
          ...newPhoto("a", "a"),
          rotation,
          offsetX: offset,
          offsetY: offset,
          zoom,
        };
        const asset = { width: 900, height: 400 };
        const p = imagePlacement(photo, asset, rect);
        const turned = Math.abs(rotation % 180) === 90;
        const w = (turned ? asset.height : asset.width) * p.scale;
        const h = (turned ? asset.width : asset.height) * p.scale;
        assert.ok(p.x - w / 2 <= rect.x + 1e-8);
        assert.ok(p.y - h / 2 <= rect.y + 1e-8);
        assert.ok(p.x + w / 2 >= rect.x + rect.w - 1e-8);
        assert.ok(p.y + h / 2 >= rect.y + rect.h - 1e-8);
      }
});

test("output size uses the requested long edge and preserves aspect ratio", () => {
  assert.deepEqual(outputSize(4 / 5, 2048), { width: 1638, height: 2048 });
  assert.deepEqual(outputSize(16 / 9, 4096), { width: 4096, height: 2304 });
  assert.deepEqual(outputSize(1, 1080), { width: 1080, height: 1080 });
});

test("freeform hit testing respects rotation and front-to-back order", () => {
  const state = {
    ...initialState(),
    mode: "free",
    photos: [newPhoto("a", "a"), newPhoto("b", "b")],
  };
  const assets = new Map([
    ["a", { width: 100, height: 50 }],
    ["b", { width: 100, height: 50 }],
  ]);
  state.photos.forEach((p) => {
    p.free = { x: 0.5, y: 0.5, w: 0.5, rotation: 90 };
  });
  assert.equal(hitTest(state, assets, 500, 700, 1000, 1000), "b");
  assert.equal(hitTest(state, assets, 700, 500, 1000, 1000), null);
});

test("switching to freeform respects existing positions and fits new photos in their cells", () => {
  const state = {
    ...initialState(),
    photos: [newPhoto("a", "a"), newPhoto("b", "b")],
  };
  state.photos[0].free = { x: 0.4, y: 0.3, w: 0.7 };
  const assets = new Map([
    ["a", { width: 100, height: 50 }],
    ["b", { width: 50, height: 100 }],
  ]);
  arrangeFree(state, assets);
  assert.deepEqual(state.photos[0].free, { x: 0.4, y: 0.3, w: 0.7 });
  assert.ok(state.photos[1].free.w > 0 && state.photos[1].free.w < 0.5);
});

test("adjustable layout IDs survive an equal split", () => {
  for (let count = 2; count <= 12; count++)
    for (const side of ["left", "right", "top", "bottom"]) {
      assert.ok(
        getLayouts(count, 0.5).some((layout) => layout.id === `hero-${side}`),
      );
    }
});
