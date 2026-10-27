import { useEffect, useRef, useState } from 'react';
import { decodeLabels } from '../../seg/labelsPng.js';
import { createSegSession, segOverrides, startPolicy } from '../segSession.js';
import { TOUCH } from '../useMedia.js';
import { DEBUG } from './usePipeline.js';

// The answer to "Buscar las formas de la foto": 'yes' or 'no'.
const SEG_STORE = 'trencadis.seg.v1';

// The segments of a preset: decoded from the labels PNG at a URL, or as given.
async function presetSegments(preset) {
  if (!preset) return null;
  if (typeof preset !== 'string') return preset;
  const res = await fetch(preset);
  if (!res.ok) throw new Error(res.statusText);
  const png = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
  const cv = new OffscreenCanvas(png.width, png.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(png, 0, 0);
  return decodeLabels(ctx.getImageData(0, 0, png.width, png.height).data, png.width, png.height);
}

// Segmentation (segSession.js): the objects of the photo, found by a model
// in its own worker, give rows along their outlines and cuts; touched
// shapes come from the same model. The worker is created on first use, so
// nothing is downloaded until segmentation starts. `worker` is the pipeline's.
// `preset` is where the photo's segments are already known: the URL of a
// labels PNG (labelsPng.js), segments already decoded, or null.
export function useSegmentation({ bitmap, readable, preset, worker, rerun }) {
  const segWorker = useRef(null);
  const [seg, setSeg] = useState({ phase: 'idle' });
  // A copy of the objects found, for the viewer to draw them.
  const [segments, setSegments] = useState(null);
  const session = useRef(null);
  session.current ??= createSegSession({
    policy: startPolicy({
      touch: typeof matchMedia !== 'undefined' && matchMedia(TOUCH).matches,
      webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      stored: (() => { try { return localStorage.getItem(SEG_STORE); } catch { return null; } })(),
    }),
    onState: (s) => {
      // Every state, for scripts: a render can skip one that the next one follows closely.
      if (DEBUG) (window.__segStates ??= []).push(s);
      setSeg(s);
    },
    post: (msg) => {
      if (!segWorker.current) {
        segWorker.current = new Worker(new URL('../../seg/worker.js', import.meta.url), { type: 'module' });
        segWorker.current.onmessage = ({ data }) => {
          if (data.type === 'log') { if (DEBUG) console.log('[sam]', data.text); return; }
          // Segmentation timings share window.__runs with the pipeline's;
          // `seg` tells them apart.
          if (data.type === 'timing') { if (DEBUG) (window.__runs ??= []).push(data.entry); return; }
          if (!session.current.receive(data) || data.type !== 'segments') return;
          setSegments({ ...data.segments, count: data.count, labels: data.segments.labels.slice() });
          worker.current?.postMessage({ type: 'segments', segments: data.segments }, [data.segments.labels.buffer]);
          rerun();
        };
        // The worker's code failed to load (or it crashed): drop it, so a
        // retry starts a new one.
        segWorker.current.onerror = (e) => {
          e.preventDefault();
          segWorker.current?.terminate();
          segWorker.current = null;
          session.current.fail('No se ha podido cargar el buscador de formas');
        };
      }
      // ?samDevice=wasm forces the CPU (headless browsers only have a software
      // GPU); ?segBatch= and ?segPoints= try other settings.
      segWorker.current.postMessage(msg.type === 'coarse' ? { ...msg, ...segOverrides(location.search) } : msg);
    },
  });
  useEffect(() => () => { segWorker.current?.terminate(); segWorker.current = null; }, []);
  const remember = (answer) => { try { localStorage.setItem(SEG_STORE, answer); } catch { /* ignore */ } };
  useEffect(() => {
    if (!bitmap || !readable) return;
    worker.current?.postMessage({ type: 'segments', segments: null });
    setSegments(null);
    // The model works at 1024 px anyway; send it the photo at that size.
    const s = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const cv = new OffscreenCanvas(Math.round(bitmap.width * s), Math.round(bitmap.height * s));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, cv.width, cv.height);
    const image = ctx.getImageData(0, 0, cv.width, cv.height);
    let stale = false;
    (async () => {
      // A labels PNG that does not arrive leaves the photo to the model.
      const segments = await presetSegments(preset).catch(() => null);
      if (stale) return;
      if (segments) {
        setSegments({ ...segments, labels: segments.labels.slice() });
        worker.current?.postMessage({ type: 'segments', segments: { w: segments.w, h: segments.h, labels: segments.labels } }, [segments.labels.buffer]);
        session.current.photo(image, { segments: { count: segments.count } });
        rerun();
      } else session.current.photo(image);
    })();
    return () => { stale = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- this must run once per photo; rerun only reposts the latest parameters
  }, [bitmap, readable, preset, worker]);

  return {
    seg, segments, session,
    segAccept: () => { remember('yes'); session.current.accept(); },
    segDecline: () => { remember('no'); session.current.decline(); },
    segRetry: () => session.current.retry(),
  };
}
