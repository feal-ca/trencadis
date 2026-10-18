import { fromImageData } from './core/image.js';
import { createPipeline } from './core/pipeline.js';
import * as vis from './core/vis.js';

const pipe = createPipeline();
let latest = 0;

const STRUCTURE_LABEL = { seeds: 'Semillas', cracks: 'Grietas', depth: 'Profundidad de corte' };

function visualsFor(stage, value, p, img) {
  switch (stage) {
    case 'analysis':
      return [
        { key: 'original', label: 'Original', image: vis.originalImage(img) },
        { key: 'detail', label: 'Detalle', image: vis.detailImage(value) },
        { key: 'size', label: 'Tamaño de trozo', image: vis.sizeImage(value, p) },
        { key: 'orientation', label: 'Orientación', image: vis.orientationImage(value) },
      ];
    case 'tessellation':
      return [
        { key: 'structure', label: STRUCTURE_LABEL[value.structure.kind], image: vis.structureImage(img, value) },
        { key: 'tessellation', label: 'Teselación', image: vis.tessellationImage(img, value) },
      ];
    case 'color':
      return [
        { key: 'flat', label: 'Color por trozo', image: vis.flatImage(img, pipe.lastTess, value.flat) },
        { key: 'palette', label: 'Paleta y variación', image: vis.flatImage(img, pipe.lastTess, value.colors) },
      ];
    case 'render':
      // Copy: the transfer would otherwise detach the cached render.
      return [{ key: 'final', label: 'Mosaico', image: new ImageData(new Uint8ClampedArray(value.data), value.width, value.height) }];
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
  if (msg.type !== 'run') return;
  const id = (latest = msg.id);
  const p = msg.params;
  try {
    const res = await pipe.run(
      p,
      (stage, value, recomputed) => {
        if (stage === 'tessellation') pipe.lastTess = value;
        if (!recomputed) return;
        const img = pipe.imageFor(msg.preview);
        const images = visualsFor(stage, value, p, img);
        const extra = {};
        // The GPU renderer needs the shards (once per tessellation) and the colours.
        if (stage === 'tessellation') Object.assign(extra, { shards: value.shards.map((s) => s.poly), w: img.w, h: img.h });
        if (stage === 'color') extra.colors = Float32Array.from(value.colors);
        const transfer = images.map((v) => v.image.data.buffer);
        if (extra.colors) transfer.push(extra.colors.buffer);
        self.postMessage({ type: 'stage', id, stage, images, preview: !!msg.preview, ...extra }, transfer);
      },
      () => latest !== id,
      () => new Promise((r) => setTimeout(r, 0)),
      (stage) => self.postMessage({ type: 'progress', id, stage }),
      { preview: !!msg.preview, cpuRender: !!msg.cpuRender },
    );
    if (res) self.postMessage({ type: 'done', id, ...res });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
