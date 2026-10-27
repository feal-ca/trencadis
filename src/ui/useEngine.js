import { useCallback, useRef, useState } from 'react';
import { decodePhoto, isImage, photoName as nameOf } from './photo.js';
import { useExport } from './engine/useExport.js';
import { useGuides } from './engine/useGuides.js';
import { useHistory } from './engine/useHistory.js';
import { usePipeline, DEBUG } from './engine/usePipeline.js';
import { useSegmentation } from './engine/useSegmentation.js';
import { useSettings } from './engine/useSettings.js';
import { useZones } from './engine/useZones.js';

export const SAMPLES = [
  { src: './samples/vermeer.webp', label: 'Vermeer' },
  { src: './samples/vangogh.webp', label: 'Van Gogh' },
  { src: './samples/barcas.webp', label: 'Barcas' },
];

// Puts the engine's hooks together (src/ui/engine/): settings, the pipeline
// worker and renderer, segmentation, touched shapes, guide lines, history and
// export. Each takes what it needs from the ones before it.
export function useEngine() {
  const settings = useSettings();
  const { params, macros, effective } = settings;
  const pipeline = usePipeline(effective, settings.setAutoGrout);
  const { worker, bitmap, readable, info, images } = pipeline;
  const segmentation = useSegmentation({ bitmap, readable, worker, rerun: pipeline.rerun });
  // Bumped on every new photo; the touched shapes (and, later, the lines) use
  // it to drop answers that arrive late.
  const photoGen = useRef(0);
  const zones = useZones({
    session: segmentation.session, worker, rerun: pipeline.rerun, seg: segmentation.seg, photoGen,
  });
  const guides = useGuides({ worker, post: pipeline.post, effectiveRef: pipeline.effectiveRef });
  const history = useHistory({
    state: { params, macros, zones: zones.zones },
    apply: (s) => { settings.restore(s); zones.restoreZones(s.zones); },
  });
  // The photo's name goes into the downloaded file's name.
  const [photoName, setPhotoName] = useState('foto');
  const exporter = useExport({
    photoName, renderer: pipeline.renderer, effectiveRef: pipeline.effectiveRef,
    requestRender: pipeline.requestRender, requestCpuExport: pipeline.requestCpuExport,
  });

  const { setBitmap, setError, resetResults } = pipeline;
  const { session } = segmentation;
  const { resetZones } = zones;
  const { resetGuides } = guides;
  const loadBlob = useCallback(async (blob, name) => {
    if (!isImage(blob)) { setError('Ese archivo no es una imagen. Prueba con un JPG o un PNG.'); return; }
    try {
      const bmp = await decodePhoto(blob);
      resetResults();
      resetGuides();
      // Results of the old photo still on their way are dropped from here on.
      session.current.reset();
      photoGen.current++;
      resetZones();
      setPhotoName(name ?? nameOf(blob));
      setBitmap(bmp);
    } catch {
      // HEIC (iPhone photos) only opens in Safari; elsewhere it fails here.
      const heic = /hei[cf]$/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name ?? '');
      setError(heic
        ? 'Este navegador no abre fotos HEIC, el formato del iPhone. Ábrela en Safari o guárdala como JPG (en el iPhone: Ajustes › Cámara › Formatos › Más compatible).'
        : 'No se ha podido leer esa imagen. Prueba con un JPG o un PNG.');
    }
  }, []);

  const loadSample = useCallback(async (src) => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.statusText);
      const label = SAMPLES.find((s) => s.src === src)?.label ?? '';
      await loadBlob(await res.blob(), nameOf({ name: label.toLowerCase() }));
    } catch {
      setError('No se ha podido cargar el ejemplo. Comprueba la conexión y vuelve a probar.');
    }
  }, [loadBlob]);

  const api = {
    params, setParams: settings.setParams, images, labels: pipeline.labels, busy: pipeline.busy, info,
    error: pipeline.error, gpu: pipeline.gpu, glCanvas: pipeline.glCanvas, mosaicReady: pipeline.mosaicReady,
    autoGrout: settings.autoGrout,
    hasImage: !!bitmap, bitmap, photoName,
    setParam: settings.setParam,
    style: settings.style,
    // Pieces expected at the current size: with a fixed size ratio every piece
    // scales with sMax, so the count goes as 1 / sMax² from the last run.
    estimate: info?.sMax ? info.shards * (info.sMax / params.sMax) ** 2 : null,
    // The zones belong to what a style or a reset replaces, so they join what restore() needs.
    setStyle: (id) => ({ ...settings.setStyle(id), zones: zones.zonesRef.current }),
    macros,
    setMacro: settings.setMacro,
    setManual: settings.setManual,
    resetAll: () => ({ ...settings.resetAll(), zones: zones.zonesRef.current }),
    restore: (s) => { settings.restore(s); if (s.zones) zones.restoreZones(s.zones); },
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    isDefault: settings.isDefault,
    loadBlob, loadSample, setViewport: pipeline.setViewport, setWanted: pipeline.setWanted,
    download: exporter.download, share: exporter.share,
    seg: segmentation.seg, segments: segmentation.segments,
    segAccept: segmentation.segAccept, segDecline: segmentation.segDecline, segRetry: segmentation.segRetry,
    zones: zones.zonesView, pickShape: zones.pickShape, refineShape: zones.refineShape,
    setZoneMode: zones.setZoneMode, removeZone: zones.removeZone,
    guides: guides.guides, lines: pipeline.lines, addGuide: guides.addGuide, clearGuides: guides.clearGuides,
    undoGuide: guides.undoGuide,
  };
  if (DEBUG) window.__trencadis = api;
  return api;
}
