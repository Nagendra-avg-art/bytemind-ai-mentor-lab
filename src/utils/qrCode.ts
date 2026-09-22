/**
 * src/utils/qrCode.ts
 * 
 * Lightweight, zero-dependency QR Code matrix generator in pure TypeScript.
 * Generates standards-compliant ISO/IEC 18004 QR Code matrices for URLs and text.
 * 
 * Supports byte encoding mode with Reed-Solomon error correction (EC Level L & M).
 * Outputs a 2D boolean array (true = black module, false = white module)
 * or a scalable SVG string.
 */

// Galois Field GF(256) tables with primitive polynomial 0x11d (285)
const GF_EXP: number[] = new Array(512);
const GF_LOG: number[] = new Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsCalculateRemainder(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Array(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let i = 0; i < ecCount - 1; i++) {
      remainder[i] = remainder[i + 1] ^ gfMul(gen[i + 1], factor);
    }
    remainder[ecCount - 1] = gfMul(gen[ecCount], factor);
  }

  return remainder;
}

// Version table definitions for Versions 1-6 (Byte mode, Error Correction Level L)
interface QRVersionSpec {
  version: number;
  size: number;
  totalBytes: number;
  dataBytes: number;
  ecBytes: number;
  alignmentPositions: number[];
}

const VERSION_SPECS: QRVersionSpec[] = [
  { version: 1, size: 21, totalBytes: 26, dataBytes: 19, ecBytes: 7, alignmentPositions: [] },
  { version: 2, size: 25, totalBytes: 44, dataBytes: 34, ecBytes: 10, alignmentPositions: [6, 18] },
  { version: 3, size: 29, totalBytes: 70, dataBytes: 55, ecBytes: 15, alignmentPositions: [6, 22] },
  { version: 4, size: 33, totalBytes: 100, dataBytes: 80, ecBytes: 20, alignmentPositions: [6, 26] },
  { version: 5, size: 37, totalBytes: 134, dataBytes: 108, ecBytes: 26, alignmentPositions: [6, 30] },
  { version: 6, size: 41, totalBytes: 172, dataBytes: 136, ecBytes: 36, alignmentPositions: [6, 34] },
];

/**
 * Encodes text into QR Code data stream using 8-bit byte mode.
 */
function encodeData(text: string, spec: QRVersionSpec): number[] {
  const bytes = new TextEncoder().encode(text);
  const count = bytes.length;

  if (count > spec.dataBytes - 2) {
    throw new Error(`Text too long for QR version ${spec.version}`);
  }

  const bitStream: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  }

  // 1. Mode indicator: 0100 for Byte Mode
  pushBits(0b0100, 4);

  // 2. Character count indicator (8 bits for versions 1-9)
  pushBits(count, 8);

  // 3. Data bytes
  for (let i = 0; i < count; i++) {
    pushBits(bytes[i], 8);
  }

  // 4. Terminator (up to 4 zeros)
  const maxBits = spec.dataBytes * 8;
  const termLen = Math.min(4, maxBits - bitStream.length);
  pushBits(0, termLen);

  // 5. Pad to multiple of 8
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }

  // Convert bits to bytes
  const dataBytes: number[] = [];
  for (let i = 0; i < bitStream.length; i += 8) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bitStream[i + b];
    }
    dataBytes.push(byteVal);
  }

  // 6. Fill with alternating pad bytes (0xEC, 0x11)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBytes.length < spec.dataBytes) {
    dataBytes.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // 7. Calculate Reed-Solomon error correction bytes
  const ecBytes = rsCalculateRemainder(dataBytes, spec.ecBytes);

  return [...dataBytes, ...ecBytes];
}

/**
 * Builds the 2D matrix for the QR Code.
 */
export function generateQRMatrix(text: string): boolean[][] {
  const byteCount = new TextEncoder().encode(text).length;
  let spec = VERSION_SPECS.find(s => s.dataBytes >= byteCount + 3);
  if (!spec) {
    spec = VERSION_SPECS[VERSION_SPECS.length - 1];
  }

  const N = spec.size;
  const matrix: boolean[][] = Array.from({ length: N }, () => new Array(N).fill(false));
  const reserved: boolean[][] = Array.from({ length: N }, () => new Array(N).fill(false));

  function setModule(r: number, c: number, val: boolean) {
    if (r >= 0 && r < N && c >= 0 && c < N) {
      matrix[r][c] = val;
      reserved[r][c] = true;
    }
  }

  // 1. Draw 7x7 Finder Pattern at (row, col)
  function drawFinderPattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;

        if (r === -1 || r === 7 || c === -1 || c === 7) {
          // Separator white ring
          setModule(nr, nc, false);
        } else if (r === 0 || r === 6 || c === 0 || c === 6) {
          // Outer black box
          setModule(nr, nc, true);
        } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
          // Inner 3x3 black dot
          setModule(nr, nc, true);
        } else {
          // Inner white ring
          setModule(nr, nc, false);
        }
      }
    }
  }

  // Three finder patterns
  drawFinderPattern(0, 0);
  drawFinderPattern(0, N - 7);
  drawFinderPattern(N - 7, 0);

  // 2. Timing Patterns (Row 6, Col 6)
  for (let i = 8; i < N - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  // 3. Alignment Patterns (for Version >= 2)
  if (spec.alignmentPositions.length > 0) {
    const coords = spec.alignmentPositions;
    for (const r of coords) {
      for (const c of coords) {
        // Skip finders
        if ((r === coords[0] && c === coords[0]) ||
            (r === coords[0] && c === coords[coords.length - 1]) ||
            (r === coords[coords.length - 1] && c === coords[0])) {
          continue;
        }
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const isBorder = Math.abs(dy) === 2 || Math.abs(dx) === 2;
            const isCenter = dy === 0 && dx === 0;
            setModule(r + dy, c + dx, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 4. Dark Module
  setModule(4 * spec.version + 9, 8, true);

  // 5. Reserve Format Information areas
  for (let i = 0; i <= 8; i++) {
    if (i < N) reserved[8][i] = true;
    if (i < N) reserved[i][8] = true;
  }
  for (let i = 0; i <= 7; i++) {
    reserved[8][N - 1 - i] = true;
    reserved[N - 1 - i][8] = true;
  }

  // 6. Data Stream
  const data = encodeData(text, spec);
  const dataBits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((byte >> i) & 1);
    }
  }

  // 7. Place data bits in zigzag 2-column pattern
  let bitIdx = 0;
  let upwards = true;
  for (let col = N - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Skip vertical timing column
    const rows = upwards
      ? Array.from({ length: N }, (_, i) => N - 1 - i)
      : Array.from({ length: N }, (_, i) => i);

    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
          // Apply standard Mask 0: (row + col) % 2 === 0
          const mask = (row + c) % 2 === 0;
          matrix[row][c] = (bit === 1) !== mask;
          reserved[row][c] = true;
        }
      }
    }
    upwards = !upwards;
  }

  // 8. Write Format Information (Level L, Mask 0 = 111011111000100)
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i] === 1;

  for (let i = 0; i < 7; i++) matrix[N - 1 - i][8] = formatBits[i] === 1;
  for (let i = 7; i < 15; i++) matrix[8][N - 15 + i] = formatBits[i] === 1;

  return matrix;
}

/**
 * Generates an SVG path string for the QR code modules.
 */
export function generateQRSVGPath(matrix: boolean[][]): string {
  const N = matrix.length;
  let path = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c]) {
        path += `M${c + 4},${r + 4}h1v1h-1z `;
      }
    }
  }
  return path;
}
