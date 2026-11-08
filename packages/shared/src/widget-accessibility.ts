/** Separate sentences keep spoken state, amounts and verification time unambiguous. */
export function widgetSummary(parts: (string | null | undefined)[]) {
  return (
    parts
      .filter((part): part is string => Boolean(part))
      .map((part) => part.replace(/[.]+$/, ''))
      .join('. ') + '.'
  );
}
