// Photos longer than this are reduced on load: the pipeline never needs more,
// and a 48 MP bitmap would hold ~190 MB.
export const MAX_PHOTO_LONG = 3200;

// [w, h] scaled so the long side is at most maxLong.
export function fitLong(w, h, maxLong) {
  const long = Math.max(w, h);
  if (long <= maxLong) return [w, h];
  const k = maxLong / long;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// Decodes with the EXIF rotation applied. A big photo is reduced and only the
// reduced bitmap is kept; the original is closed.
export async function decodePhoto(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const [w, h] = fitLong(bmp.width, bmp.height, MAX_PHOTO_LONG);
  if (w === bmp.width && h === bmp.height) return bmp;
  try {
    return await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  } finally {
    bmp.close();
  }
}

// HEIC is let through (its type is often empty) so it reaches the HEIC notice.
export function isImage(file) {
  return /^image\//.test(file.type ?? '') || /\.hei[cf]$/i.test(file.name ?? '');
}

// The photo's name as a safe piece of a file name.
export function photoName(file) {
  const base = (file.name ?? '').replace(/\.[^.]*$/, '');
  const clean = base.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return clean || 'foto';
}
