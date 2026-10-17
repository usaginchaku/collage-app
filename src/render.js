import { gridRects, clamp } from "./layouts.js";

export function photoRect(state, photo, index, assets, width, height) {
  if (state.mode === "grid") return gridRects(state, width, height)[index];
  const asset = assets.get(photo.id);
  const free = photo.free || { x: 0.5, y: 0.5, w: 0.5 };
  const w = free.w * width;
  const h = (w * asset.height) / asset.width;
  return { x: free.x * width - w / 2, y: free.y * height - h / 2, w, h };
}

export function imagePlacement(photo, asset, rect) {
  const turned = Math.abs(photo.rotation % 180) === 90;
  const imageW = turned ? asset.height : asset.width;
  const imageH = turned ? asset.width : asset.height;
  const scale =
    (photo.fit === "contain"
      ? Math.min(rect.w / imageW, rect.h / imageH)
      : Math.max(rect.w / imageW, rect.h / imageH)) * photo.zoom;
  const overflowX = Math.max(0, (imageW * scale - rect.w) / 2);
  const overflowY = Math.max(0, (imageH * scale - rect.h) / 2);
  return {
    scale,
    overflowX,
    overflowY,
    x: rect.x + rect.w / 2 + photo.offsetX * overflowX,
    y: rect.y + rect.h / 2 + photo.offsetY * overflowY,
  };
}

function roundedPath(ctx, rect, radius) {
  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    Math.min(radius, rect.w / 2, rect.h / 2),
  );
}

export function renderCollage(
  ctx,
  state,
  assets,
  width,
  height,
  { jpeg = false } = {},
) {
  ctx.clearRect(0, 0, width, height);
  if (jpeg || state.background !== "transparent") {
    ctx.fillStyle =
      state.background === "transparent" ? "#ffffff" : state.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const radius = (Math.min(width, height) * state.radius) / 100;
  const rects = state.mode === "grid" ? gridRects(state, width, height) : null;
  state.photos.forEach((photo, index) => {
    const asset = assets.get(photo.id);
    if (!asset) return;
    const rect = rects
      ? rects[index]
      : photoRect(state, photo, index, assets, width, height);
    ctx.save();
    if (state.mode === "free") {
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.rotate((photo.free.rotation * Math.PI) / 180);
      const local = { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h };
      roundedPath(ctx, local, radius);
      ctx.clip();
      if (photo.flip) ctx.scale(-1, 1);
      ctx.drawImage(asset.image, local.x, local.y, rect.w, rect.h);
    } else {
      roundedPath(ctx, rect, radius);
      ctx.clip();
      const pos = imagePlacement(photo, asset, rect);
      ctx.translate(pos.x, pos.y);
      ctx.rotate((photo.rotation * Math.PI) / 180);
      if (photo.flip) ctx.scale(-1, 1);
      ctx.drawImage(
        asset.image,
        (-asset.width * pos.scale) / 2,
        (-asset.height * pos.scale) / 2,
        asset.width * pos.scale,
        asset.height * pos.scale,
      );
    }
    ctx.restore();
  });
}

export function hitTest(state, assets, x, y, width, height) {
  for (let i = state.photos.length - 1; i >= 0; i--) {
    const photo = state.photos[i];
    const rect = photoRect(state, photo, i, assets, width, height);
    let px = x - (rect.x + rect.w / 2);
    let py = y - (rect.y + rect.h / 2);
    if (state.mode === "free") {
      const angle = (-photo.free.rotation * Math.PI) / 180;
      [px, py] = [
        px * Math.cos(angle) - py * Math.sin(angle),
        px * Math.sin(angle) + py * Math.cos(angle),
      ];
    }
    if (Math.abs(px) <= rect.w / 2 && Math.abs(py) <= rect.h / 2)
      return photo.id;
  }
  return null;
}

export function arrangeFree(state, assets) {
  const width = 1000;
  const height = width / state.ratio;
  const rects = gridRects(state, width, height);
  state.photos.forEach((photo, i) => {
    if (photo.free) return;
    const asset = assets.get(photo.id);
    const rect = rects[i];
    const scale = Math.min(rect.w / asset.width, rect.h / asset.height) * 0.94;
    photo.free = {
      x: (rect.x + rect.w / 2) / width,
      y: (rect.y + rect.h / 2) / height,
      w: clamp((asset.width * scale) / width, 0.08, 1.5),
      rotation: photo.rotation,
    };
  });
}
