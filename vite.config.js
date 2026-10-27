import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// transformers.js points `wasmPaths` at jsDelivr, so the ONNX runtime WASM that Vite copies into the bundle is never requested. Drop it from the worker's output.
const dropUnusedOrtWasm = {
  name: 'drop-unused-ort-wasm',
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) {
      if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
    }
  },
};

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es', plugins: () => [dropUnusedOrtWasm] },
  // The dependency scan does not follow `new Worker(new URL(...))`, so without this the model's library is found late and the page reloads.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  // Cross-origin isolation in dev, so WASM can use threads (coi-serviceworker does the same in production).
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
});
