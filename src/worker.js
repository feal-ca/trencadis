import { downscale, fromImageData } from './core/image.js';
import { createPipeline } from './core/pipeline.js';
import { renderMosaic } from './core/render.js';
import { DRAFT_LONG, toWorkPx } from './core/params.js';
import * as vis from './core/vis.js';

// While a control is dragged, runs go to a second pipeline on a smaller copy
// of the photo; the full one keeps the results that are exported.
const fullPipe = createPipeline();
const draftPipe = createPipeline();
// The pipeline of the last finished run, which the views are drawn from.
let pipe = fullPipe;
// The result last sent to the page for each stage, so one that comes out of a
// cache is still sent when the page is showing another.
let sentValues = {};
// The last run that finished here. The page says which `done` it accepted; if
// that differs, it dropped some of what was sent. An unfinished run did too.
let lastFinishedId = 0;
let lastFinished = true;
let latest = 0;
let lastParams = null;
// The tessellation and colours of the last finished full run, for exports.
// A draft never replaces it.
let lastRun = null;
// Only the view on screen is drawn after a run; others on request.
let wanted = new Set(['final']);
const STAGE_OF_VIEW = {
  original: 'analysis', detail: 'analysis', size: 'analysis', orientation: 'analysis',
  structure: 'tessellation', tessellation: 'tessellation', flat: 'color', palette: 'color', final: 'render',
};

const STRUCTURE_LABEL = { seeds: 'Semillas', cracks: 'Grietas', depth: 'Profundidad de corte', guides: 'Líneas guía' };

// Stage images, built lazily so only the views asked for are drawn.
function visualsFor(pipe, stage, value, p, img) {
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
        { key: 'flat', label: 'Color por trozo', make: () => vis.flatImage(img, pipe.cached('tessellation'), value.flat) },
        { key: 'palette', label: 'Con paleta y variación', make: () => vis.flatImage(img, pipe.cached('tessellation'), value.colors) },
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
    const img = fromImageData(msg.image);
    fullPipe.setImage(img);
    draftPipe.setImage(downscale(img, DRAFT_LONG));
    sentValues = {};
    lastRun = null;
    return;
  }
  if (msg.type === 'zones') {
    fullPipe.setZones(msg.zones);
    draftPipe.setZones(msg.zones);
    return;
  }
  if (msg.type === 'segments') {
    fullPipe.setSegments(msg.segments);
    draftPipe.setSegments(msg.segments);
    return;
  }
  if (msg.type === 'guides') {
    fullPipe.setGuides(msg.guides);
    draftPipe.setGuides(msg.guides);
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
      const images = visualsFor(pipe, stage, value, toWorkPx(lastParams), img)
        .filter((v) => wanted.has(v.key))
        .map(({ key, label, make }) => ({ key, label, image: make() }));
      self.postMessage({ type: 'stage', id: latest, stage, images, viewsOnly: true }, images.map((v) => v.image.data.buffer));
    }
    return;
  }
  if (msg.type === 'export') {
    // The download is drawn from the last finished run, at its own size,
    // whatever the screen-size render is.
    if (!lastRun) {
      self.postMessage({ type: 'error', id: msg.id, message: 'No hay ningún mosaico que exportar' });
      return;
    }
    try {
      const { shards, colors, w, h, params } = lastRun;
      const { data, width, height } = renderMosaic(shards, colors, w, h, toWorkPx(params), params.outLong);
      const image = new ImageData(data, width, height);
      self.postMessage({ type: 'exported', id: msg.id, image }, [image.data.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: err?.message || String(err) });
    }
    return;
  }
  if (msg.type !== 'run') return;
  const id = (latest = msg.id);
  if (!lastFinished || msg.acceptedId !== lastFinishedId) sentValues = {};
  lastFinished = false;
  const draft = !!msg.draft;
  const run = draft ? draftPipe : fullPipe;
  const p = draft ? { ...msg.params, workLong: Math.min(msg.params.workLong, DRAFT_LONG) } : msg.params;
  if (msg.views) wanted = new Set(msg.views);
  try {
    const res = await run.run(
      p,
      (stage, value, recomputed) => {
        if (!recomputed && sentValues[stage] === value) return;
        sentValues[stage] = value;
        const img = run.image;
        const images = visualsFor(run, stage, value, toWorkPx(p), img)
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
        self.postMessage({ type: 'stage', id, stage, images, stale, draft, ...extra }, transfer);
      },
      () => latest !== id,
      () => new Promise((r) => setTimeout(r, 0)),
      (stage) => self.postMessage({ type: 'progress', id, stage }),
      { cpuRender: !!msg.cpuRender, cpuLong: msg.cpuLong },
    );
    if (res) {
      lastFinished = true;
      lastFinishedId = id;
      pipe = run;
      lastParams = p;
      if (!draft) {
        lastRun = {
          shards: run.cached('tessellation').shards, colors: run.cached('color').colors,
          w: run.image.w, h: run.image.h, params: p,
        };
      }
      self.postMessage({ type: 'done', id, draft, ...res });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
