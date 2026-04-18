// Generates src/assets/system-tray-icon-muted.png from the original tray icon.
// Reads original pixel data, blends a red overlay, writes new PNG.
// Run once: node scripts/create-muted-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '../src/assets/system-tray-icon.png');
const DST = path.join(__dirname, '../src/assets/system-tray-icon-muted.png');

// --- Minimal PNG decoder (RGBA only) ---
function readUint32BE(buf, offset) {
  return ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  return (~crc) >>> 0;
}

function parsePNG(buf) {
  // verify signature
  const SIG = [137,80,78,71,13,10,26,10];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('Not a PNG');

  let pos = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (pos < buf.length) {
    const len = readUint32BE(buf, pos); pos += 4;
    const type = buf.slice(pos, pos+4).toString('ascii'); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len;
    pos += 4; // skip CRC

    if (type === 'IHDR') {
      width = readUint32BE(data, 0);
      height = readUint32BE(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (colorType !== 6) throw new Error(`Unsupported colorType: ${colorType} (need RGBA/6)`);
  if (bitDepth !== 8) throw new Error(`Unsupported bitDepth: ${bitDepth}`);

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);

  const bytesPerRow = 1 + width * 4;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * bytesPerRow];
    const rowSrc = raw.slice(y * bytesPerRow + 1, y * bytesPerRow + 1 + width * 4);
    const prevRow = y > 0 ? pixels.slice((y-1) * width * 4, y * width * 4) : Buffer.alloc(width * 4);
    const rowDst = pixels.slice(y * width * 4, (y+1) * width * 4);

    for (let x = 0; x < width * 4; x++) {
      const a = rowSrc[x];
      const b = prevRow[x] || 0;
      const c_left = x >= 4 ? rowDst[x - 4] : 0;
      const c_upleft = x >= 4 && y > 0 ? prevRow[x - 4] : 0;
      switch (filterType) {
        case 0: rowDst[x] = a; break;
        case 1: rowDst[x] = (a + c_left) & 0xFF; break;
        case 2: rowDst[x] = (a + b) & 0xFF; break;
        case 3: rowDst[x] = (a + Math.floor((c_left + b) / 2)) & 0xFF; break;
        case 4: {
          const p = c_left + b - c_upleft;
          const pa = Math.abs(p - c_left), pb = Math.abs(p - b), pc = Math.abs(p - c_upleft);
          const pr = pa <= pb && pa <= pc ? c_left : pb <= pc ? b : c_upleft;
          rowDst[x] = (a + pr) & 0xFF;
          break;
        }
      }
    }
  }

  return { width, height, pixels };
}

// --- Minimal PNG encoder (RGBA) ---
function encodePNG(width, height, pixels) {
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // no filter
    for (let x = 0; x < width * 4; x++) rawRows.push(pixels[y * width * 4 + x]);
  }
  const idat = zlib.deflateSync(Buffer.from(rawRows));

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Main ---
const src = fs.readFileSync(SRC);
const { width, height, pixels } = parsePNG(src);

// Apply red overlay: boost red channel, dim green/blue, keep alpha
const out = Buffer.from(pixels);
for (let i = 0; i < width * height; i++) {
  const base = i * 4;
  const a = out[base + 3];
  if (a === 0) continue;

  // desaturate then tint red
  const r = out[base], g = out[base+1], b = out[base+2];
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  out[base]   = Math.min(255, Math.round(gray * 0.4 + 180)); // push red
  out[base+1] = Math.round(gray * 0.3);                      // dim green
  out[base+2] = Math.round(gray * 0.3);                      // dim blue
}

fs.writeFileSync(DST, encodePNG(width, height, out));
console.log(`Written: ${DST}`);
