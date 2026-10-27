import { useCallback } from 'react';

// Saving and sharing the mosaic at export size.
export function useExport({ photoName, renderer, effectiveRef, requestRender, requestCpuExport }) {
  // The mosaic at export size, as PNG or JPG.
  const exportFile = useCallback(async (format = 'png') => {
    const p = effectiveRef.current;
    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    let blob;
    if (renderer.ok) {
      blob = await renderer.toBlob(p, p.outLong, type, 0.9);
      requestRender();
    } else {
      // No GPU: the worker draws the download apart from what is on screen.
      const image = await requestCpuExport();
      const cv = document.createElement('canvas');
      cv.width = image.width;
      cv.height = image.height;
      cv.getContext('2d').putImageData(image, 0, 0);
      blob = await new Promise((r) => cv.toBlob(r, type, 0.9));
    }
    return blob && new File([blob], `trencadis-${photoName}-${p.algorithm}-${p.seed}.${format}`, { type });
  }, [photoName, renderer, requestRender, requestCpuExport]);

  const download = useCallback(async (format) => {
    const file = await exportFile(format);
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [exportFile]);

  // Web Share with the image as a file (phones: save to Photos, send, post).
  // Falls back to a download if the browser refuses, e.g. when encoding took
  // long enough for the tap to stop counting as a user gesture.
  const share = useCallback(async (format) => {
    const file = await exportFile(format);
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Trencadís' });
    } catch (e) {
      if (e.name !== 'AbortError') download(format);
    }
  }, [exportFile, download]);

  return { download, share };
}
