// GLSL for the mosaic renderer. All passes except the first draw a single
// full-screen triangle.

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Pass 1: shard index (+1, so 0 means "no shard") packed into RGB.
export const ID_VS = `#version 300 es
in vec2 aPos;
in float aId;
uniform vec2 uWork;
flat out int vId;
void main() {
  vId = int(aId + 0.5) + 1;
  gl_Position = vec4(aPos.x / uWork.x * 2.0 - 1.0, 1.0 - aPos.y / uWork.y * 2.0, 0.0, 1.0);
}`;

export const ID_FS = `#version 300 es
precision highp float;
flat in int vId;
out vec4 o;
void main() {
  o = vec4(float(vId & 255), float((vId >> 8) & 255), float((vId >> 16) & 255), 255.0) / 255.0;
}`;

const DECODE = `
int idAt(sampler2D t, ivec2 q) {
  ivec2 s = textureSize(t, 0);
  q = clamp(q, ivec2(0), s - 1);
  vec4 c = texelFetch(t, q, 0) * 255.0 + 0.5;
  return int(c.r) | (int(c.g) << 8) | (int(c.b) << 16);
}`;

// Pass 2: boundary pixels (index differs from a 4-neighbour, or no shard)
// store their own position; the rest store -1.
export const SEED_FS = `#version 300 es
precision highp float;
uniform sampler2D uId;
out vec4 o;
${DECODE}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int c = idAt(uId, q);
  bool edge = c == 0
    || idAt(uId, q + ivec2(1, 0)) != c || idAt(uId, q - ivec2(1, 0)) != c
    || idAt(uId, q + ivec2(0, 1)) != c || idAt(uId, q - ivec2(0, 1)) != c;
  o = edge ? vec4(gl_FragCoord.xy, 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}`;

// Pass 3: jump flooding. Each pass looks at 9 samples `uStep` pixels apart
// and keeps the closest seed.
export const JFA_FS = `#version 300 es
precision highp float;
uniform sampler2D uSeeds;
uniform int uStep;
out vec4 o;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 s = textureSize(uSeeds, 0);
  vec2 p = gl_FragCoord.xy;
  vec2 best = vec2(-1.0);
  float bd = 1e20;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 r = q + ivec2(dx, dy) * uStep;
      if (r.x < 0 || r.y < 0 || r.x >= s.x || r.y >= s.y) continue;
      vec2 seed = texelFetch(uSeeds, r, 0).xy;
      if (seed.x < 0.0) continue;
      float d = dot(seed - p, seed - p);
      if (d < bd) { bd = d; best = seed; }
    }
  }
  o = vec4(best, 0.0, 1.0);
}`;

// Pass 4: grout, bevel, glaze tilt and a Blinn-Phong highlight.
export const SHADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uId;
uniform sampler2D uSeeds;
uniform sampler2D uColor;
uniform sampler2D uTilt;
uniform float uScale;      // output px per working px
uniform float uGrout, uBevel, uBevelStrength, uGroutShadow;
uniform float uTiltAmount, uAmbient, uSpecular, uShininess, uGlaze;
uniform vec3 uMortar;
uniform vec3 uLight;
uniform float uSeed;
out vec4 o;
${DECODE}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.1234);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int id = idAt(uId, q);
  vec2 seed = texelFetch(uSeeds, q, 0).xy;
  vec2 p = gl_FragCoord.xy;
  float d = seed.x < 0.0 ? 0.0 : length(p - seed);
  float g = uGrout * uScale * 0.5;
  float grain = hash(floor(p / max(1.0, 1.5 * uScale / 2.0))) - 0.5;

  float shadeM = 1.0 - uGroutShadow * (g > 0.0 ? clamp(d / g, 0.0, 1.0) : 0.0) * 0.6;
  vec3 mortar = uMortar * shadeM * (1.0 + grain * 0.12);
  if (id == 0) { o = vec4(mortar, 1.0); return; }

  int k = id - 1;
  ivec2 tq = ivec2(k % 1024, k / 1024);
  vec3 base = texelFetch(uColor, tq, 0).rgb;
  vec2 tilt = texelFetch(uTilt, tq, 0).xy * uTiltAmount;

  // Inward direction from the nearest edge, flipped to screen space (y down).
  vec2 dir = d > 0.0 ? (p - seed) / d : vec2(0.0);
  dir.y = -dir.y;
  float bw = max(1e-3, uBevel * uScale);
  float di = d - g;
  float t = pow(1.0 - clamp(di / bw, 0.0, 1.0), 2.0) * uBevelStrength;
  vec3 n = normalize(vec3(tilt - dir * t, 1.0));
  float edgeShade = 1.0 - 0.15 * t;

  vec3 H = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float ndl = max(0.0, dot(n, uLight));
  float light = (uAmbient + (1.0 - uAmbient) * ndl / max(0.15, uLight.z)) * edgeShade;
  float spec = uSpecular * pow(max(0.0, dot(n, H)), uShininess);
  vec3 tile = base * light * (1.0 + grain * uGlaze * 2.0) + spec;

  float aa = max(0.75, fwidth(d));
  float m = smoothstep(g - aa, g + aa, d);
  o = vec4(mix(mortar, tile, m), 1.0);
}`;
