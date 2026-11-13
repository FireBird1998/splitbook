/** Dimensions of the first-round boards, retained only as fixtures for their content pins. */
export const widgetDimensions = (size: '2x2' | '4x2' | '4x3') => ({
  width: size === '2x2' ? 182 : 372,
  height: size === '4x3' ? 304 : 200,
});
