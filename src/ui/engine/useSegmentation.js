import { useEffect, useRef, useState } from 'react';
import { createSegSession, segOverrides, startPolicy } from '../segSession.js';
import { TOUCH } from '../useMedia.js';
import { DEBUG } from './usePipeline.js';

// The answer to "Buscar las formas de la foto": 'yes' or 'no'.
const SEG_STORE = 'trencadis.seg.v1';

// Segmentation (segSession.js): the objects of the photo, found by a model
// in its own worker, give rows along their outlines and cuts; touched
// shapes come from the same model. The worker is created on first use, so
// nothing is downloaded until segmentation starts. `worker` is the pipeline's.
export function useSegmentation({ bitmap, readable, worker, rerun }) {
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
    onState: setSeg,
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
    cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
    let stale = false;
    cv.convertToBlob({ type: 'image/png' }).then((blob) => { if (!stale) session.current.photo(blob); });
    return () => { stale = true; };
  }, [bitmap, readable, worker]);

  return {
    seg, segments, session,
    segAccept: () => { remember('yes'); session.current.accept(); },
    segDecline: () => { remember('no'); session.current.decline(); },
    segRetry: () => session.current.retry(),
  };
}
