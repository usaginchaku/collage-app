import { deflateSync } from "node:zlib";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, body])));
  return Buffer.concat([length, tag, body, crc]);
}
export function png(width, height, color, alpha = 255) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 4 + 1) + 1 + x * 4;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
      raw[i + 3] = alpha;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export const fixtures = [
  {
    name: "red-landscape.png",
    mimeType: "image/png",
    buffer: png(600, 400, [230, 60, 70]),
  },
  {
    name: "blue-portrait.png",
    mimeType: "image/png",
    buffer: png(400, 600, [40, 120, 220]),
  },
  {
    name: "green-square.png",
    mimeType: "image/png",
    buffer: png(500, 500, [70, 160, 100]),
  },
];
