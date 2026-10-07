/**
 * Where to scroll so that a section is wholly in view, with `margin` to spare below it,
 * scrolling down no further than needed: as when a note appears under a button at the bottom
 * of the screen. Null when the section already ends in view, or the view isn't laid out yet.
 */
export function scrollToShow(
  section: { top: number; height: number },
  view: { offset: number; viewport: number },
  margin = 16,
): number | null {
  if (view.viewport <= 0) return null;
  const bottom = section.top + section.height + margin;
  if (bottom <= view.offset + view.viewport) return null;
  return Math.max(0, bottom - view.viewport);
}
