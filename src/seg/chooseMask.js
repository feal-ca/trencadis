// Which of the model's candidate masks a touch takes, from their predicted
// IoUs, their areas and the number of prompt points. The confident masks are
// the non-empty ones within MARGIN of the best IoU among non-empty masks;
// sorted by area, the first touch takes the smallest and with n points it
// takes the n-th smallest, stopping at the largest. The candidates are those
// of the current prompt, so a refined mask is not always larger. It depends on
// the points alone, so a zone re-derived from its stored points gets the same
// mask. Ties in area keep the model's order. Returns the mask's index, or -1
// when every mask is empty.
const MARGIN = 0.05;

export function chooseMask(ious, areas, nPoints) {
  let best = -Infinity;
  for (let m = 0; m < areas.length; m++) if (areas[m] > 0 && ious[m] > best) best = ious[m];
  const cands = [];
  // The 1e-6 keeps a mask exactly MARGIN below the best in, despite rounding.
  for (let m = 0; m < areas.length; m++) if (areas[m] > 0 && ious[m] >= best - MARGIN - 1e-6) cands.push(m);
  if (!cands.length) return -1;
  cands.sort((a, b) => areas[a] - areas[b]);
  return cands[Math.min(Math.max(0, nPoints - 1), cands.length - 1)];
}
