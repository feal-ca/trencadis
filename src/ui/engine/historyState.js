// What a history step may bring back: only lines drawn on the current photo
// (`gen`) and shapes that still have their pixels. Anything else belongs to an
// earlier photo and is left out. A part the state lacks stays absent.
export function ownState(state, { gen, hasZone }) {
  const own = { ...state };
  if (state.zones) own.zones = state.zones.filter((z) => hasZone(z.id));
  if (state.guides) own.guides = state.guides.filter((g) => g.gen === gen);
  return own;
}
