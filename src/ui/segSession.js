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

// `post(msg)` sends a message to the worker and `onState(state)` is called
// with every new state, where
//   state = { phase: 'idle' | 'ask' | 'off' | 'download' | 'encode' | 'decode' | 'done' | 'error',
//             done?, total?, found?, ms?, message? }.
// Messages from the worker go to `receive(msg)`, which returns false for the
// ones it drops (those of a previous photo).
export function createSegSession({ post, onState = () => {}, policy = 'auto' }) {
  let state = { phase: 'idle' };
  let blob = null;
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
    if (!blob) return;
    current = ++seq;
    set(loaded ? { phase: 'encode', done: 0, total: 1 } : { phase: 'download', done: 0, total: 0 });
    post({ type: 'coarse', id: current, blob });
  };
  const send = (r) => {
    const id = ++seq;
    pending.set(id, r);
    post({ type: r.type, id, ...r.msg });
  };
  const rejectAll = (list, why) => { for (const r of list) r.reject(new Error(why)); };
  // A pick or parts request. Before the user agrees to segment, it asks
  // and waits for the answer.
  const request = (type, msg) => new Promise((resolve, reject) => {
    const r = { type, msg, resolve, reject };
    if (state.phase === 'off' || state.phase === 'ask') {
      queued.push(r);
      set({ phase: 'ask' });
    } else send(r);
  });

  return {
    get state() { return state; },
    photo(b) {
      blob = b;
      rejectAll(pending.values(), 'photo changed');
      pending.clear();
      rejectAll(queued, 'photo changed');
      queued = [];
      if (policy === 'auto') start();
      else {
        // Results of the previous photo are stale even when nothing starts.
        current = ++seq;
        set({ phase: policy === 'ask' ? 'ask' : 'off' });
      }
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
