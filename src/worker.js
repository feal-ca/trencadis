import { fromImageData } from './core/image.js';
import { createPipeline } from './core/pipeline.js';
import { toWorkPx } from './core/params.js';
import * as vis from './core/vis.js';

const pipe = createPipeline();
let latest = 0;
let lastParams = null;
// Only the view on screen is drawn after a run; others on request.
let wanted = new Set(['final']);
const STAGE_OF_VIEW = {
  original: 'analysis', detail: 'analysis', size: 'analysis', orientation: 'analysis',
  structure: 'tessellation', tessellation: 'tessellation', flat: 'color', palette: 'color', final: 'render',
};

const STRUCTURE_LABEL = { seeds: 'Semillas', cracks: 'Grietas', depth: 'Profundidad de corte', guides: 'Líneas guía' };

// Stage images, built lazily so only the views asked for are drawn.
function visualsFor(stage, value, p, img) {
  switch (stage) {
    case 'analysis':
      return [
        { key: 'original', label: 'Original', make: () => vis.originalImage(img) },
        { key: 'detail', label: 'Detalle', make: () => vis.detailImage(value) },
        { key: 'size', label: 'Tamaño de trozo', make: () => vis.sizeImage(value, p) },
        { key: 'orientation', label: 'Dirección de los bordes', make: () => vis.orientationImage(value) },
      ];
    case 'tessellation':
      return [
        { key: 'structure', label: STRUCTURE_LABEL[value.structure.kind], make: () => vis.structureImage(img, value) },
        { key: 'tessellation', label: 'Contornos', make: () => vis.tessellationImage(img, value) },
      ];
    case 'color':
      return [
        { key: 'flat', label: 'Color por trozo', make: () => vis.flatImage(img, pipe.lastTess, value.flat) },
        { key: 'palette', label: 'Con paleta y variación', make: () => vis.flatImage(img, pipe.lastTess, value.colors) },
      ];
    case 'render':
      // Copy: the transfer would otherwise detach the cached render.
      return [{ key: 'final', label: 'Mosaico', make: () => new ImageData(new Uint8ClampedArray(value.data), value.width, value.height) }];
    default:
      return [];
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'image') {
    pipe.setImage(fromImageData(msg.image));
    return;
  }
  if (msg.type === 'mask') {
    pipe.setMask(msg.mask);
    return;
  }
  if (msg.type === 'guides') {
    pipe.setGuides(msg.guides);
    return;
  }
  if (msg.type === 'views') {
    // Draw views that were skipped, from the cached results of the last run.
    wanted = new Set(msg.keys);
    if (!lastParams) return;
    const img = pipe.image;
    for (const stage of new Set(msg.keys.map((k) => STAGE_OF_VIEW[k]))) {
      const value = pipe.cached(stage);
      if (!value) continue;
      const images = visualsFor(stage, value, toWorkPx(lastParams), img)
        .filter((v) => wanted.has(v.key))
        .map(({ key, label, make }) => ({ key, label, image: make() }));
      self.postMessage({ type: 'stage', id: latest, stage, images, viewsOnly: true }, images.map((v) => v.image.data.buffer));
    }
    return;
  }
  if (msg.type !== 'run') return;
  const id = (latest = msg.id);
  const p = msg.params;
  if (msg.views) wanted = new Set(msg.views);
  try {
    const res = await pipe.run(
      p,
      (stage, value, recomputed) => {
        if (stage === 'tessellation') pipe.lastTess = value;
        if (!recomputed) return;
        const img = pipe.image;
        const images = visualsFor(stage, value, toWorkPx(p), img)
          .filter((v) => wanted.has(v.key) || v.key === 'original')
          .map(({ key, label, make }) => ({ key, label, image: make() }));
        const extra = {};
        // The GPU renderer needs the shards (once per tessellation) and the colours.
        if (stage === 'tessellation') {
          Object.assign(extra, { shards: value.shards.map((s) => s.poly), rows: value.shards.map((s) => !!s.row), w: img.w, h: img.h });
          // Guide lines in use, normalised, so the drawing tool can show them.
          const st = value.structure;
          extra.lines = st.kind === 'guides'
            ? { drawn: st.drawn, lines: st.guides.map((g) => g.map(([x, y]) => [x / img.w, y / img.h])) }
            : { drawn: 0, lines: [] };
        }
        if (stage === 'color') extra.colors = Float32Array.from(value.colors);
        const transfer = images.map((v) => v.image.data.buffer);
        if (extra.colors) transfer.push(extra.colors.buffer);
        // `stale` lists this stage's views that were not redrawn.
        const stale = Object.keys(STAGE_OF_VIEW).filter((k) => STAGE_OF_VIEW[k] === stage && !images.some((v) => v.key === k));
        self.postMessage({ type: 'stage', id, stage, images, stale, ...extra }, transfer);
      },
      () => latest !== id,
      () => new Promise((r) => setTimeout(r, 0)),
      (stage) => self.postMessage({ type: 'progress', id, stage }),
      { cpuRender: !!msg.cpuRender },
    );
    lastParams = p;
    if (res) self.postMessage({ type: 'done', id, ...res });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
