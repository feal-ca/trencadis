import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  // The dependency scan does not follow `new Worker(new URL(...))`, so without this the model's library is found late and the page reloads.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  // Cross-origin isolation in dev, so WASM can use threads (coi-serviceworker does the same in production).
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
});
