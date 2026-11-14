import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import type { headerCard } from '@splitbook/shared/group-header';
import { createAppTheme } from '@/lib/theme/createAppTheme';

const darkTheme = createAppTheme('dark');

/** Scope the existing dark tokens to the scene's card and its text. */
export function SceneCardTheme({
  tone,
  children,
}: {
  tone: ReturnType<typeof headerCard>['tone'];
  children: ReactNode;
}) {
  return tone === 'dark' ? <ThemeProvider theme={darkTheme}>{children}</ThemeProvider> : children;
}
