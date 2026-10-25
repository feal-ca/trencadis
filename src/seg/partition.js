// Partition: each pixel belongs to the smallest mask covering it (-1: none).
export function partition({ w, h, masks }) {
  const order = masks.map((m, i) => i).sort((a, b) => masks[b].area - masks[a].area);
  const label = new Int32Array(w * h).fill(-1);
  for (const i of order) {
    const d = masks[i].data;
    for (let k = 0; k < w * h; k++) if (d[k]) label[k] = i;
  }
  return label;
}
