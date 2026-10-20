import { mortarRgb } from '../core/color.js';
import { toWorkPx } from '../core/params.js';
import { PLACE } from '../core/placement.js';
import { mulberry32 } from '../core/rng.js';
import { FULLSCREEN_VS, ID_FS, ID_VS, JFA_FS, SEED_FS, SHADE_FS } from './shaders.js';
import { triangulate } from './triangulate.js';

const DATA_WIDTH = 1024;

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    loc[name] = gl.getUniformLocation(p, name);
  }
  return { p, loc };
}

function texture(gl, internal, format, type, w, h, data = null) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  return t;
}

// Real-time mosaic renderer. Geometry and the distance field are rebuilt only
// when the shards or the output size change; every other parameter is a
// uniform of the final shading pass.
export function createRenderer(canvas, { onLost } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { ok: false };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.ok = false; onLost?.(); });

  const progId = program(gl, ID_VS, ID_FS);
  const progSeed = program(gl, FULLSCREEN_VS, SEED_FS);
  const progJfa = program(gl, FULLSCREEN_VS, JFA_FS);
  const progShade = program(gl, FULLSCREEN_VS, SHADE_FS);
  const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  const emptyVao = gl.createVertexArray();

  let vao = null, vertexCount = 0, work = [1, 1], rowFlags = [];
  let colorTex = null, tiltTex = null;
  let targets = null, fieldDirty = true, placed = null;

  const makeTargets = (W, H) => {
    if (targets) for (const t of [targets.id, targets.a, targets.b]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const mk = (internal, format, type) => {
      const tex = texture(gl, internal, format, type, W, H);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    };
    targets = { W, H, id: mk(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), a: mk(gl.RG32F, gl.RG, gl.FLOAT), b: mk(gl.RG32F, gl.RG, gl.FLOAT) };
    fieldDirty = true;
  };

  const buildField = (place) => {
    const { W, H } = targets;
    gl.viewport(0, 0, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.id.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (vao) {
      gl.useProgram(progId.p);
      gl.uniform2f(progId.loc.uWork, work[0], work[1]);
      gl.uniform1f(progId.loc.uPlace, place);
      gl.uniform3f(progId.loc.uPlaceMax, (PLACE.angle * Math.PI) / 180, PLACE.offset, PLACE.shrink);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }
    gl.bindVertexArray(emptyVao);
    gl.useProgram(progSeed.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.a.fb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.id.tex);
    gl.uniform1i(progSeed.loc.uId, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(progJfa.p);
    gl.uniform1i(progJfa.loc.uSeeds, 0);
    let src = targets.a, dst = targets.b;
    const steps = [];
    for (let s = 2 ** Math.ceil(Math.log2(Math.max(W, H))) / 2; s >= 1; s /= 2) steps.push(s);
    steps.push(1);
    for (const s of steps) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(progJfa.loc.uStep, s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [src, dst] = [dst, src];
    }
    targets.field = src;
    fieldDirty = false;
    placed = place;
  };

  const api = {
    ok: true,
    maxSize,
    setShards(shards, w, h, seed = 1) {
      const { positions, ids, centers, place } = triangulate(shards, seed);
      rowFlags = shards.map((s) => !!s.row);
      if (vao) gl.deleteVertexArray(vao);
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      for (const [name, data, size] of [['aPos', positions, 2], ['aId', ids, 1], ['aCenter', centers, 2], ['aPlace', place, 3]]) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(progId.p, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(null);
      vertexCount = positions.length / 2;
      work = [w, h];
      fieldDirty = true;
    },
    setColors(colors, seed) {
      const n = colors.length / 3;
      const rows = Math.max(1, Math.ceil(n / DATA_WIDTH));
      const col = new Float32Array(DATA_WIDTH * rows * 4);
      const tilt = new Float32Array(DATA_WIDTH * rows * 4);
      const rng = mulberry32(seed * 7919 + 13);
      for (let i = 0; i < n; i++) {
        col.set([colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], 1], i * 4);
        // Row pieces tilt half as much, so a row reads as one even band.
        const k = rowFlags[i] ? 0.5 : 1;
        tilt[i * 4] = rng.normal() * k;
        tilt[i * 4 + 1] = rng.normal() * k;
        tilt[i * 4 + 2] = rowFlags[i] ? 1 : 0;
      }
      for (const t of [colorTex, tiltTex]) if (t) gl.deleteTexture(t);
      colorTex = texture(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT, DATA_WIDTH, rows, col);
      tiltTex = texture(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT, DATA_WIDTH, rows, tilt);
    },
    // Size of the output for a given long side, keeping the working aspect.
    sizeFor(long) {
      const L = Math.min(maxSize, Math.max(1, Math.round(long)));
      const s = L / Math.max(work[0], work[1]);
      return [Math.max(1, Math.round(work[0] * s)), Math.max(1, Math.round(work[1] * s))];
    },
    render(p, W, H) {
      p = toWorkPx(p);
      if (!api.ok || !colorTex) return;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      if (!targets || targets.W !== W || targets.H !== H) makeTargets(W, H);
      // Placement moves the pieces, so it needs a new distance field.
      if (fieldDirty || placed !== p.place) buildField(p.place);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.bindVertexArray(emptyVao);
      const { p: prog, loc } = progShade;
      gl.useProgram(prog);
      [[targets.id.tex, 'uId'], [targets.field.tex, 'uSeeds'], [colorTex, 'uColor'], [tiltTex, 'uTilt']].forEach(([t, name], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(loc[name], i);
      });
      const az = (p.lightAz * Math.PI) / 180, el = (p.lightEl * Math.PI) / 180;
      gl.uniform1f(loc.uScale, W / work[0]);
      gl.uniform1f(loc.uGrout, p.grout);
      gl.uniform1f(loc.uBevel, p.bevel);
      gl.uniform1f(loc.uBevelStrength, p.bevelStrength);
      gl.uniform1f(loc.uGroutShadow, p.groutShadow);
      gl.uniform1f(loc.uTiltAmount, p.tilt);
      gl.uniform1f(loc.uAmbient, p.ambient);
      gl.uniform1f(loc.uSpecular, p.specular);
      gl.uniform1f(loc.uShininess, p.shininess);
      gl.uniform1f(loc.uGlaze, p.glazeNoise);
      gl.uniform1f(loc.uSeed, p.seed);
      gl.uniform1f(loc.uRowGrout, p.rowGrout ?? 1);
      gl.uniform3fv(loc.uMortar, mortarRgb(p));
      gl.uniform3f(loc.uLight, Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.sin(el));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    // Render at export size and encode. The caller re-renders at display size.
    toBlob(p, long, type = 'image/png', quality) {
      const [W, H] = api.sizeFor(long);
      api.render(p, W, H);
      return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    },
  };
  return api;
}
