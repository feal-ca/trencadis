// Holding a finger (or the mouse button) still on the image: the pencil uses
// it to remove the line under it. Plain logic without timers, so it can be
// tested: the layer calls tick(t) when the delay may have passed.

// `onFire(x, y)` is called once when a single pointer has stayed down for
// `delay` ms without moving more than `slop` px from where it went down. A
// second pointer (a pinch) or cancel() calls the press off; cancel() also
// forgets the pointers down. up(id) returns
// 'fired' if the press fired, so the layer neither draws nor adds a vertex.
export function createLongPress({ delay = 450, slop = 6, onFire }) {
  const down = new Set();
  // The press under way: { id, x, y, t, live, fired }.
  let press = null;
  return {
    down(id, x, y, t) {
      down.add(id);
      if (down.size > 1) { if (press) press.live = false; return; }
      press = { id, x, y, t, live: true, fired: false };
    },
    move(id, x, y) {
      if (press?.id === id && press.live && !press.fired && Math.hypot(x - press.x, y - press.y) > slop) press.live = false;
    },
    up(id) {
      down.delete(id);
      if (press?.id !== id) return null;
      const fired = press.fired;
      press = null;
      return fired ? 'fired' : null;
    },
    // Forgets every pointer too: after a pinch the viewer keeps the ups
    // from the layer, so they would otherwise stay down for good.
    cancel() {
      down.clear();
      press = null;
    },
    tick(t) {
      if (!press?.live || press.fired || t - press.t < delay) return;
      press.fired = true;
      onFire(press.x, press.y);
    },
  };
}

// The line of `lines` (polylines in normalised image coordinates) nearest
// to (u, v), as { index, dist }, or null if none is within `maxDist`.
// Distances are fractions of the image's long side; `aspect` is the image's
// width over its height.
export function nearestLine(lines, u, v, aspect, maxDist) {
  const sx = aspect >= 1 ? 1 : aspect, sy = aspect >= 1 ? 1 / aspect : 1;
  const px = u * sx, py = v * sy;
  let best = null;
  lines.forEach((line, index) => {
    for (let i = 0; i < line.length; i++) {
      const ax = line[i][0] * sx, ay = line[i][1] * sy;
      const [bx, by] = i + 1 < line.length ? [line[i + 1][0] * sx, line[i + 1][1] * sy] : [ax, ay];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const k = l2 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const dist = Math.hypot(px - ax - k * dx, py - ay - k * dy);
      if (dist <= maxDist && (!best || dist < best.dist)) best = { index, dist };
    }
  });
  return best;
}
