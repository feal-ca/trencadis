// Polygons are arrays of [x, y] points, implicitly closed.

export function signedArea(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export const area = (P) => Math.abs(signedArea(P));

export function centroid(P) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const m = P.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
    return [m[0] / P.length, m[1] / P.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function perimeter(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

// Keep the side of the line through (px,py) where (q - p) . n >= 0.
// Sutherland-Hodgman against a single half-plane.
export function clipHalfPlane(P, px, py, nx, ny) {
  const out = [];
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const da = (a[0] - px) * nx + (a[1] - py) * ny;
    const db = (b[0] - px) * nx + (b[1] - py) * ny;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

export function splitByLine(P, px, py, nx, ny) {
  return [clipHalfPlane(P, px, py, nx, ny), clipHalfPlane(P, px, py, -nx, -ny)];
}

// Smallest interior angle in radians (meaningful for convex polygons).
export function minAngle(P) {
  let m = Math.PI;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
    if (ang < m) m = ang;
  }
  return m;
}

// Isoperimetric ratio: 1 for a disc, about 1.27 for a square, large for slivers.
export const elongation = (P) => {
  const a = area(P);
  return a > 1e-9 ? perimeter(P) ** 2 / (4 * Math.PI * a) : Infinity;
};

export function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function pointInPolygon(P, x, y) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Scanline fill (even-odd) sampling pixel centres. Calls fn(x, y) per pixel.
export function rasterize(P, w, h, fn, scale = 1) {
  if (P.length < 3) return;
  let y0 = Infinity, y1 = -Infinity;
  for (const q of P) {
    if (q[1] * scale < y0) y0 = q[1] * scale;
    if (q[1] * scale > y1) y1 = q[1] * scale;
  }
  const ys = Math.max(0, Math.ceil(y0 - 0.5)), ye = Math.min(h - 1, Math.floor(y1 - 0.5));
  const xs = [];
  const n = P.length;
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const ax = P[i][0] * scale, ay = P[i][1] * scale;
      const bx = P[(i + 1) % n][0] * scale, by = P[(i + 1) % n][1] * scale;
      if (ay > cy !== by > cy) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) fn(x, y);
    }
  }
}

// Douglas-Peucker on a closed ring. Splits at the vertex farthest from P[0].
export function simplifyClosed(P, eps) {
  if (eps <= 0 || P.length <= 4) return P;
  let far = 0, fd = -1;
  for (let i = 1; i < P.length; i++) {
    const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = douglasPeucker(P.slice(0, far + 1), eps);
  const b = douglasPeucker(P.slice(far).concat([P[0]]), eps);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : P;
}

// Douglas-Peucker on an open run: keeps the ends and every point farther than
// eps from the chord. With coincident ends, the distance is to that point.
export function douglasPeucker(pts, eps) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  let idx = -1, md = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 1e-9
      ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len
      : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [pts[0], pts[pts.length - 1]];
  const l = douglasPeucker(pts.slice(0, idx + 1), eps);
  return l.slice(0, -1).concat(douglasPeucker(pts.slice(idx), eps));
}
