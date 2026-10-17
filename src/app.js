import {
  MAX_PHOTOS,
  RATIOS,
  clamp,
  getLayouts,
  getLayout,
  outputSize,
  initialState,
  newPhoto,
  resetCrop,
} from "./layouts.js";
import {
  renderCollage,
  photoRect,
  imagePlacement,
  hitTest,
  arrangeFree,
} from "./render.js";
import { loadDraft, saveDraft } from "./storage.js";

const $ = (id) => document.getElementById(id);
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14" transform="translate(0 -2)"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>',
  images:
    '<rect x="6" y="3" width="15" height="16" rx="2"/><path d="M3 7v13a2 2 0 0 0 2 2h12m-11-7 4-4 4 4 3-3 4 4"/><circle cx="16" cy="8" r="1"/>',
  layout:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18m0-9h9"/>',
  frame:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  rotate: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  flip: '<path d="M12 3v2m0 4v2m0 4v2m0 4v.01M3 6l5 6-5 6V6Zm18 0-5 6 5 6V6Z"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  center:
    '<path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  new: '<path d="M13 3H5v18h14V9l-6-6Zm0 0v6h6M8 15h8m-4-4v8"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  share: '<path d="M12 15V2m-5 5 5-5 5 5M6 11H4v10h16V11h-2"/>',
};
document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[el.dataset.icon] || ""}</svg>`;
});

let state = initialState();
let selected = null;
let activeTab = "photos";
let assets = new Map();
let undoStack = [];
let redoStack = [];
let ready = false;
let importing = false;
let drawing = false;
let saveTimer;
let saveQueue = Promise.resolve();
let revision = 0;
let savedRevision = 0;
let storageFailed = false;
let toastTimer;
let sliderSnapshot = null;
let exportBlob = null;
let exportURL = null;
let exportSequence = 0;
const MAX_PIXELS = 40_000_000;
const canvas = $("collage");
const context = canvas.getContext("2d");
const snapshot = () => structuredClone(state);
const selectedPhoto = () => state.photos.find((photo) => photo.id === selected);

function showToast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3200);
}

function showError(message) {
  $("error-banner").querySelector("span").textContent = message;
  $("error-banner").hidden = false;
}
$("error-banner")
  .querySelector("button")
  .addEventListener("click", () => {
    $("error-banner").hidden = true;
  });

function pruneAssets() {
  const used = new Set(
    [state, ...undoStack, ...redoStack].flatMap((s) =>
      s.photos.map((p) => p.id),
    ),
  );
  for (const [id, asset] of assets)
    if (!used.has(id)) {
      URL.revokeObjectURL(asset.url);
      assets.delete(id);
    }
}

function remember(before) {
  if (JSON.stringify(before) === JSON.stringify(state)) return;
  undoStack.push(before);
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  pruneAssets();
  changed();
}

function change(action) {
  if (!ready || importing) return;
  const before = snapshot();
  action();
  remember(before);
  renderUI();
}

function changed() {
  revision++;
  $("draft-status").textContent = "保存中…";
  $("local-status").textContent = "下書きを保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
  updateHistory();
  requestDraw();
}

function persist() {
  clearTimeout(saveTimer);
  const currentRevision = revision;
  const currentState = snapshot();
  const currentAssets = new Map(assets);
  // Serialize writes so an older, slower save can never overwrite a new draft.
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => saveDraft(currentState, currentAssets))
    .then(() => {
      savedRevision = currentRevision;
      if (revision === currentRevision) {
        storageFailed = false;
        $("draft-status").textContent = state.photos.length
          ? "下書き保存済み"
          : "";
        $("local-status").textContent = "端末内に自動保存";
      }
    })
    .catch((error) => {
      console.warn("Draft save failed:", error.name, error.message);
      $("draft-status").textContent = "下書き未保存";
      $("local-status").textContent = "下書きを保存できません";
      if (!storageFailed)
        showError(
          "このブラウザに下書きを保存できませんでした。編集は続けられます。ページを閉じる前に完成画像を保存してください。",
        );
      storageFailed = true;
    });
  return saveQueue;
}

function updateHistory() {
  $("undo").disabled = !undoStack.length || importing;
  $("redo").disabled = !redoStack.length || importing;
  $("export-open").disabled = !state.photos.length || importing;
  $("new-collage").disabled = !state.photos.length || importing;
}

function history(direction) {
  if (importing || !ready) return;
  endGesture();
  const source = direction === "undo" ? undoStack : redoStack;
  const target = direction === "undo" ? redoStack : undoStack;
  if (!source.length) return;
  target.push(snapshot());
  state = source.pop();
  if (!selectedPhoto()) selected = state.photos[0]?.id || null;
  changed();
  renderUI();
}
$("undo").addEventListener("click", () => history("undo"));
$("redo").addEventListener("click", () => history("redo"));

function setTab(tab, focus = false) {
  const switched = activeTab !== tab;
  activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    $(`panel-${button.dataset.tab}`).hidden = !isActive;
  });
  if (switched) document.querySelector(".panels").scrollTop = 0;
  if (focus) $(`tab-${tab}`).focus();
}
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    const tabs = ["photos", "layout", "frame"];
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = tabs.indexOf(activeTab);
      setTab(
        event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs[2]
            : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3],
        true,
      );
    }
  });
});

function renderPhotos() {
  const list = $("photo-list");
  const ids = state.photos.map((p) => p.id).join(",");
  if (list.dataset.ids !== ids) {
    list.replaceChildren();
    for (const [index, photo] of state.photos.entries()) {
      const button = document.createElement("button");
      button.className = "photo-thumb";
      button.dataset.id = photo.id;
      button.setAttribute(
        "aria-label",
        `画像 ${index + 1} を選択: ${photo.name}`,
      );
      const img = document.createElement("img");
      img.src = assets.get(photo.id).url;
      img.alt = "";
      img.draggable = false;
      const number = document.createElement("span");
      number.textContent = index + 1;
      button.append(img, number);
      button.addEventListener("click", () => select(photo.id));
      list.append(button);
    }
    list.dataset.ids = ids;
  }
  list
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.id === selected),
      ),
    );
  $("photo-count").textContent = state.photos.length;
  $("photo-empty").hidden = !!state.photos.length;
  $("select-hint").hidden = !state.photos.length || !!selected;
  $("photo-controls").hidden = !selectedPhoto();
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.disabled = !ready || importing || state.photos.length >= MAX_PHOTOS;
  });
  renderPhotoControls();
}

function renderPhotoControls() {
  const photo = selectedPhoto();
  if (!photo) return;
  const free = state.mode === "free";
  const index = state.photos.indexOf(photo);
  $("selected-label").textContent = `画像 ${index + 1}`;
  $("zoom-label").textContent = free ? "大きさ" : "拡大";
  const zoom = $("photo-zoom");
  zoom.min = free ? "0.08" : "1";
  zoom.max = free ? "1.5" : "3";
  zoom.value = free ? photo.free.w : photo.zoom;
  $("zoom-value").textContent = `${Math.round(Number(zoom.value) * 100)}%`;
  $("free-rotation-row").hidden = !free;
  const angle = free ? photo.free.rotation : photo.rotation;
  $("photo-angle").value = angle > 180 ? angle - 360 : angle;
  $("angle-value").textContent = `${$("photo-angle").value}°`;
  $("fit-photo").hidden = free;
  $("flip-photo").setAttribute("aria-pressed", String(photo.flip));
  $("fit-photo").setAttribute("aria-pressed", String(photo.fit === "contain"));
  $("order-label").textContent = free ? "重なり順" : "並び順";
  $("move-back").disabled = index === 0;
  $("move-forward").disabled = index === state.photos.length - 1;
  for (const [id, label] of [
    ["move-back", free ? "画像を奥へ移動" : "画像を前の枠へ移動"],
    ["move-forward", free ? "画像を手前へ移動" : "画像を次の枠へ移動"],
  ]) {
    $(id).setAttribute("aria-label", label);
    $(id).title = label;
  }
}

function renderLayouts() {
  const current = getLayout(state);
  const layouts = getLayouts(state.photos.length, state.split);
  $("layout-list").replaceChildren();
  for (const layout of layouts) {
    const button = document.createElement("button");
    button.className = "layout-button";
    button.title = layout.name;
    button.dataset.layout = layout.id;
    button.setAttribute("aria-label", layout.name);
    button.setAttribute("aria-pressed", String(layout.id === current.id));
    button.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">${layout.cells.map((c) => `<rect x="${c.x * 100 + 2}" y="${c.y * 100 + 2}" width="${Math.max(1, c.w * 100 - 4)}" height="${Math.max(1, c.h * 100 - 4)}" rx="2"/>`).join("")}</svg>`;
    button.addEventListener("click", () =>
      change(() => {
        state.layout = layout.id;
      }),
    );
    $("layout-list").append(button);
  }
  $("layout-count").textContent = `${state.photos.length || 1}枚用`;
  $("split-row").hidden = !current.adjustable;
  $("split").value = state.split * 100;
  $("split-value").textContent = `${Math.round(state.split * 100)}%`;
  const free = state.mode === "free";
  $("mode-grid").setAttribute("aria-pressed", String(!free));
  $("mode-free").setAttribute("aria-pressed", String(free));
  $("grid-options").hidden = free;
  $("free-hint").hidden = !free;
  $("grid-spacing").hidden = free;
  $("ratio-list")
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.ratio) === state.ratio),
      ),
    );
  const ratio = RATIOS.find((r) => r[1] === state.ratio) || RATIOS[0];
  $("ratio-name").textContent = ratio[2];
  $("canvas-ratio").textContent = ratio[0].replace(":", " : ");
}

