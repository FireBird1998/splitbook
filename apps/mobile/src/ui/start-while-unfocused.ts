import { useState } from 'react';

const START = Object.freeze({ start: 0, end: 0 });

/**
 * Android opens a filled single-line input scrolled to its end, so at large text the start of a
 * long value is cut off (#525). The input shows its start while the member isn't in it; once
 * they focus it, the cursor is theirs. Spread the result on the input; `onBlur` runs on leaving.
 */
export function useStartWhileUnfocused(onBlur?: () => void) {
  const [focused, setFocused] = useState(false);
  return {
    selection: focused ? undefined : START,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      onBlur?.();
    },
  };
}
