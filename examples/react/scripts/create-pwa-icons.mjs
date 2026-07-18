import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createIcon(size) {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  const colors = {
    background: [21, 35, 31, 255],
    accent: [15, 118, 110, 255],
    white: [246, 245, 239, 255],
  };

  const paint = (x, y, color) => {
    const offset = y * stride + 1 + x * 4;
    pixels.set(color, offset);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const inAccent = Math.hypot(nx - 0.5, ny - 0.5) < 0.35;
      const inTop = nx > 0.29 && nx < 0.71 && ny > 0.3 && ny < 0.42;
      const inStem = nx > 0.445 && nx < 0.555 && ny >= 0.4 && ny < 0.72;
      paint(x, y, inTop || inStem ? colors.white : inAccent ? colors.accent : colors.background);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputDirectory = path.resolve("public/icons");
await mkdir(outputDirectory, { recursive: true });

for (const size of [192, 512]) {
  await writeFile(path.join(outputDirectory, `icon-${size}.png`), createIcon(size));
}

console.log(`Created PWA icons in ${outputDirectory}`);