function renderFrame() {
  for (const key of ["gap", "margin", "radius"]) {
    $(key).value = state[key];
    $(`${key}-value`).textContent = Number(state[key].toFixed(1));
  }
  if (state.background !== "transparent")
    $("background-color").value = state.background;
  $("color-list")
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.color === state.background),
      ),
    );
}

function renderUI() {
  const hasPhotos = !!state.photos.length;
  $("empty-state").hidden = hasPhotos;
  $("canvas-wrap").hidden = !hasPhotos;
  $("canvas-label").textContent = hasPhotos
    ? `${state.photos.length}枚のコラージュ`
    : "プレビュー";
  $("deselect").hidden = !selected;
  $("gesture-hint").textContent = !hasPhotos
    ? "画像はこの端末内で編集されます"
    : selected
      ? state.mode === "free"
        ? "ドラッグで移動 · 2本指で拡大・回転"
        : "ドラッグで位置調整 · 2本指で拡大"
      : "画像を選んで調整";
  updateHistory();
  renderPhotos();
  renderLayouts();
  renderFrame();
  resizeCanvas();
}

function select(id, openPanel = true) {
  selected = id;
  if (openPanel && id) setTab("photos");
  renderPhotos();
  $("deselect").hidden = !id;
  $("gesture-hint").textContent = id
    ? state.mode === "free"
      ? "ドラッグで移動 · 2本指で拡大・回転"
      : "ドラッグで位置調整 · 2本指で拡大"
    : "画像を選んで調整";
  drawSelection();
}
$("deselect").addEventListener("click", () => select(null, false));

