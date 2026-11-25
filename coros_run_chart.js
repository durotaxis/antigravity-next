// Render the same two COROS FIT minute-series comparisons as the legacy view.
// Runs on the server, without a browser, a font package or a network chart service.
const zlib = require('zlib');

const WIDTH = 1120;
const HEIGHT = 760;
const FONT = {
  ' ': ['00000'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '/': ['00001','00001','00010','00100','01000','10000','10000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000']
};

const BG = [16, 21, 30];
const WHITE = [225, 231, 241];
const GRID = [99, 107, 122];
const CYAN = [0, 242, 255];
const PINK = [255, 0, 85];
const GREEN = [122, 240, 184];
const GOLD = [255, 209, 102];
const PURPLE = [192, 132, 252];

function renderCorosRunChartPng(rows) {
  const points = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      t: Number(row && row.bucketStartMs),
      coverage: Number(row && row.coverageSeconds) > 0 ? Number(row.coverageSeconds) : 60,
      stride: positive(row && row.stride),
      heartRate: positive(row && row.heartRate),
      speed: positive(row && row.speed),
      pitch: positive(row && row.pitch),
      altitude: validNumber(row && row.altitude)
    }))
    .filter((point) => Number.isFinite(point.t) && point.t > 0)
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error('Cannot render COROS FIT chart without minute timestamps');

  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BG[0]; pixels[i + 1] = BG[1]; pixels[i + 2] = BG[2]; pixels[i + 3] = 255;
  }
  const dot = (x, y, color, opacity = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const at = (y * WIDTH + x) * 4;
    if (opacity >= 1) {
      pixels[at] = color[0]; pixels[at + 1] = color[1]; pixels[at + 2] = color[2];
    } else {
      const inv = 1 - opacity;
      for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(pixels[at + c] * inv + color[c] * opacity);
    }
  };
  const line = (x0, y0, x1, y1, color, radius = 0, opacity = 1) => {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const fraction = steps ? i / steps : 0;
      const x = x0 + (x1 - x0) * fraction;
      const y = y0 + (y1 - y0) * fraction;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) dot(x + dx, y + dy, color, opacity);
      }
    }
  };
  const text = (x, y, message, color = WHITE, scale = 2) => {
    const characters = String(message).toUpperCase();
    for (let i = 0; i < characters.length; i++) {
      const glyph = FONT[characters[i]] || FONT[' '];
      for (let gy = 0; gy < glyph.length; gy++) {
        for (let gx = 0; gx < glyph[gy].length; gx++) {
          if (glyph[gy][gx] !== '1') continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) dot(x + i * 6 * scale + gx * scale + dx, y + gy * scale + dy, color);
          }
        }
      }
    }
  };

  const tMin = points[0].t;
  const tMax = Math.max(tMin + 60000, ...points.map((p) => p.t + p.coverage * 1000));
  const timeLabel = (time) => new Date(time).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const xLeft = 94, xRight = WIDTH - 100;
  const xFor = (time) => xLeft + (time - tMin) * (xRight - xLeft) / (tMax - tMin);
  text(94, 14, 'COROS FIT - RECORDED 1 MINUTE SERIES', WHITE, 2);

  function panel(top, label, left, right) {
    const plotTop = top + 45;
    const plotBottom = top + 250;
    const leftValues = points.map((p) => p[left.key]).filter((v) => v != null);
    const rightValues = points.map((p) => p[right.key]).filter((v) => v != null);
    const extent = (values) => {
      if (!values.length) return [0, 1];
      const min = Math.min(...values), max = Math.max(...values);
      const padding = Math.max((max - min) * 0.1, max * 0.03, 0.5);
      return [Math.max(0, min - padding), max + padding];
    };
    const leftRange = extent(leftValues), rightRange = extent(rightValues);
    const yFor = (value, range) => plotBottom - (value - range[0]) * (plotBottom - plotTop) / (range[1] - range[0]);

    text(94, top + 3, label, WHITE, 2);
    line(94, top + 26, 124, top + 26, left.color, 2);
    text(134, top + 19, left.name, left.color, 2);
    line(420, top + 26, 450, top + 26, right.color, 2);
    text(460, top + 19, right.name, right.color, 2);
    text(795, top + 19, 'ALTITUDE BACKGROUND', PURPLE, 1);

    // Same time axis and independent left/right scales as the on-screen charts.
    for (let tick = 0; tick <= 4; tick++) {
      const y = plotTop + tick * (plotBottom - plotTop) / 4;
      line(xLeft, y, xRight, y, GRID, 0, 0.35);
      const a = leftRange[1] - tick * (leftRange[1] - leftRange[0]) / 4;
      const b = rightRange[1] - tick * (rightRange[1] - rightRange[0]) / 4;
      text(12, y - 5, a.toFixed(1), left.color, 1);
      text(xRight + 14, y - 5, b.toFixed(1), right.color, 1);
    }
    for (let tick = 0; tick <= 5; tick++) {
      const time = tMin + tick * (tMax - tMin) / 5;
      const x = xFor(time);
      line(x, plotTop, x, plotBottom, GRID, 0, 0.25);
      text(Math.min(WIDTH - 62, x - 17), plotBottom + 12, timeLabel(time), WHITE, 1);
    }

    const altitudes = points.map((p) => p.altitude).filter((v) => v != null);
    if (altitudes.length > 1) {
      const altMin = Math.min(...altitudes), altMax = Math.max(...altitudes);
      if (altMax > altMin) {
        for (const p of points) {
          if (p.altitude == null) continue;
          const x = xFor(p.t);
          const normalized = (p.altitude - altMin) / (altMax - altMin);
          const y = plotBottom - (normalized * 0.78 + 0.08) * (plotBottom - plotTop);
          line(x, y, x, plotBottom, PURPLE, 1, 0.08);
        }
      }
    }

    for (const series of [left, right]) {
      const range = series === left ? leftRange : rightRange;
      let previous = null;
      for (const p of points) {
        const value = p[series.key];
        if (value == null) { previous = null; continue; }
        const x = xFor(p.t), y = yFor(value, range);
        if (previous && p.t - previous.t <= 120000) {
          line(previous.x, previous.y, x, y, series.color, 1);
        }
        if (points.length <= 100) line(x, y, x, y, series.color, 2);
        previous = { x, y, t: p.t };
      }
    }
  }
  panel(56, 'STRIDE AND HEART RATE', { key: 'stride', name: 'STRIDE (CM)', color: CYAN },
    { key: 'heartRate', name: 'HR (BPM)', color: PINK });
  panel(405, 'SPEED AND PITCH', { key: 'speed', name: 'SPEED (KM/H)', color: GREEN },
    { key: 'pitch', name: 'PITCH (SPM)', color: GOLD });
  return encodePng(WIDTH, HEIGHT, pixels);
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function chunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of type) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, type, data, checksum]);
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 7 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { renderCorosRunChartPng };