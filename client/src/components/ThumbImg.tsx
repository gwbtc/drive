import { useEffect, useState } from 'preact/hooks';
import { uploadThumb } from '../api';

type Props = {
  docId: string;
  alt?: string;
  class?: string;
};

// An <img> that prefers the server-side thumbnail (/drive/thumb) and falls
// back to the full blob (/drive/blob) when no thumb exists (the backend 404s)
// or the thumb fails to load. Grids use this so they don't pull full-size
// images for every tile.
export function ThumbImg({ docId, alt, class: className }: Props) {
  const [fallback, setFallback] = useState(false);

  // Reset when the tile is reused for a different doc.
  useEffect(() => setFallback(false), [docId]);

  const src = fallback
    ? `/drive/blob?id=${docId}`
    : `/drive/thumb?id=${docId}`;

  return (
    <img
      class={className}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => {
        if (!fallback) setFallback(true);
      }}
    />
  );
}

// Generate a downscaled JPEG thumbnail (≤256px on the long edge) for an image
// file and upload it for `docId`. Best-effort: any failure (non-image, no
// canvas, upload error) is swallowed — the grid just falls back to /drive/blob.
export async function generateAndUploadThumb(
  docId: string,
  file: File,
): Promise<void> {
  try {
    if (!file.type.startsWith('image/')) return;
    const bytes = await makeThumbJpeg(file, 256);
    if (bytes) await uploadThumb(docId, bytes);
  } catch {
    /* best-effort — no thumb is fine */
  }
}

async function makeThumbJpeg(
  file: File,
  maxDim: number,
): Promise<Uint8Array | null> {
  const source = await loadImageSource(file);
  if (!source) return null;
  try {
    const [sw, sh] = sourceDims(source);
    if (!sw || !sh) return null;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.7),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    if ('close' in source) source.close();
  }
}

function sourceDims(
  source: ImageBitmap | HTMLImageElement,
): [number, number] {
  return 'naturalWidth' in source
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];
}

async function loadImageSource(
  file: File,
): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to an <img> decode below */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