function resizeCanvas() {
  if (!state.photos.length) return;
  const area = $("preview-area").getBoundingClientRect();
  const w = Math.max(1, Math.min(area.width, area.height * state.ratio));
  const h = w / state.ratio;
  $("canvas-wrap").style.width = `${w}px`;
  $("canvas-wrap").style.height = `${h}px`;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * pixelRatio);
  canvas.height = Math.round(h * pixelRatio);
  requestDraw();
}
new ResizeObserver(resizeCanvas).observe($("preview-area"));

function requestDraw() {
  if (drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    if (state.photos.length)
      renderCollage(context, state, assets, canvas.width, canvas.height);
    drawSelection();
  });
}

function drawSelection() {
  const photo = selectedPhoto();
  $("selection").hidden = !photo;
  if (!photo || !canvas.clientWidth) return;
  const rect = photoRect(
    state,
    photo,
    state.photos.indexOf(photo),
    assets,
    canvas.clientWidth,
    canvas.clientHeight,
  );
  Object.assign($("selection").style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    transform: `rotate(${state.mode === "free" ? photo.free.rotation : 0}deg)`,
    borderRadius: `${(Math.min(canvas.clientWidth, canvas.clientHeight) * state.radius) / 100}px`,
  });
  $("selection-number").textContent = state.photos.indexOf(photo) + 1;
}

for (const [label, ratio] of RATIOS) {
  const button = document.createElement("button");
  button.className = "ratio-button";
  button.dataset.ratio = ratio;
  button.setAttribute("aria-label", `縦横比 ${label}`);
  const size = outputSize(ratio, 20);
  button.innerHTML = `<span class="ratio-shape"><span style="width:${size.width}px;height:${size.height}px"></span></span><span>${label}</span>`;
  button.addEventListener("click", () =>
    change(() => {
      state.ratio = ratio;
    }),
  );
  $("ratio-list").append(button);
}

