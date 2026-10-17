'use client';
import { useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { reviewDate, type ReviewItemModel } from '@splitbook/shared/to-review';
import type { ItemQuickFixes, QuickFixFact } from '@splitbook/shared/to-review-quick-fixes';
import { FONT_MONO, RADIUS } from '@/lib/theme/tokens';
import { reviewAmount, reviewSource } from './ReviewDetails';

const chip = {
  minHeight: { xs: 44, md: 36 },
  px: 1.5,
  borderRadius: `${RADIUS.sm}px`,
  fontWeight: 500,
  color: 'text.primary',
  borderColor: 'border.strong',
  bgcolor: 'background.paper',
  '&:hover': { bgcolor: 'surface.hover', borderColor: 'border.strong' },
} as const;
const suggestedChip = {
  ...chip,
  fontWeight: 600,
  color: 'primary.main',
  borderColor: 'primary.main',
  bgcolor: 'tint.brand',
  '&:hover': { bgcolor: 'tint.brand', borderColor: 'primary.main' },
} as const;
const keyHint = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  lineHeight: '16px',
  px: 0.5,
  border: 1,
  borderColor: 'border.strong',
  borderRadius: '4px',
  mr: 0.75,
} as const;

/**
 * One To review row: an open control plus its own quick fixes, Save and ⋯ menu, never nested
 * inside the open control. Chips only fill in a fact; Save records exactly the version shown.
 */
export default function ReviewRow({
  item,
  quick,
  currency,
  open,
  selected,
  disabled,
  openDisabled,
  showAll,
  registerOpen,
  onOpen,
  onFocus,
  onPick,
  onMore,
  onSave,
  onDelete,
}: {
  item: ReviewItemModel;
  quick: ItemQuickFixes;
  /** The Group's currency, which an item without its own is in (#512). */
  currency?: string;
  open: boolean;
  selected: boolean;
  /** Quick fixes, Save and Delete: off while busy, offline or another item is open. */
  disabled: boolean;
  /** Opening an item stays possible offline, as before. */
  openDisabled: boolean;
  showAll: ReadonlySet<QuickFixFact>;
  registerOpen: (element: HTMLButtonElement | null) => void;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onPick: (fact: QuickFixFact, optionId: string) => void;
  onMore: (fact: QuickFixFact) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  // A missing fact is said once, in the Needs line, so its place here stays empty (#512).
  const values = item.accountItem?.draft.values ?? {};
  const title = values.description || 'Expense to review';
  const meta = [values.date && reviewDate(values.date), reviewSource(item.accountItem!)]
    .filter(Boolean)
    .join(' · ');
  const groups = quick.fixes.map((fix) => ({
    fix,
    options: showAll.has(fix.fact) ? fix.options : fix.visible,
  }));
  // Number keys run across the row's chips in order: who paid first, then the Tag.
  const starts = groups.map((_, index) =>
    groups.slice(0, index).reduce((sum, group) => sum + group.options.length, 0),
  );
  return (
    <Box
      component="article"
      aria-label={title}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: open || selected ? 'primary.main' : 'divider',
        borderRadius: `${RADIUS.md}px`,
        p: 2,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box
          component="button"
          type="button"
          ref={registerOpen}
          disabled={openDisabled}
          aria-expanded={open}
          aria-controls={open ? 'to-review-expense-panel' : undefined}
          aria-label={`Review ${item.accountItem?.draft.values?.description || 'expense'}`}
          onClick={onOpen}
          onFocus={onFocus}
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            textAlign: 'left',
            font: 'inherit',
            color: 'text.primary',
            bgcolor: 'transparent',
            border: 0,
            p: 0,
            cursor: 'pointer',
            '&:disabled': { cursor: 'default' },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'focus.main',
              outlineOffset: 4,
            },
          }}
        >
          <Typography component="span" display="block" fontWeight={600}>
            {title}
          </Typography>
          <Typography component="span" display="block" variant="body2" color="text.secondary">
            {meta}
          </Typography>
          {quick.summary && (
            <Typography component="span" display="block" variant="body2">
              {quick.summary}
            </Typography>
          )}
          {item.state === 'duplicate' && !!item.accountItem?.duplicates.length && (
            <Typography
              component="span"
              display="block"
              variant="body2"
              fontWeight={600}
              sx={{ color: 'status.warning' }}
            >
              Looks like “{item.accountItem.duplicates[0].description}”. Open it to check.
            </Typography>
          )}
        </Box>
        {values.amount !== undefined && (
          <Typography sx={{ fontFamily: FONT_MONO, flexShrink: 0, pt: 0.25 }}>
            {reviewAmount(values, currency)}
          </Typography>
        )}
        {item.state === 'ready' && (
          <Button
            variant="outlined"
            size="small"
            disabled={disabled}
            aria-label={`Save ${title}`}
            onClick={onSave}
            sx={{ flexShrink: 0, minHeight: { xs: 44, md: 32 } }}
          >
            {selected && (
              <Box component="kbd" sx={keyHint}>
                S
              </Box>
            )}
            Save
          </Button>
        )}
        <IconButton
          aria-label={`More for ${title}`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          disabled={disabled}
          onClick={(event) => setMenu(event.currentTarget)}
          sx={{ flexShrink: 0, mt: -0.5 }}
        >
          <MoreHorizIcon />
        </IconButton>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          <MenuItem
            onClick={() => {
              setMenu(null);
              onDelete();
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      </Stack>
      {groups.map(({ fix, options }, group) => {
        return (
          <Box
            key={fix.fact}
            role="group"
            aria-label={`${fix.fact === 'paidBy' ? 'Who paid for' : 'Tag for'} ${title}`}
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ mr: 0.5 }}>
              {fix.question}
            </Typography>
            {options.map((option, index) => {
              const key = starts[group] + index + 1;
              return (
                <Button
                  key={option.id}
                  variant="outlined"
                  disabled={disabled}
                  aria-label={option.suggested ? `${option.label}, suggested` : option.label}
                  onClick={() => onPick(fix.fact, option.id)}
                  sx={option.suggested ? suggestedChip : chip}
                >
                  {selected && key <= 9 && (
                    <Box component="kbd" sx={keyHint}>
                      {key}
                    </Box>
                  )}
                  {option.label}
                </Button>
              );
            })}
            {fix.hasMore && !showAll.has(fix.fact) && (
              <Button
                variant="text"
                disabled={disabled}
                onClick={() => onMore(fix.fact)}
                sx={{ minHeight: { xs: 44, md: 36 }, color: 'text.secondary' }}
              >
                More…
              </Button>
            )}
          </Box>
        );
      })}
      {item.state === 'needs-details' && quick.stillNeeds.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            mt: 1.5,
            pt: quick.fixes.length ? 1.5 : 0,
            borderTop: quick.fixes.length ? 1 : 0,
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {quick.fixes.length ? 'Still needs: ' : 'Needs '}
            {quick.stillNeeds.join(', ')}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            disabled={openDisabled}
            onClick={(event) => onOpen(event as MouseEvent<HTMLButtonElement>)}
            sx={{ flexShrink: 0, minHeight: { xs: 44, md: 32 } }}
          >
            Fix the rest
          </Button>
        </Stack>
      )}
    </Box>
  );
}
