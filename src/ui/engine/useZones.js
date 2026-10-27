import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Touched shapes: [{ id, mode: null | 'more' | 'less', points: [[u, v, 1]] }].
// A shape just touched has no mode until one is chosen. Their pixels live in
// `zonePixels`, outside the history. `photoGen` is bumped on every new photo,
// so a touch answered late is not kept.
export function useZones({ session, worker, rerun, seg, photoGen }) {
  const [zones, setZones] = useState([]);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  // Pixels of the touched shapes, by zone id and then by the points that
  // gave them: { region, parts, partsLoading }. Undo and redo bring back
  // older points, so every version is kept until the photo changes.
  const zonePixels = useRef(new Map());
  const [pixelsVersion, setPixelsVersion] = useState(0);
  const zoneSeq = useRef(0);
  const pointsKey = (points) => JSON.stringify(points);
  const pixelsOf = (z) => zonePixels.current.get(z.id)?.get(pointsKey(z.points));
  const keepPixels = (id, points, region, parts = null) => {
    if (!zonePixels.current.has(id)) zonePixels.current.set(id, new Map());
    zonePixels.current.get(id).set(pointsKey(points), { region, parts });
  };
  // The zones with their pixels, for the viewer.
  const zonesView = useMemo(
    () => zones.map((z) => ({ ...z, region: pixelsOf(z)?.region ?? null, parts: pixelsOf(z)?.parts ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pixelsOf reads a ref; pixelsVersion says when it changed
    [zones, pixelsVersion],
  );
  // The zones with a mode go to the pipeline worker; "more" zones first get
  // their parts from the segmentation worker. Sent again only on a change.
  const sentZones = useRef('[]');
  useEffect(() => {
    const list = [], keys = [];
    for (const z of zones) {
      const px = pixelsOf(z);
      if (!z.mode || !px) continue;
      if (z.mode === 'more' && !px.parts && !px.partsLoading && !px.partsFailed) {
        px.partsLoading = true;
        session.current.parts(px.region).then(
          (parts) => { px.partsLoading = false; px.parts = parts; setPixelsVersion((v) => v + 1); },
          // No parts: the zone stays without pieces with intention until its
          // mode is set again or segmentation finishes after a retry.
          () => { px.partsLoading = false; px.partsFailed = true; },
        );
      }
      // A "more" zone changes nothing until its parts arrive.
      if (z.mode === 'more' && !px.parts) continue;
      list.push({ id: z.id, mode: z.mode, region: px.region, parts: z.mode === 'more' ? px.parts : null });
      keys.push([z.id, z.mode, px.region.box, z.points, !!px.parts]);
    }
    // The points are in the key too: a refined shape can keep the same box.
    const key = JSON.stringify(keys);
    if (key === sentZones.current || !worker.current) return;
    sentZones.current = key;
    worker.current.postMessage({ type: 'zones', zones: list });
    rerun();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pixelsOf reads a ref; pixelsVersion says when it changed
  }, [zones, pixelsVersion, rerun, session, worker]);
  // A new shape where the photo was touched at (u, v); resolves to its id,
  // null if there is none, or { error } if the search failed (declined,
  // model or worker error).
  const pickShape = useCallback(async (u, v) => {
    const points = [[u, v, 1]];
    const gen = photoGen.current;
    let region;
    try {
      region = await session.current.pick(points);
    } catch (e) { return { error: e?.message || String(e) }; }
    if (!region || gen !== photoGen.current) return null;
    const id = `z${++zoneSeq.current}`;
    keepPixels(id, points, region);
    setZones((zs) => [...zs, { id, mode: null, points }]);
    return id;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keepPixels only reads refs and sets state
  }, [photoGen, session]);
  // Another touch inside a shape grows or corrects it.
  const refineShape = useCallback(async (id, u, v) => {
    const z = zonesRef.current.find((x) => x.id === id);
    if (!z) return false;
    const points = [...z.points, [u, v, 1]];
    const gen = photoGen.current;
    try {
      const region = await session.current.pick(points);
      if (!region || gen !== photoGen.current) return false;
      keepPixels(id, points, region);
      setZones((zs) => zs.map((x) => (x.id === id ? { ...x, points } : x)));
      return true;
    } catch { return false; }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keepPixels only reads refs and sets state
  }, [photoGen, session]);
  // Setting the mode again asks once more for parts that failed before.
  const clearFailed = (id) => {
    let any = false;
    for (const [zid, versions] of zonePixels.current) {
      if (id !== undefined && zid !== id) continue;
      for (const px of versions.values()) if (px.partsFailed) { px.partsFailed = false; any = true; }
    }
    return any;
  };
  const setZoneMode = useCallback((id, mode) => {
    clearFailed(id);
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, mode } : z)));
  }, []);
  // Segmentation done (after a retry, say): failed parts are asked again.
  useEffect(() => {
    if (seg.phase === 'done' && clearFailed()) setPixelsVersion((v) => v + 1);
  }, [seg.phase]);
  const removeZone = useCallback((id) => setZones((zs) => zs.filter((z) => z.id !== id)), []);

  const restoreZones = setZones;
  // Shapes of a saved session, with their pixels: [{ id, mode, points, region, parts }].
  const loadZones = (list) => {
    for (const z of list) {
      keepPixels(z.id, z.points, z.region, z.parts);
      zoneSeq.current = Math.max(zoneSeq.current, Number(/^z(\d+)$/.exec(z.id)?.[1] ?? 0));
    }
    setZones(list.map(({ id, mode, points }) => ({ id, mode, points })));
    setPixelsVersion((v) => v + 1);
  };
  // A new photo: no zones, and the pipeline worker is told so.
  const resetZones = () => {
    zonePixels.current = new Map();
    setZones([]);
    sentZones.current = '[]';
    worker.current?.postMessage({ type: 'zones', zones: [] });
  };

  return { zones, zonesRef, zonesView, zonePixels, pixelsOf, loadZones, pickShape, refineShape, setZoneMode, removeZone, restoreZones, resetZones };
}