for (const [color, name] of [
  ["#ffffff", "白"],
  ["#f6f0e7", "アイボリー"],
  ["#e8deef", "ラベンダー"],
  ["#f3dce0", "ピンク"],
  ["#dce6d9", "セージ"],
  ["#dce8ef", "ブルー"],
  ["#38343c", "チャコール"],
  ["#000000", "黒"],
  ["transparent", "透明"],
]) {
  const button = document.createElement("button");
  button.className = `color-button${color === "transparent" ? " transparent" : ""}`;
  button.dataset.color = color;
  if (color !== "transparent") button.style.backgroundColor = color;
  button.setAttribute("aria-label", `背景色 ${name}`);
  button.title = name;
  button.addEventListener("click", () =>
    change(() => {
      state.background = color;
    }),
  );
  $("color-list").append(button);
}

function setMode(mode) {
  change(() => {
    if (mode === state.mode) return;
    if (mode === "free") arrangeFree(state, assets);
    state.mode = mode;
  });
}
$("mode-grid").addEventListener("click", () => setMode("grid"));
$("mode-free").addEventListener("click", () => setMode("free"));

function bindSlider(id, apply, refresh) {
  const element = $(id);
  element.addEventListener("input", () => {
    if (!ready || importing) return;
    if (!sliderSnapshot) sliderSnapshot = snapshot();
    apply(Number(element.value));
    refresh();
    requestDraw();
  });
  const commit = () => {
    if (!sliderSnapshot) return;
    const before = sliderSnapshot;
    sliderSnapshot = null;
    remember(before);
  };
  element.addEventListener("change", commit);
  element.addEventListener("blur", commit);
  element.addEventListener("pointercancel", commit);
}
for (const key of ["gap", "margin", "radius"])
  bindSlider(
    key,
    (value) => {
      state[key] = value;
    },
    renderFrame,
  );
bindSlider(
  "split",
  (value) => {
    state.split = value / 100;
  },
  renderLayouts,
);
bindSlider(
  "photo-zoom",
  (value) => {
    const photo = selectedPhoto();
    if (photo)
      state.mode === "free" ? (photo.free.w = value) : (photo.zoom = value);
  },
  renderPhotoControls,
);
bindSlider(
  "photo-angle",
  (value) => {
    if (selectedPhoto()) selectedPhoto().free.rotation = value;
  },
  renderPhotoControls,
);
$("background-color").addEventListener("input", (event) => {
  if (!ready || importing) return;
  if (!sliderSnapshot) sliderSnapshot = snapshot();
  state.background = event.target.value;
  renderFrame();
  requestDraw();
});
$("background-color").addEventListener("change", () => {
  if (sliderSnapshot) {
    const before = sliderSnapshot;
    sliderSnapshot = null;
    remember(before);
  }
});

function editPhoto(action) {
  change(() => {
    if (selectedPhoto()) action(selectedPhoto());
  });
}
$("rotate-photo").addEventListener("click", () =>
  editPhoto((photo) => {
    const target = state.mode === "free" ? photo.free : photo;
    target.rotation = (target.rotation + 90 + 360) % 360;
  }),
);
$("flip-photo").addEventListener("click", () =>
  editPhoto((photo) => {
    photo.flip = !photo.flip;
  }),
);
$("fit-photo").addEventListener("click", () =>
  editPhoto((photo) => {
    photo.fit = photo.fit === "cover" ? "contain" : "cover";
    photo.zoom = 1;
    photo.offsetX = 0;
    photo.offsetY = 0;
  }),
);
$("center-photo").addEventListener("click", () =>
  editPhoto((photo) => {
    if (state.mode === "free") {
      photo.free.x = 0.5;
      photo.free.y = 0.5;
    } else {
      photo.offsetX = 0;
      photo.offsetY = 0;
    }
  }),
);
$("reset-photo").addEventListener("click", () =>
  editPhoto((photo) => {
    resetCrop(photo);
    if (state.mode === "free") {
      photo.free = null;
      arrangeFree(state, assets);
    }
  }),
);
function reorder(delta) {
  change(() => {
    const index = state.photos.findIndex((photo) => photo.id === selected);
    if (index < 0 || index + delta < 0 || index + delta >= state.photos.length)
      return;
    [state.photos[index], state.photos[index + delta]] = [
      state.photos[index + delta],
      state.photos[index],
    ];
  });
}
$("move-back").addEventListener("click", () => reorder(-1));
$("move-forward").addEventListener("click", () => reorder(1));
$("remove-photo").addEventListener("click", () =>
  change(() => {
    const index = state.photos.findIndex((photo) => photo.id === selected);
    if (index < 0) return;
    state.photos.splice(index, 1);
    selected =
      state.photos[Math.min(index, state.photos.length - 1)]?.id || null;
    state.layout = getLayout(state).id;
  }),
);

