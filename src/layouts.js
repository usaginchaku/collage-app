export const MAX_PHOTOS = 12;
export const RATIOS = [
  ["1:1", 1, "正方形"],
  ["4:5", 4 / 5, "縦長"],
  ["3:4", 3 / 4, "縦長"],
  ["9:16", 9 / 16, "ストーリー"],
  ["4:3", 4 / 3, "横長"],
  ["3:2", 3 / 2, "横長"],
  ["16:9", 16 / 9, "ワイド"],
];
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function rows(count, rowCount) {
  let remaining = count;
  const cells = [];
  for (let row = 0; row < rowCount; row++) {
    const columns = Math.ceil(remaining / (rowCount - row));
    for (let col = 0; col < columns; col++) {
      cells.push({
        x: col / columns,
        y: row / rowCount,
        w: 1 / columns,
        h: 1 / rowCount,
      });
    }
    remaining -= columns;
  }
  return cells;
}

function transpose(cells) {
  return cells.map(({ x, y, w, h }) => ({ x: y, y: x, w: h, h: w }));
}

function hero(count, side, split) {
  const portrait = side === "left" || side === "right";
  const reverse = side === "right" || side === "bottom";
  let cells = [{ x: reverse ? 1 - split : 0, y: 0, w: split, h: 1 }];
  const others = rows(
    count - 1,
    Math.min(count - 1, Math.ceil(Math.sqrt(count - 1) * 1.25)),
  );
  cells = cells.concat(
    others.map((c) => ({
      x: (reverse ? 0 : split) + c.x * (1 - split),
      y: c.y,
      w: c.w * (1 - split),
      h: c.h,
    })),
  );
  return portrait ? cells : transpose(cells);
}

