export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 60_000_000;
const MAX_SOURCE_EDGE = 32768;

export function checkDimensions(width, height, maxPixels = MAX_SOURCE_PIXELS) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("画像サイズを読み取れませんでした。");
  if (
    width > MAX_SOURCE_EDGE ||
    height > MAX_SOURCE_EDGE ||
    width * height > maxPixels
  )
    throw new Error(
      "画像が大きすぎます。6000万画素・一辺32768px以下に縮小してください。",
    );
}

// Inspect bytes, not the filename or caller-supplied MIME type. The browser still
// decodes and re-encodes the image; a signature alone does not establish safety.
export function inspectRaster(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 12 ||
    bytes.length > MAX_FILE_BYTES
  )
    throw new Error(
      "読み込めませんでした。1枚50MB以下の画像を選んでください。",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, size) =>
    String.fromCharCode(...bytes.subarray(start, start + size));
  const result = (type, width, height) => {
    checkDimensions(width, height);
    return { type, width, height };
  };
  if (
    bytes[0] === 137 &&
    text(1, 7) === "PNG\r\n\x1a\n" &&
    bytes.length >= 33 &&
    view.getUint32(8) === 13 &&
    text(12, 4) === "IHDR"
  )
    return result("image/png", view.getUint32(16), view.getUint32(20));
  if (["GIF87a", "GIF89a"].includes(text(0, 6)))
    return result(
      "image/gif",
      view.getUint16(6, true),
      view.getUint16(8, true),
    );
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8) break;
        return result(
          "image/jpeg",
          view.getUint16(offset + 5),
          view.getUint16(offset + 3),
        );
      }
      offset += size;
    }
  }
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const end = view.getUint32(4, true) + 8;
    if (end <= bytes.length)
      for (let offset = 12; offset + 8 <= end; ) {
        const kind = text(offset, 4),
          size = view.getUint32(offset + 4, true),
          start = offset + 8;
        if (size > end - start) break;
        if (kind === "VP8X" && size >= 10) {
          const u24 = (n) =>
            bytes[n] + bytes[n + 1] * 256 + bytes[n + 2] * 65536;
          return result("image/webp", u24(start + 4) + 1, u24(start + 7) + 1);
        }
        if (
          kind === "VP8 " &&
          size >= 10 &&
          text(start + 3, 3) === "\x9d\x01\x2a"
        )
          return result(
            "image/webp",
            view.getUint16(start + 6, true) & 0x3fff,
            view.getUint16(start + 8, true) & 0x3fff,
          );
        if (kind === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
          const bits = view.getUint32(start + 1, true);
          return result(
            "image/webp",
            (bits & 0x3fff) + 1,
            ((bits >>> 14) & 0x3fff) + 1,
          );
        }
        offset = start + size + (size % 2);
      }
  }
  // AVIF / HEIF dimensions live in bounded ISO-BMFF property boxes, not at a
  // fixed offset. Never scan compressed mdat payloads for accidental signatures.
  if (text(4, 4) === "ftyp") {
    const boxSize = view.getUint32(0);
    if (boxSize >= 16 && boxSize <= Math.min(bytes.length, 4096)) {
      const brands = [text(8, 4)];
      for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(text(i, 4));
      const type = brands.some((b) => ["avif", "avis"].includes(b))
        ? "image/avif"
        : brands.some((b) =>
              ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(b),
            )
          ? "image/heic"
          : null;
      let dimensions = null,
        boxes = 0;
      function walk(start, end, depth) {
        if (depth > 6) throw new Error("画像の構造を確認できませんでした。");
        for (let offset = start; offset + 8 <= end; ) {
          if (++boxes > 4096) throw new Error("画像の構造が複雑すぎます。");
          let size = view.getUint32(offset),
            header = 8;
          const kind = text(offset + 4, 4);
          if (size === 1) {
            if (offset + 16 > end || view.getUint32(offset + 8) !== 0)
              throw new Error("画像の構造を確認できませんでした。");
            size = view.getUint32(offset + 12);
            header = 16;
          }
          if (size === 0) size = end - offset;
          if (size < header || size > end - offset)
            throw new Error("画像の構造を確認できませんでした。");
          const data = offset + header;
          if (kind === "ispe" && size >= header + 12) {
            const next = result(
              type,
              view.getUint32(data + 4),
              view.getUint32(data + 8),
            );
            if (
              !dimensions ||
              next.width * next.height > dimensions.width * dimensions.height
            )
              dimensions = next;
          }
          if (["meta", "iprp", "ipco"].includes(kind))
            walk(data + (kind === "meta" ? 4 : 0), offset + size, depth + 1);
          offset += size;
        }
      }
      if (type) {
        walk(0, bytes.length, 0);
        if (dimensions) return dimensions;
      }
    }
  }
  throw new Error(
    "画像として読み込めませんでした。JPEG・PNG・WebP・GIF・AVIF・HEICなどの画像を選んでください。SVGやHTMLは使用できません。",
  );
}

export async function inspectImage(blob) {
  if (!(blob instanceof Blob) || blob.size > MAX_FILE_BYTES)
    throw new Error("1枚50MB以下の画像を選んでください。");
  return inspectRaster(new Uint8Array(await blob.arrayBuffer()));
}