// One history entry covers the whole drag or pinch, regardless of pointer count.
const pointers = new Map();
let gesture = null;
function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  };
}
function startSegment() {
  const points = [...pointers.values()];
  if (!gesture || !points.length) return;
  gesture.points = points.map((p) => ({ ...p }));
  gesture.photo = structuredClone(selectedPhoto());
}
canvas.addEventListener("pointerdown", (event) => {
  if (
    !ready ||
    importing ||
    (event.pointerType === "mouse" && event.button !== 0)
  )
    return;
  event.preventDefault();
  const point = pointerPosition(event);
  if (!pointers.size) {
    const id = hitTest(
      state,
      assets,
      point.x * canvas.clientWidth,
      point.y * canvas.clientHeight,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    select(id);
    if (!id) return;
    gesture = { before: snapshot() };
    canvas.focus({ preventScroll: true });
  }
  if (!gesture || pointers.size >= 2) return;
  pointers.set(event.pointerId, point);
  canvas.setPointerCapture(event.pointerId);
  startSegment();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId) || !gesture) return;
  event.preventDefault();
  pointers.set(event.pointerId, pointerPosition(event));
  const points = [...pointers.values()];
  const original = gesture.points;
  const photo = selectedPhoto();
  const initial = gesture.photo;
  if (!photo || !initial) return;
  const midpoint = (p) =>
    p.length === 1
      ? p[0]
      : { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  const start = midpoint(original);
  const now = midpoint(points);
  const dx = now.x - start.x;
  const dy = now.y - start.y;
  const distance = (p) =>
    Math.hypot(
      (p[1].x - p[0].x) * canvas.clientWidth,
      (p[1].y - p[0].y) * canvas.clientHeight,
    );
  if (points.length === 2 && original.length === 2) {
    const factor = distance(points) / Math.max(1, distance(original));
    if (state.mode === "free") {
      photo.free.w = clamp(initial.free.w * factor, 0.08, 1.5);
      const angle = (p) =>
        Math.atan2(
          (p[1].y - p[0].y) * canvas.clientHeight,
          (p[1].x - p[0].x) * canvas.clientWidth,
        );
      const degrees =
        initial.free.rotation +
        ((angle(points) - angle(original)) * 180) / Math.PI;
      photo.free.rotation = ((degrees + 540) % 360) - 180;
    } else photo.zoom = clamp(initial.zoom * factor, 1, 3);
  }
  if (state.mode === "free") {
    photo.free.x = clamp(initial.free.x + dx, 0, 1);
    photo.free.y = clamp(initial.free.y + dy, 0, 1);
  } else {
    const rect = photoRect(
      state,
      photo,
      state.photos.indexOf(photo),
      assets,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    const placement = imagePlacement(photo, assets.get(photo.id), rect);
    photo.offsetX = placement.overflowX
      ? clamp(
          initial.offsetX + (dx * canvas.clientWidth) / placement.overflowX,
          -1,
          1,
        )
      : 0;
    photo.offsetY = placement.overflowY
      ? clamp(
          initial.offsetY + (dy * canvas.clientHeight) / placement.overflowY,
          -1,
          1,
        )
      : 0;
  }
  renderPhotoControls();
  requestDraw();
});

function endGesture() {
  if (!gesture) return;
  const before = gesture.before;
  gesture = null;
  for (const id of pointers.keys())
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  pointers.clear();
  remember(before);
}
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(type, (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size) startSegment();
    else endGesture();
  });
window.addEventListener("blur", endGesture);

