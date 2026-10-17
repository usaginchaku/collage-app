import {
  initialState,
  getLayout,
  getLayouts,
  MAX_PHOTOS,
  RATIOS,
} from "./layouts.js";
import { MAX_FILE_BYTES } from "./image-input.js";

const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const number = (v, low, high) =>
  typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
const identifier = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const color = (v) => typeof v === "string" && /^#[a-fA-F0-9]{6}$/.test(v);
function requireValid(condition) {
  if (!condition) throw new Error("下書きの内容を安全に読み込めませんでした。");
}

export function validateState(saved) {
  requireValid(
    record(saved) &&
      saved.version === 1 &&
      Array.isArray(saved.photos) &&
      saved.photos.length <= MAX_PHOTOS,
  );
  const defaults = initialState();
  requireValid(
    ["grid", "free"].includes(saved.mode) &&
      RATIOS.some((r) => r[1] === saved.ratio),
  );
  for (const [key, max] of [
    ["gap", 6],
    ["margin", 10],
    ["radius", 12],
  ])
    requireValid(number(saved[key], 0, max));
  requireValid(
    number(saved.split, 0.3, 0.75) &&
      (color(saved.background) || saved.background === "transparent"),
  );
  const ids = new Set();
  const photos = saved.photos.map((p) => {
    requireValid(
      record(p) &&
        identifier(p.id) &&
        !ids.has(p.id) &&
        typeof p.name === "string" &&
        p.name.length <= 1024,
    );
    ids.add(p.id);
    requireValid(
      number(p.zoom, 1, 3) &&
        number(p.offsetX, -1, 1) &&
        number(p.offsetY, -1, 1),
    );
    requireValid(
      number(p.rotation, -360, 360) &&
        p.rotation % 90 === 0 &&
        typeof p.flip === "boolean" &&
        ["cover", "contain"].includes(p.fit),
    );
    let free = null;
    if (p.free != null) {
      const f = p.free;
      requireValid(
        record(f) &&
          number(f.x, 0, 1) &&
          number(f.y, 0, 1) &&
          number(f.w, 0.08, 1.5) &&
          number(f.rotation, -360, 360),
      );
      free = { x: f.x, y: f.y, w: f.w, rotation: f.rotation };
      if (f.h != null) {
        requireValid(number(f.h, Number.MIN_VALUE, 10000));
        free.h = f.h;
      }
    }
    requireValid(saved.mode !== "free" || free !== null);
    return {
      id: p.id,
      name: p.name,
      zoom: p.zoom,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
      rotation: p.rotation,
      flip: p.flip,
      fit: p.fit,
      free,
    };
  });
  const state = {
    ...defaults,
    photos,
    mode: saved.mode,
    ratio: saved.ratio,
    layout: saved.layout,
    gap: saved.gap,
    margin: saved.margin,
    radius: saved.radius,
    background: saved.background,
    split: saved.split,
  };
  requireValid(
    saved.layout === "" ||
      getLayouts(photos.length, saved.split).some((l) => l.id === saved.layout),
  );
  if (saved.backgroundImage != null) {
    requireValid(
      identifier(saved.backgroundImage) && !ids.has(saved.backgroundImage),
    );
    state.backgroundImage = saved.backgroundImage;
  }
  if (saved.backgroundPattern !== undefined) {
    requireValid(
      ["none", "dots", "stripes", "checks"].includes(saved.backgroundPattern),
    );
    state.backgroundPattern = saved.backgroundPattern;
  }
  if (saved.watermark !== undefined) {
    const mark = saved.watermark;
    requireValid(
      record(mark) &&
        typeof mark.enabled === "boolean" &&
        typeof mark.text === "string" &&
        mark.text.length <= 60 &&
        ["corner", "repeat"].includes(mark.mode) &&
        number(mark.opacity, 0.1, 1) &&
        color(mark.color),
    );
    state.watermark = {
      enabled: mark.enabled,
      text: mark.text,
      mode: mark.mode,
      opacity: mark.opacity,
      color: mark.color,
    };
  }
  if (saved.frameLayout != null) {
    const frame = saved.frameLayout;
    requireValid(
      record(frame) &&
        frame.key ===
          `${getLayout(state).id}:${photos.length}:${state.split}` &&
        Array.isArray(frame.cells) &&
        frame.cells.length === photos.length &&
        photos.length > 0,
    );
    const cells = frame.cells.map((c) => {
      requireValid(
        record(c) &&
          number(c.x, 0, 1) &&
          number(c.y, 0, 1) &&
          number(c.w, 0.001, 1) &&
          number(c.h, 0.001, 1) &&
          c.x + c.w <= 1.000001 &&
          c.y + c.h <= 1.000001,
      );
      return { x: c.x, y: c.y, w: c.w, h: c.h };
    });
    requireValid(
      Math.abs(cells.reduce((sum, c) => sum + c.w * c.h, 0) - 1) < 1e-6,
    );
    cells.forEach((a, i) =>
      cells.slice(i + 1).forEach((b) => {
        const overlap =
          Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        requireValid(overlap < 1e-7);
      }),
    );
    state.frameLayout = { key: frame.key, cells };
  }
  return state;
}

export function validateDraft(draft) {
  requireValid(record(draft));
  const state = validateState(draft.state);
  const expected = new Set([
    ...state.photos.map((p) => p.id),
    ...(state.backgroundImage ? [state.backgroundImage] : []),
  ]);
  requireValid(
    Array.isArray(draft.images) && draft.images.length === expected.size,
  );
  let total = 0;
  const images = draft.images.map((image) => {
    requireValid(record(image) && expected.delete(image.id));
    const blob =
      image.bytes instanceof ArrayBuffer
        ? new Blob([image.bytes], {
            type: typeof image.type === "string" ? image.type : "",
          })
        : image.blob;
    requireValid(
      blob instanceof Blob && blob.size > 0 && blob.size <= MAX_FILE_BYTES,
    );
    total += blob.size;
    requireValid(total <= 180 * 1024 * 1024);
    return { id: image.id, blob };
  });
  return { state, images };
}
