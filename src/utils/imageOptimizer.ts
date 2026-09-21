/**
 * src/utils/imageOptimizer.ts
 * 
 * WHY THIS UTILITY IS NEEDED:
 * Step 6 Enhancement: Client-side Image Optimization for Mobile Browsers.
 * 
 * Mobile devices (such as an iQOO phone) capture photos at 12MP to 64MP+
 * (e.g. 4000x3000 to 8000x6000), creating 10-25 MB files that can exceed
 * browser memory limits or cause low-memory errors when uploaded over mobile networks.
 * 
 * This utility:
 * 1. Safely decodes the image in the browser.
 * 2. Downscales the image so its longest dimension is around 1600 pixels,
 *    preserving the aspect ratio.
 * 3. Encodes the image to standard JPEG at a balanced quality setting (~0.82-0.85)
 *    to target a lightweight file size around 0.5–1.8 MB.
 * 4. Disposes of canvas and intermediate memory structures to avoid mobile RAM leaks.
 * 5. Returns an optimized standard File object ready for multipart/form-data upload.
 */

export interface ImageOptimizationResult {
  file: File;
  previewUrl: string;
  originalSize: number;
  optimizedSize: number;
  originalWidth: number;
  originalHeight: number;
  optimizedWidth: number;
  optimizedHeight: number;
}

const DEFAULT_MAX_DIMENSION = 1600; // Optimal resolution for text, diagrams, code, and handwriting
const TARGET_MAX_BYTES = 2 * 1024 * 1024; // 2 MB target upper bound
const DEFAULT_QUALITY = 0.85;

/**
 * Reads a File into an HTMLImageElement using an object URL.
 * Immediately revokes the object URL after image loads to prevent memory leaks.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image. The file may be corrupt or unreadable.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Calculates new dimensions keeping the longest edge at or below maxDimension
 * while strictly preserving the aspect ratio.
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension: number = DEFAULT_MAX_DIMENSION
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  if (width >= height) {
    const newWidth = maxDimension;
    const newHeight = Math.round((height * maxDimension) / width);
    return { width: newWidth, height: Math.max(1, newHeight) };
  } else {
    const newHeight = maxDimension;
    const newWidth = Math.round((width * maxDimension) / height);
    return { width: Math.max(1, newWidth), height: newHeight };
  }
}

/**
 * Optimizes an image File client-side before network transmission.
 * 
 * @param originalFile - The raw image File from file picker or camera capture
 * @param options - Optional override parameters
 * @returns Promise<ImageOptimizationResult>
 */
export async function optimizeImageForUpload(
  originalFile: File,
  options: {
    maxDimension?: number;
    targetMaxBytes?: number;
    initialQuality?: number;
  } = {}
): Promise<ImageOptimizationResult> {
  const maxDim = options.maxDimension || DEFAULT_MAX_DIMENSION;
  const targetBytes = options.targetMaxBytes || TARGET_MAX_BYTES;
  const initialQuality = options.initialQuality || DEFAULT_QUALITY;

  // 1. Load image into memory
  const img = await loadImageFromFile(originalFile);
  const originalWidth = img.naturalWidth || img.width;
  const originalHeight = img.naturalHeight || img.height;

  if (originalWidth === 0 || originalHeight === 0) {
    throw new Error('Image has zero dimensions and cannot be processed.');
  }

  // 2. Compute proportional scaled dimensions
  const target = calculateTargetDimensions(originalWidth, originalHeight, maxDim);

  // 3. Render onto an offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Canvas 2D rendering context is unavailable.');
  }

  // Use high-quality image smoothing for readable text and clean diagram lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill with white background in case source had transparent pixels (e.g. PNG diagrams)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, target.width, target.height);

  // Draw scaled image
  ctx.drawImage(img, 0, 0, target.width, target.height);

  // 4. Compress to JPEG blob
  let currentQuality = initialQuality;
  let blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', currentQuality);
  });

  if (!blob) {
    // Fallback if toBlob failed
    throw new Error('Failed to generate compressed image blob from canvas.');
  }

  // If the image is still above the target size and quality can be reduced, do a second pass
  if (blob.size > targetBytes && currentQuality > 0.65) {
    currentQuality = 0.72;
    const secondPass = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', currentQuality);
    });
    if (secondPass && secondPass.size < blob.size) {
      blob = secondPass;
    }
  }

  // 5. Clean up canvas to immediately release frame buffer memory
  canvas.width = 0;
  canvas.height = 0;

  // 6. Create optimized File object
  const cleanBaseName = originalFile.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const optimizedFileName = `${cleanBaseName || 'photo'}_opt.jpg`;

  const optimizedFile = new File([blob], optimizedFileName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });

  const previewUrl = URL.createObjectURL(blob);

  return {
    file: optimizedFile,
    previewUrl,
    originalSize: originalFile.size,
    optimizedSize: optimizedFile.size,
    originalWidth,
    originalHeight,
    optimizedWidth: target.width,
    optimizedHeight: target.height,
  };
}