canvas.addEventListener("keydown", (event) => {
  if (
    !selectedPhoto() ||
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  event.preventDefault();
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const step = (event.shiftKey ? 0.1 : 0.02) * sign;
  editPhoto((photo) => {
    if (state.mode === "free") {
      const key = horizontal ? "x" : "y";
      photo.free[key] = clamp(photo.free[key] + step, 0, 1);
    } else {
      const key = horizontal ? "offsetX" : "offsetY";
      photo[key] = clamp(photo[key] + step, -1, 1);
    }
  });
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.matches("input, select, textarea") ||
    document.querySelector("dialog[open]")
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    history(event.shiftKey ? "redo" : "undo");
  }
});

async function decode(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("画像サイズを読み取れませんでした。");
    return {
      image,
      blob,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(target, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    target.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("画像を作成できませんでした。")),
      type,
      quality,
    );
  });
}

async function importImage(file) {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("1枚50MB以下の画像を選んでください。");
  if (/svg|html|pdf/i.test(file.type) || /\.(svg|html?|pdf)$/i.test(file.name))
    throw new Error("JPEG・PNGなどの画像を選んでください。");
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error(
      /heic|heif/i.test(file.type + file.name)
        ? "このブラウザではHEIC / HEIFを開けません。JPEG・PNGに変換してください。"
        : "画像として読み込めませんでした。JPEG・PNGなどを選んでください。",
    );
  }
  const used = [...assets.values()].reduce(
    (sum, a) => sum + a.width * a.height,
    0,
  );
  const budget = Math.min(8_000_000, MAX_PIXELS - used);
  if (budget < 250_000) {
    URL.revokeObjectURL(source.url);
    throw new Error(
      "編集に使う画像の容量が上限に達しました。完成画像を保存してから「新しく作る」を選んでください。",
    );
  }
  const scale = Math.min(
    1,
    4096 / Math.max(source.width, source.height),
    Math.sqrt(budget / (source.width * source.height)),
  );
  const buffer = document.createElement("canvas");
  buffer.width = Math.max(1, Math.floor(source.width * scale));
  buffer.height = Math.max(1, Math.floor(source.height * scale));
  try {
    const ctx = buffer.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.image, 0, 0, buffer.width, buffer.height);
    // Normalize orientation and freeze animations before both preview and persistence.
    const blob = await canvasBlob(
      buffer,
      file.type === "image/jpeg" ? "image/jpeg" : "image/png",
      0.97,
    );
    return await decode(blob);
  } finally {
    URL.revokeObjectURL(source.url);
    buffer.width = buffer.height = 1;
  }
}

async function addFiles(files) {
  if (!ready || importing || !files.length) return;
  const available = MAX_PHOTOS - state.photos.length;
  if (!available) {
    showError("画像は12枚までです。画像を削除してから追加してください。");
    return;
  }
  endGesture();
  importing = true;
  updateHistory();
  renderPhotos();
  const before = snapshot();
  const failures = [];
  let added = 0;
  for (const file of [...files].slice(0, available)) {
    $("draft-status").textContent = `画像を読み込み中… ${++added}`;
    $("local-status").textContent = "画像を読み込み中…";
    try {
      const asset = await importImage(file);
      const id = crypto.randomUUID();
      assets.set(id, asset);
      state.photos.push(newPhoto(id, file.name));
      if (state.mode === "free") arrangeFree(state, assets);
      selected = id;
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
  if (files.length > available)
    failures.push("画像は12枚までのため、超えた分は追加していません。");
  state.layout = getLayout(state).id;
  if (state.mode === "free") arrangeFree(state, assets);
  importing = false;
  remember(before);
  setTab("photos");
  renderUI();
  const count = state.photos.length - before.photos.length;
  if (count) showToast(`${count}枚の画像を追加しました`);
  else {
    $("draft-status").textContent = state.photos.length ? "下書き保存済み" : "";
    $("local-status").textContent = "端末内に自動保存";
  }
  if (failures.length) showError(failures.join(" / "));
}

document
  .querySelectorAll("[data-add]")
  .forEach((button) =>
    button.addEventListener("click", () => $("file-input").click()),
  );
$("file-input").addEventListener("change", async (event) => {
  await addFiles(event.target.files);
  event.target.value = "";
});
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  $("drop-overlay").hidden = false;
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("drop-overlay").hidden = true;
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (!document.querySelector("dialog[open]"))
    addFiles(event.dataTransfer.files);
});

document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
$("help-open").addEventListener("click", () => $("help-dialog").showModal());
$("new-collage").addEventListener("click", () => $("new-dialog").showModal());
$("confirm-new").addEventListener("click", async () => {
  endGesture();
  state = initialState();
  selected = null;
  undoStack = [];
  redoStack = [];
  pruneAssets();
  $("new-dialog").close();
  $("error-banner").hidden = true;
  setTab("photos");
  changed();
  renderUI();
  await persist();
});

