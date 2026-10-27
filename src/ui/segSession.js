// The segmentation session of the app: whether the model starts by itself
// or asks first, the progress of the coarse pass, and the touches on shapes
// (picks and their parts) sent to the segmentation worker (src/seg/worker.js).
// Plain logic without React, so it can be tested with a fake worker.

// Whether segmentation starts on its own ('auto'), asks first ('ask') or
// stays off ('off'). `stored` is the answer kept in localStorage
// (trencadis.seg.v1). Phones and browsers without WebGPU ask, because the
// model is a download and runs slowly on the CPU.
export function startPolicy({ touch, webgpu, stored }) {
  if (stored === 'yes') return 'auto';
  if (stored === 'no') return 'off';
  return touch || !webgpu ? 'ask' : 'auto';
}

// The URL overrides for the coarse pass, for trying values without
// rebuilding: ?samDevice=wasm|webgpu, ?segBatch=N and ?segPoints=N. Values
// that are not positive integers are ignored.
export function segOverrides(search) {
  const q = new URLSearchParams(search);
  const out = {};
  const device = q.get('samDevice');
  if (device) out.device = device;
  for (const [key, name] of [['segBatch', 'batch'], ['segPoints', 'points']]) {
    const v = q.get(key);
    if (v && /^[1-9]\d*$/.test(v)) out[name] = Number(v);
  }
  return out;
}

// `post(msg)` sends a message to the worker and `onState(state)` is called
// with every new state, where
//   state = { phase: 'idle' | 'ask' | 'off' | 'download' | 'encode' | 'decode' | 'done' | 'error',
//             done?, total?, found?, ms?, message?, preset? }.
// A photo can come with its segments already computed (`preset`, from
// photo()): then the coarse pass never runs, and the model is only loaded
// (to 'encode' the photo) when a pick or parts request needs it.
// Messages from the worker go to `receive(msg)`, which returns false for the
// ones it drops (those of a previous photo).
export function createSegSession({ post, onState = () => {}, policy = 'auto' }) {
  let state = { phase: 'idle' };
  // The photo (ImageData), its precomputed segments if any, and whether the
  // worker has been sent the photo to encode or segment.
  let image = null, preset = null, started = false;
  // Every message to the worker gets a new id; `current` is the id of the
  // coarse pass of the current photo, and anything older is stale.
  let seq = 0, current = 0;
  // Whether the model has been loaded once, so a new photo skips 'download'.
  let loaded = false;
  // Picks and parts sent to the worker, by id, and those waiting for the
  // user to accept segmentation.
  const pending = new Map();
  let queued = [];

  const set = (s) => { state = s; onState(s); };
  const start = () => {
    if (!image) return;
    current = ++seq;
    started = true;
    set(loaded ? { phase: 'encode', done: 0, total: 1 } : { phase: 'download', done: 0, total: 0 });
    post({ type: preset ? 'encode' : 'coarse', id: current, image });
  };
  const send = (r) => {
    const id = ++seq;
    pending.set(id, r);
    post({ type: r.type, id, ...r.msg });
  };
  const rejectAll = (list, why) => { for (const r of list) r.reject(new Error(why)); };
  // A pick or parts request. Before the user agrees to segment, it asks
  // and waits for the answer; between reset() and photo() it waits for the
  // new photo. After a failure it starts again first, as a retry would, so
  // a dead worker is replaced and gets the photo before the request.
  const request = (type, msg) => new Promise((resolve, reject) => {
    const r = { type, msg, resolve, reject };
    if (state.phase === 'error') start();
    if (state.phase === 'off' || state.phase === 'ask' || (preset && !started && policy !== 'auto')) {
      queued.push(r);
      set({ phase: 'ask' });
    } else if (!image) queued.push(r);
    else {
      if (preset && !started) start();
      send(r);
    }
  });
  const dropPending = (why) => {
    rejectAll(pending.values(), why);
    pending.clear();
  };

  return {
    get state() { return state; },
    // Forgets the photo at once, before the next one is ready: from here on
    // every result of the old photo is dropped and its requests rejected.
    reset() {
      image = preset = null;
      started = false;
      current = ++seq;
      dropPending('photo changed');
      rejectAll(queued, 'photo changed');
      queued = [];
      set({ phase: 'idle' });
    },
    // `segments` ({ w, h, labels, count }) are those of a sample that brings
    // them precomputed.
    photo(img, { segments = null } = {}) {
      dropPending('photo changed');
      // Requests queued after a reset() are for this photo; others are not.
      if (image) {
        rejectAll(queued, 'photo changed');
        queued = [];
      }
      image = img;
      preset = segments;
      started = false;
      if (preset) {
        // Results of the previous photo are stale even when nothing is sent.
        current = ++seq;
        set({ phase: 'done', found: preset.count, preset: true });
        if (queued.length) {
          if (policy === 'auto') { start(); queued.forEach(send); queued = []; } else set({ phase: 'ask' });
        }
      } else if (policy === 'auto') {
        start();
        const q = queued;
        queued = [];
        q.forEach(send);
      } else {
        // Results of the previous photo are stale even when nothing starts.
        current = ++seq;
        set({ phase: policy === 'ask' || queued.length ? 'ask' : 'off' });
      }
    },
    // The worker died (or never loaded): nothing it had will answer.
    fail(message) {
      dropPending(message);
      if (image) set({ phase: 'error', message });
    },
    accept() {
      policy = 'auto';
      start();
      const q = queued;
      queued = [];
      q.forEach(send);
    },
    decline() {
      policy = 'off';
      rejectAll(queued, 'segmentation declined');
      queued = [];
      set({ phase: 'off' });
    },
    retry: start,
    // `points` are [[u, v, 1 | 0]], normalised, 1 for a positive point.
    pick: (points) => request('pick', { points }),
    parts: (region) => request('parts', { region }),
    receive(msg) {
      // Picks of the current photo are matched first: a retry moves
      // `current` past them, but they still belong to this photo.
      const r = pending.get(msg.id);
      if (r) {
        pending.delete(msg.id);
        if (msg.type === 'error') r.reject(new Error(msg.message));
        else r.resolve(msg.type === 'shape' ? msg.region : msg.parts);
        return true;
      }
      if (msg.id < current) return false;
      if (msg.id !== current) return true;
      if (msg.type === 'progress') {
        if (msg.phase !== 'download') loaded = true;
        set({ phase: msg.phase, done: msg.done, total: msg.total, found: msg.found });
      } else if (msg.type === 'encoded') {
        loaded = true;
        set({ phase: 'done', found: preset?.count, preset: true });
      } else if (msg.type === 'segments') {
        loaded = true;
        set({ phase: 'done', found: msg.count, ms: msg.ms });
      } else if (msg.type === 'error') {
        set({ phase: 'error', message: msg.message });
      }
      return true;
    },
  };
}
