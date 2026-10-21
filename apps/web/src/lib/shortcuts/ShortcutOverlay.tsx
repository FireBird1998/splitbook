'use client';

// THROWAWAY #715: MUI's lifecycle activates TanStack's exclusive overlay scope.
import { HotkeysProvider } from '@tanstack/react-hotkeys';
import { forwardRef, useId, type ComponentProps, type PropsWithChildren } from 'react';
import Popper, { type PopperProps } from '@mui/material/Popper';

export const SEARCH_SCOPE = 'splitbook-search';

export function ShortcutOverlay({
  active = true,
  children,
}: PropsWithChildren<{ active?: boolean }>) {
  const scope = useId();
  return (
    <HotkeysProvider scope={scope} enabled={active} exclusive={{ allow: [SEARCH_SCOPE] }}>
      {children}
    </HotkeysProvider>
  );
}

/** MUI keeps exiting portals mounted; its public hidden class marks a closed kept root. */
export const ShortcutModalRoot = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  function ShortcutModalRoot({ children, className, ...props }, ref) {
    const active = !className?.split(/\s+/).includes('MuiModal-hidden');
    return (
      <div {...props} className={className} ref={ref}>
        <ShortcutOverlay active={active}>{children}</ShortcutOverlay>
      </div>
    );
  },
);

/** Autocomplete uses a Popper rather than Modal; its listbox needs the same boundary. */
export const ShortcutPopper = forwardRef<HTMLDivElement, PopperProps>(
  function ShortcutPopper(props, ref) {
    return (
      <ShortcutOverlay active={props.open}>
        <Popper {...props} ref={ref} />
      </ShortcutOverlay>
    );
  },
);
