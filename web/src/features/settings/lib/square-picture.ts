import { AVATAR_SIZE_PX } from '@coretask/contracts';

/**
 * Makes a profile picture out of whatever was chosen: the largest square from
 * its middle, scaled to `AVATAR_SIZE_PX`, as WebP — or PNG where the browser
 * cannot write WebP. Done here so the server stores one small file per person
 * and every avatar on a page costs a few kilobytes, whatever was uploaded.
 *
 * Re-encoding also drops whatever the original carried besides pixels, such
 * as the location a phone photo was taken at.
 */
export async function squarePicture(file: Blob, size = AVATAR_SIZE_PX): Promise<Blob> {
  const image = await decode(file);
  try {
    const side = Math.min(image.width, image.height);
    if (!side) throw new Error('That picture is empty.');

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot resize pictures.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image.source,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );

    // A browser that cannot write WebP hands back a PNG instead, so the type
    // is read from the result rather than assumed.
    const webp = await toBlob(canvas, 'image/webp', 0.9);
    if (webp?.type === 'image/webp') return webp;
    const png = await toBlob(canvas, 'image/png');
    if (!png) throw new Error('This browser cannot resize pictures.');
    return png;
  } finally {
    image.release();
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to <img>, which decodes a few formats bitmaps do not.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('That file is not a picture this browser can open.');
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
