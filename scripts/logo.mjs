// Tiny PNG generator for the fictional customer logos (no dependencies).
// Each logo is a coloured square with a simple white shape.
import { deflateSync } from "node:zlib";

const SIZE = 200;

const SHAPES = {
  circle: (x, y) => (x - 100) ** 2 + (y - 100) ** 2 < 55 ** 2,
  ring: (x, y) => Math.max(Math.abs(x - 100), Math.abs(y - 100)) < 60 && Math.max(Math.abs(x - 100), Math.abs(y - 100)) > 38,
  diamond: (x, y) => Math.abs(x - 100) + Math.abs(y - 100) < 70,
  stripes: (x, y) => x > 40 && x < 160 && y > 40 && y < 160 && Math.floor((x + y) / 22) % 2 === 0,
  triangle: (x, y) => y > 50 && y < 150 && Math.abs(x - 100) < (y - 50) * 0.6,
};

export function logoPng(hexColor, shape) {
  const bg = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16));
  const inside = SHAPES[shape];
  const row = SIZE * 3 + 1;
  const raw = Buffer.alloc(row * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) raw.set(inside(x, y) ? [255, 255, 255] : bg, y * row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
