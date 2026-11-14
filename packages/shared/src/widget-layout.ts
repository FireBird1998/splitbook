/** A widget gives up optional lines before it gives up readable type. */
export function widgetTextLevel(scale: number) {
  const percent = Math.round(scale * 100);
  return percent >= 200 ? 2 : percent >= 130 ? 1 : 0;
}