export function getLayouts(count, split = 0.6) {
  count = clamp(Math.round(count) || 1, 1, MAX_PHOTOS);
  if (count === 1) return [{ id: "single", name: "1枚", cells: rows(1, 1) }];
  const candidates = [];
  const ideal = Math.ceil(Math.sqrt(count));
  const rowCounts = [
    ...new Set([
      Math.max(1, Math.round(Math.sqrt(count))),
      ideal,
      1,
      count,
      2,
      3,
      4,
    ]),
  ].filter((n) => n <= count);
  for (const rowCount of rowCounts) {
    candidates.push({
      id: `rows-${rowCount}`,
      name:
        rowCount === 1
          ? "横に並べる"
          : rowCount === count
            ? "縦に並べる"
            : `${rowCount}段`,
      cells: rows(count, rowCount),
    });
    if (rowCount > 1 && rowCount < count)
      candidates.push({
        id: `cols-${rowCount}`,
        name: `${rowCount}列`,
        cells: transpose(rows(count, rowCount)),
      });
  }
  for (const [side, label] of [
    ["left", "左を大きく"],
    ["right", "右を大きく"],
    ["top", "上を大きく"],
    ["bottom", "下を大きく"],
  ]) {
    candidates.push({
      id: `hero-${side}`,
      name: label,
      adjustable: true,
      cells: hero(count, side, split),
    });
  }
  const seen = new Set();
  return candidates.filter((layout) => {
    // Keep adjustable template IDs stable when a 50:50 split matches a regular grid.
    if (layout.adjustable) return true;
    const key = JSON.stringify(
      layout.cells
        .map((c) => [c.x, c.y, c.w, c.h].map((v) => v.toFixed(4)))
        .sort(),
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getLayout(state) {
  const layouts = getLayouts(state.photos.length, state.split);
  return layouts.find((layout) => layout.id === state.layout) || layouts[0];
}

function frameKey(state) {
  return `${getLayout(state).id}:${state.photos.length}:${state.split}`;
}

export function getCells(state) {
  return state.frameLayout?.key === frameKey(state)
    ? state.frameLayout.cells
    : getLayout(state).cells;
}

// Only connect edges with a positive overlap. Edges meeting at a corner may
// move independently, so changing one row's width does not change every row.
export function frameResizeInfo(state, index, axis) {
  const cells = getCells(state);
  const cell = cells[index];
  if (!cell) return null;
  const [pos, size, cross, span] =
    axis === "w" ? ["x", "w", "y", "h"] : ["y", "h", "x", "w"];
  const epsilon = 1e-7;
  const atEnd = cell[pos] + cell[size] < 1 - epsilon;
  if (!atEnd && cell[pos] < epsilon) return null;
  const edge = cell[pos] + (atEnd ? cell[size] : 0);
  let low = cell[cross],
    high = low + cell[span];
  const connected = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    cells.forEach((c, i) => {
      const onEdge =
        Math.abs(c[pos] - edge) < epsilon ||
        Math.abs(c[pos] + c[size] - edge) < epsilon;
      if (
        connected.has(i) ||
        !onEdge ||
        c[cross] >= high - epsilon ||
        c[cross] + c[span] <= low + epsilon
      )
        return;
      connected.add(i);
      low = Math.min(low, c[cross]);
      high = Math.max(high, c[cross] + c[span]);
      grew = true;
    });
  }
  const starts = [],
    ends = [];
  let minDelta = -Infinity,
    maxDelta = Infinity;
  for (const i of connected) {
    const c = cells[i];
    if (Math.abs(c[pos] - edge) < epsilon) {
      starts.push(i);
      maxDelta = Math.min(maxDelta, c[size] - 0.035);
    } else {
      ends.push(i);
      minDelta = Math.max(minDelta, 0.035 - c[size]);
    }
  }
  return {
    pos,
    size,
    starts,
    ends,
    atEnd,
    value: cell[size],
    min: cell[size] + (atEnd ? minDelta : -maxDelta),
    max: cell[size] + (atEnd ? maxDelta : -minDelta),
  };
}

export function resizeFrame(state, index, axis, value) {
  const info = frameResizeInfo(state, index, axis);
  if (!info) return;
  const cells = getCells(state).map((c) => ({ ...c }));
  const delta =
    (clamp(value, info.min, info.max) - info.value) * (info.atEnd ? 1 : -1);
  for (const i of info.starts) {
    cells[i][info.pos] += delta;
    cells[i][info.size] -= delta;
  }
  for (const i of info.ends) cells[i][info.size] += delta;
  state.frameLayout = { key: frameKey(state), cells };
}

export function gridRects(state, width, height) {
  const base = Math.min(width, height);
  const margin = (base * state.margin) / 100;
  const gap = (base * state.gap) / 100;
  const areaW = width - 2 * margin;
  const areaH = height - 2 * margin;
  return getCells(state).map((c) => {
    // Each internal edge contributes half a gap; outside edges keep the requested margin.
    const left = c.x > 0.0001 ? gap / 2 : 0;
    const top = c.y > 0.0001 ? gap / 2 : 0;
    const right = c.x + c.w < 0.9999 ? gap / 2 : 0;
    const bottom = c.y + c.h < 0.9999 ? gap / 2 : 0;
    const rawW = c.w * areaW;
    const rawH = c.h * areaH;
    // Extreme strips must remain drawable even at the largest spacing.
    const scaleX = Math.min(1, (rawW * 0.8) / Math.max(left + right, 0.001));
    const scaleY = Math.min(1, (rawH * 0.8) / Math.max(top + bottom, 0.001));
    return {
      x: margin + c.x * areaW + left * scaleX,
      y: margin + c.y * areaH + top * scaleY,
      w: rawW - (left + right) * scaleX,
      h: rawH - (top + bottom) * scaleY,
    };
  });
}

export function outputSize(ratio, longEdge) {
  return ratio >= 1
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge / ratio)) }
    : { width: Math.max(1, Math.round(longEdge * ratio)), height: longEdge };
}

export function initialState() {
  return {
    version: 1,
    photos: [],
    mode: "grid",
    layout: "",
    ratio: 1,
    gap: 1.2,
    margin: 2.4,
    radius: 0,
    background: "#ffffff",
    backgroundImage: null,
    backgroundPattern: "none",
    watermark: {
      enabled: false,
      text: "",
      mode: "corner",
      opacity: 0.65,
      color: "#ffffff",
    },
    frameLayout: null,
    split: 0.6,
  };
}

export function newPhoto(id, name) {
  return {
    id,
    name,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flip: false,
    fit: "cover",
    free: null,
  };
}

export function resetCrop(photo) {
  Object.assign(photo, {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flip: false,
    fit: "cover",
  });
}
