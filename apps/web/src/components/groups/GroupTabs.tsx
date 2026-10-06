'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import { GROUP_TABS, groupTabFromPath, groupTabHref } from './group-tabs';

interface GroupTabsProps {
  groupId: string;
  /** The navigation's name, e.g. "Maple House sections". */
  label: string;
}

/**
 * A Group's tabs as links (#305, design canvas .tabs): each opens its own address, and the
 * one for the page you're on is marked current. They are navigation, not an in-page tab list,
 * so Back, reload and a shared link all work as they do for any other link.
 */
export default function GroupTabs({ groupId, label }: GroupTabsProps) {
  const current = groupTabFromPath(usePathname() ?? '');

  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{
        display: 'flex',
        gap: 0.5,
        // The rule under the tabs is drawn inside the bar, so the open tab's 2 px line can
        // cover it: a scrolling box clips anything its children draw over its own border.
        boxShadow: (theme) => `inset 0 -1px 0 ${theme.palette.divider}`,
        overflowX: 'auto',
      }}
    >
      {GROUP_TABS.map((tab) => (
        <Box
          key={tab.slug}
          component={Link}
          href={groupTabHref(groupId, tab.slug)}
          aria-current={tab.slug === current ? 'page' : undefined}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            flex: 'none',
            minHeight: 46,
            px: '14px',
            borderBottom: '2px solid',
            borderColor: 'transparent',
            color: 'text.secondary',
            fontSize: '0.875rem',
            fontWeight: 500,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            '&:hover': { color: 'text.primary' },
            // The bar scrolls sideways on phones and clips anything outside a link, so the
            // focus outline is drawn inside it.
            '&:focus-visible': { outlineOffset: '-2px', boxShadow: 'none' },
            '&[aria-current="page"]': {
              color: 'text.primary',
              fontWeight: 600,
              borderColor: 'primary.main',
            },
          }}
        >
          {tab.label}
        </Box>
      ))}
    </Box>
  );
}