function exportFile() {
  const ext = $("export-format").value === "image/jpeg" ? "jpg" : "png";
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return new File([exportBlob], `collage-${stamp}.${ext}`, {
    type: exportBlob.type,
  });
}

async function prepareExport() {
  const sequence = ++exportSequence;
  exportBlob = null;
  $("download").disabled = true;
  $("share").disabled = true;
  $("export-error").hidden = true;
  $("export-info").textContent = "画像を準備中…";
  const type = $("export-format").value;
  const { width, height } = outputSize(
    state.ratio,
    Number($("export-size").value),
  );
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  try {
    renderCollage(target.getContext("2d"), state, assets, width, height, {
      jpeg: type === "image/jpeg",
    });
    const blob = await canvasBlob(target, type, 0.95);
    if (sequence !== exportSequence || !$("export-dialog").open) return;
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportBlob = blob;
    exportURL = URL.createObjectURL(blob);
    $("export-image").src = exportURL;
    $("export-info").textContent =
      `${width} × ${height} px · ${(blob.size / 1024 / 1024).toFixed(1)} MB${type === "image/jpeg" && state.background === "transparent" ? " · 透明部分は白になります" : ""}`;
    $("download").disabled = false;
    const file = exportFile();
    const canShare =
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });
    $("share").hidden = !canShare;
    $("share").disabled = !canShare;
  } catch {
    if (sequence !== exportSequence) return;
    $("export-info").textContent = "";
    $("export-error").textContent =
      "画像を作れませんでした。長い辺を小さくして、もう一度お試しください。";
    $("export-error").hidden = false;
  } finally {
    target.width = target.height = 1;
  }
}
$("export-open").addEventListener("click", () => {
  endGesture();
  $("export-dialog").showModal();
  prepareExport();
});
$("export-format").addEventListener("change", prepareExport);
$("export-size").addEventListener("change", prepareExport);
$("export-dialog").addEventListener("close", () => {
  exportSequence++;
});
$("download").addEventListener("click", () => {
  if (!exportBlob) return;
  const link = document.createElement("a");
  link.href = exportURL;
  link.download = exportFile().name;
  document.body.append(link);
  link.click();
  link.remove();
  showToast("ダウンロードを開始しました");
});
$("share").addEventListener("click", async () => {
  if (!exportBlob) return;
  try {
    await navigator.share({ files: [exportFile()] });
  } catch (error) {
    if (error.name !== "AbortError") {
      $("export-error").textContent =
        "共有できませんでした。「ダウンロード」または画像の長押しから保存してください。";
      $("export-error").hidden = false;
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && ready && revision !== savedRevision) persist();
});
window.addEventListener("beforeunload", (event) => {
  if (
    importing ||
    (state.photos.length && (revision !== savedRevision || storageFailed))
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function initialize() {
  renderPhotos();
  try {
    const draft = await loadDraft();
    if (
      draft?.state?.version === 1 &&
      Array.isArray(draft.state.photos) &&
      draft.state.photos.length <= MAX_PHOTOS &&
      Array.isArray(draft.images)
    ) {
      const restored = new Map();
      try {
        for (const stored of draft.images)
          restored.set(
            stored.id,
            await decode(
              stored.bytes
                ? new Blob([stored.bytes], { type: stored.type })
                : stored.blob,
            ),
          );
        if (draft.state.photos.some((photo) => !restored.has(photo.id)))
          throw new Error("Missing image");
        assets = restored;
        state = draft.state;
        selected = null;
        if (state.photos.length) showToast("前回の続きから編集できます");
      } catch (error) {
        for (const asset of restored.values()) URL.revokeObjectURL(asset.url);
        throw error;
      }
    }
  } catch {
    storageFailed = true;
    showError(
      "下書きを読み込めませんでした。新しく編集できますが、完成画像はページを閉じる前に保存してください。",
    );
  }
  ready = true;
  $("draft-status").textContent = storageFailed
    ? "下書きを確認してください"
    : state.photos.length
      ? "下書き保存済み"
      : "";
  $("local-status").textContent = storageFailed
    ? "下書きを確認してください"
    : "端末内に自動保存";
  renderUI();
}
initialize();
