'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { CURRENCIES } from '@/lib/utils/currency';
import {
  isValidParticipantEmail,
  normalizeParticipantEmails,
  validateTripDates,
} from '@/lib/utils/trip-setup';
import { GROUP_THEME_LIST, getGroupTheme } from '@/lib/group-themes';
import type { GroupCategory } from '@/types';

export default function NewGroupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [category, setCategory] = useState<GroupCategory>('trip');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [participantInput, setParticipantInput] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);

  const [description, setDescription] = useState('');
  const [alternateCurrencies, setAlternateCurrencies] = useState<string[]>([]);

  const theme = getGroupTheme(category);
  const nounTitle = theme.nouns.singular.charAt(0).toUpperCase() + theme.nouns.singular.slice(1);
  const showDates = theme.dates === 'bounded';
  const dateError = showDates ? validateTripDates(startDate || null, endDate || null) : null;

  const addParticipant = () => {
    const email = participantInput.trim().toLowerCase();
    if (!email) return;
    if (!isValidParticipantEmail(email)) {
      setError('Enter a valid email address for participants.');
      return;
    }
    setParticipants((prev) => normalizeParticipantEmails([...prev, email]));
    setParticipantInput('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError) {
      setError(dateError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          category,
          defaultCurrency,
          alternateCurrencies,
          startDate: showDates ? startDate || null : null,
          endDate: showDates ? endDate || null : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Failed to create ${theme.nouns.singular}`);
        return;
      }

      const groupId = data.data._id as string;
      const inviteEmails = normalizeParticipantEmails(participants);

      await Promise.allSettled(
        inviteEmails.map((email) =>
          fetch(`/api/groups/${groupId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          }),
        ),
      );

      router.push(`/groups/${groupId}`);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" disableGutters>
      <Typography variant="h5" fontWeight={700} color="text.primary" sx={{ mb: 1 }}>
        New {theme.nouns.singular}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Pick a theme, name it, set a currency, then invite people. Tags are ready for your first
        expense.
      </Typography>

      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom, 0px))', sm: 0 },
        }}
      >
        <Stack spacing={3}>
          {error && (
            <Box
              role="alert"
              sx={{
                bgcolor: (theme) => `${theme.palette.error.main}12`,
                color: 'error.main',
                px: 2,
                py: 1.5,
                borderRadius: 2,
                fontSize: '0.875rem',
              }}
            >
              {error}
            </Box>
          )}

          <Box>
            <Typography variant="body2" fontWeight={500} color="text.secondary" sx={{ mb: 1.5 }}>
              Theme
            </Typography>
            <Box
              role="radiogroup"
              aria-label="Group theme"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.5,
              }}
            >
              {GROUP_THEME_LIST.map((option) => {
                const selected = option.id === category;
                return (
                  <Paper
                    key={option.id}
                    component="button"
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCategory(option.id)}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      textAlign: 'left',
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                      bgcolor: selected ? 'tint.brand' : 'background.paper',
                      borderColor: selected ? 'primary.main' : 'divider',
                      transition: 'border-color 160ms ease, background-color 160ms ease',
                      '&:hover': { borderColor: selected ? 'primary.main' : 'border.strong' },
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography component="span" aria-hidden="true" sx={{ fontSize: '1.25rem' }}>
                        {option.icon}
                      </Typography>
                      <Typography variant="subtitle2" color="text.primary">
                        {option.label}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.5 }}
                    >
                      {option.tagline}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                      {option.perk}
                    </Typography>
                  </Paper>
                );
              })}
            </Box>
          </Box>

          <TextField
            label={`${nounTitle} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            autoFocus
            placeholder={theme.namePlaceholder}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          {showDates && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Start date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                fullWidth
                error={Boolean(dateError)}
                helperText={dateError || ' '}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}

          <TextField
            select
            label="Currency"
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            fullWidth
            required
            helperText={`One currency per ${theme.nouns.singular}`}
          >
            {CURRENCIES.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.name}
              </MenuItem>
            ))}
          </TextField>

          <Box>
            <Typography variant="body2" fontWeight={500} color="text.secondary" sx={{ mb: 1 }}>
              Participants
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              You&apos;re already a member. Add emails to invite people after creation.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: participants.length ? 1.5 : 0 }}>
              <TextField
                label="Friend email"
                value={participantInput}
                onChange={(e) => setParticipantInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addParticipant();
                  }
                }}
                fullWidth
                size="small"
                placeholder="friend@email.com"
                type="email"
              />
              <Button variant="outlined" onClick={addParticipant} sx={{ flexShrink: 0 }}>
                Add
              </Button>
            </Stack>
            {participants.length > 0 && (
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {participants.map((email) => (
                  <Chip
                    key={email}
                    label={email}
                    onDelete={() =>
                      setParticipants((prev) => prev.filter((item) => item !== email))
                    }
                    size="small"
                  />
                ))}
              </Stack>
            )}
          </Box>

          <Button
            size="small"
            onClick={() => setShowAdvanced((prev) => !prev)}
            endIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{
              alignSelf: 'flex-start',
              textTransform: 'none',
              color: 'text.secondary',
              px: 0,
            }}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
          </Button>

          <Collapse in={showAdvanced}>
            <Stack spacing={2.5}>
              <TextField
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                rows={2}
                placeholder={`What’s this ${theme.nouns.singular} for?`}
              />
              <Autocomplete
                multiple
                options={CURRENCIES.filter((c) => c.code !== defaultCurrency).map((c) => c.code)}
                value={alternateCurrencies}
                onChange={(_, val) => setAlternateCurrencies(val.slice(0, 2))}
                getOptionLabel={(code) => {
                  const c = CURRENCIES.find((cur) => cur.code === code);
                  return c ? `${c.flag} ${c.code} — ${c.name}` : code;
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Alternate currencies (max 2)"
                    helperText={`Legacy option — expenses still use the ${theme.nouns.singular} currency`}
                  />
                )}
                disableCloseOnSelect
                limitTags={2}
              />
            </Stack>
          </Collapse>

          <Stack
            direction="row"
            justifyContent="flex-end"
            spacing={1.5}
            sx={{
              display: { xs: 'none', sm: 'flex' },
              pt: 1,
            }}
          >
            <Button variant="outlined" onClick={() => router.back()} color="inherit">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !name.trim() || Boolean(dateError)}
            >
              {loading ? <CircularProgress size={20} /> : `Create ${theme.nouns.singular}`}
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: { xs: 'flex', sm: 'none' },
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            gap: 1,
            px: 2,
            pt: 1.5,
            pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
            bgcolor: 'background.paper',
            borderTop: '1px solid',
            borderColor: 'divider',
            zIndex: (theme) => theme.zIndex.appBar,
          }}
        >
          <Button fullWidth variant="outlined" onClick={() => router.back()} color="inherit">
            Cancel
          </Button>
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={loading || !name.trim() || Boolean(dateError)}
          >
            {loading ? <CircularProgress size={20} /> : `Create ${theme.nouns.singular}`}
          </Button>
        </Box>
      </Box>
    </Container>
  );
}
