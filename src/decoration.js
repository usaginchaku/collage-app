// Original geometric patterns, drawn at the same relative scale in previews and exports.
export function drawBackground(ctx, state, assets, width, height) {
  const image = assets.get(state.backgroundImage);
  if (image) {
    const scale = Math.max(width / image.width, height / image.height);
    ctx.drawImage(
      image.image,
      (width - image.width * scale) / 2,
      (height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    return;
  }
  const pattern = state.backgroundPattern;
  if (!pattern || pattern === "none") return;
  const step = Math.min(width, height) / 24;
  // White markings on dark backgrounds; muted ink on pale or transparent ones.
  const hex =
    state.background === "transparent" ? "ffffff" : state.background.slice(1);
  const luminance = [0.2126, 0.7152, 0.0722].reduce(
    (sum, weight, i) =>
      sum + weight * parseInt(hex.slice(i * 2, i * 2 + 2), 16),
    0,
  );
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = luminance < 128 ? "#ffffff" : "#655776";
  ctx.globalAlpha = 0.18;
  if (pattern === "dots") {
    ctx.beginPath();
    for (let y = step / 2; y < height; y += step)
      for (let x = step / 2; x < width; x += step) {
        ctx.moveTo(x + step * 0.12, y);
        ctx.arc(x, y, step * 0.12, 0, Math.PI * 2);
      }
    ctx.fill();
  } else if (pattern === "stripes") {
    ctx.lineWidth = step * 0.24;
    ctx.beginPath();
    for (let x = -height; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height, height);
    }
    ctx.stroke();
  } else if (pattern === "checks") {
    for (let y = 0, row = 0; y < height; y += step, row++)
      for (let x = (row % 2) * step; x < width; x += step * 2)
        ctx.fillRect(x, y, step, step);
  }
  ctx.restore();
}

export function drawWatermark(ctx, state, width, height) {
  const mark = state.watermark;
  const text = mark?.text?.trim();
  if (!mark?.enabled || !text) return;
  const base = Math.min(width, height);
  const repeating = mark.mode === "repeat";
  ctx.save();
  ctx.globalAlpha = mark.opacity;
  ctx.fillStyle = mark.color;
  ctx.strokeStyle = mark.color === "#000000" ? "#ffffff" : "#000000";
  let size = base * (repeating ? 0.05 : 0.035);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const maxWidth = base * (repeating ? 0.42 : 0.88);
  size *= Math.min(1, maxWidth / Math.max(1, ctx.measureText(text).width));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.lineWidth = Math.max(0.5, size * 0.045);
  ctx.lineJoin = "round";
  const draw = (x, y) => {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };
  if (repeating) {
    const extent = Math.hypot(width, height);
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const dx = base * 0.55,
      dy = base * 0.23;
    for (
      let row = -Math.ceil(extent / dy);
      row <= Math.ceil(extent / dy);
      row++
    )
      for (let x = -extent; x <= extent; x += dx)
        draw(x + ((Math.abs(row) % 2) * dx) / 2, row * dy);
  } else {
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    draw(width - base * 0.035, height - base * 0.03);
  }
  ctx.restore();
}
