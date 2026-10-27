import { useCallback, useRef, useState } from 'react';
import { decodePhoto, isImage, photoName as nameOf } from './photo.js';
import { ownState } from './engine/historyState.js';
import { useExport } from './engine/useExport.js';
import { useGuides } from './engine/useGuides.js';
import { useSession } from './engine/useSession.js';
import { useHistory } from './engine/useHistory.js';
import { usePipeline, DEBUG } from './engine/usePipeline.js';
import { useSegmentation } from './engine/useSegmentation.js';
import { useSettings } from './engine/useSettings.js';
import { useZones } from './engine/useZones.js';

export const SAMPLES = [
  { src: './samples/vermeer.webp', label: 'Vermeer', seg: './samples/vermeer.seg.png' },
  { src: './samples/vangogh.webp', label: 'Van Gogh', seg: './samples/vangogh.seg.png' },
  { src: './samples/barcas.webp', label: 'Barcas', seg: './samples/barcas.seg.png' },
];

// Puts the engine's hooks together (src/ui/engine/): settings, the pipeline
// worker and renderer, segmentation, touched shapes, guide lines, history and
// export. Each takes what it needs from the ones before it.
export function useEngine() {
  const settings = useSettings();
  const { params, macros, effective } = settings;
  const pipeline = usePipeline(effective, settings.setAutoGrout);
  const { worker, bitmap, readable, info, images } = pipeline;
  // Where the segments of the current photo are known already (a sample's).
  const [preset, setPreset] = useState(null);
  const segmentation = useSegmentation({ bitmap, readable, preset, worker, rerun: pipeline.rerun });
  // Bumped on every new photo; the touched shapes (and, later, the lines) use
  // it to drop answers that arrive late.
  const photoGen = useRef(0);
  const zones = useZones({
    session: segmentation.session, worker, rerun: pipeline.rerun, seg: segmentation.seg, photoGen,
  });
  const guides = useGuides({ worker, rerun: pipeline.rerun, photoGen });
  // Puts a recorded state back, without the lines and shapes of an earlier photo.
  const restoreOwn = (s) => {
    const own = ownState(s, { gen: photoGen.current, hasZone: (id) => zones.zonePixels.current.has(id) });
    settings.restore(own);
    if (own.zones) zones.restoreZones(own.zones);
    if (own.guides) guides.restoreGuides(own.guides);
  };
  const history = useHistory({ state: { params, macros, zones: zones.zones, guides: guides.guides }, apply: restoreOwn });
  // The photo's name goes into the downloaded file's name.
  const [photoName, setPhotoName] = useState('foto');
  const exporter = useExport({
    photoName, renderer: pipeline.renderer, effectiveRef: pipeline.effectiveRef,
    requestCpuExport: pipeline.requestCpuExport, awaitFull: pipeline.awaitFull,
    setError: pipeline.setError,
    settings: { effective, info, busy: pipeline.busy, mosaicReady: pipeline.mosaicReady },
  });

  const { setBitmap, setError, resetResults } = pipeline;
  const { session } = segmentation;
  const { resetZones } = zones;
  const { resetGuides } = guides;
  // Which sample is on screen (its src), or null for a photo of the user's.
  const [sample, setSample] = useState(null);
  // Each request takes a number when it starts; one overtaken by a later request is dropped.
  const requests = useRef(0);
  // Resolves to true when the photo was loaded, false when it failed and null
  // when a later request took its place.
  const loadBlob = useCallback(async (blob, name, seg = null, sampleSrc = null, ticket = ++requests.current) => {
    if (!isImage(blob)) { setError('Ese archivo no es una imagen. Prueba con un JPG o un PNG.'); return false; }
    try {
      const bmp = await decodePhoto(blob);
      if (ticket !== requests.current) { bmp.close(); return null; }
      resetResults();
      resetGuides();
      // Results of the old photo still on their way are dropped from here on.
      session.current.reset();
      photoGen.current++;
      resetZones();
      setPhotoName(name ?? nameOf(blob));
      setPreset(seg);
      setSample(sampleSrc);
      shown.current = true;
      setBitmap(bmp);
      setError(null);
      return true;
    } catch {
      // HEIC (iPhone photos) only opens in Safari; elsewhere it fails here.
      const heic = /hei[cf]$/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name ?? '');
      setError(heic
        ? 'Este navegador no abre fotos HEIC, el formato del iPhone. Ábrela en Safari o guárdala como JPG (en el iPhone: Ajustes › Cámara › Formatos › Más compatible).'
        : 'No se ha podido leer esa imagen. Prueba con un JPG o un PNG.');
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadBlob has to stay stable; the resets and setters only touch refs and state
  }, []);

  const loadSample = useCallback(async (src) => {
    const ticket = ++requests.current;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.statusText);
      const sample = SAMPLES.find((s) => s.src === src);
      return await loadBlob(await res.blob(), nameOf({ name: (sample?.label ?? '').toLowerCase() }), sample?.seg, src, ticket);
    } catch {
      setError('No se ha podido cargar el ejemplo. Comprueba la conexión y vuelve a probar.');
      return false;
    }
  }, [loadBlob, setError]);

  // The last session comes back on start (or the first sample), and is kept as it changes.
  // Set when the user picks a photo or sample; start-up then does not load its own.
  const chosen = useRef(false);
  // A pick that fails with nothing on screen yet leaves the first sample to load.
  const shown = useRef(false);
  const pick = useCallback(async (load, ...args) => {
    chosen.current = true;
    const ok = await load(...args);
    if (ok === false && !shown.current) { chosen.current = false; loadSample(SAMPLES[0].src); }
    return ok;
  }, [loadSample]);
  const pickBlob = useCallback((...args) => pick(loadBlob, ...args), [pick, loadBlob]);
  const pickSample = useCallback((...args) => pick(loadSample, ...args), [pick, loadSample]);
  useSession({
    samples: SAMPLES, loadBlob, loadSample, chosen, rebaseHistory: history.rebaseNext, setError, photoGen, zones, guides, sample, bitmap, photoName,
    segments: segmentation.segments,
  });

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
    restore: restoreOwn,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    isDefault: settings.isDefault,
    loadBlob: pickBlob, loadSample: pickSample, setViewport: pipeline.setViewport, setWanted: pipeline.setWanted,
    dragStart: pipeline.dragStart, dragEnd: pipeline.dragEnd,
    download: exporter.download, share: exporter.share, format: exporter.format, setFormat: exporter.setFormat,
    sign: exporter.sign, setSign: exporter.setSign, kofi: exporter.kofi, closeKofi: exporter.closeKofi,
    reseed: () => settings.setParams((p) => ({ ...p, seed: (p.seed % 999) + 1 })),
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
