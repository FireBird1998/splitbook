'use client';

import { useId, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Switch from '@mui/material/Switch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { HEADER_SCENES, HEADER_TIMES, type GroupHeader } from '@splitbook/shared/group-header';
import type { headerCard } from '@splitbook/shared/group-header';
import { SceneCardTheme } from './SceneCardTheme';
import type { ScenePreferences } from './scene-preferences';

export const sameHeader = (left: GroupHeader, right: GroupHeader) =>
  left.style === right.style && left.scene === right.scene && left.time === right.time;
export const headerTimeLabel = (time: GroupHeader['time']) =>
  time === 'auto' ? 'Follows the clock' : time[0].toUpperCase() + time.slice(1);
interface Props {
  groupName: string;
  value: GroupHeader;
  saved: GroupHeader;
  preferences: ScenePreferences;
  preview: ReactNode;
  thumbnails?: Partial<Record<GroupHeader['scene'], ReactNode>>;
  previewCaption?: string;
  previewTone?: ReturnType<typeof headerCard>['tone'];
  saving?: boolean;
  error?: string | null;
  savedNotice?: boolean;
  onChange: (value: GroupHeader) => void;
  onPreferences: (value: ScenePreferences) => void;
  onSave: () => void;
  onDiscard: () => void;
}
const chip = {
  m: 0,
  minHeight: 44,
  px: 1,
  border: '1px solid',
  borderRadius: '10px',
  '& .MuiRadio-root': { p: 0.5 },
  '& .MuiFormControlLabel-label': { fontSize: 14 },
};

/** The settings card at the rendered-markup seam; transport and browser storage live outside it. */
export default function HeaderSceneSettingsView({
  groupName,
  value,
  saved,
  preferences,
  preview,
  thumbnails = {},
  previewCaption,
  previewTone = 'theme',
  saving = false,
  error,
  savedNotice = false,
  onChange,
  onPreferences,
  onSave,
  onDiscard,
}: Props) {
  const id = useId(),
    changed = !sameHeader(value, saved),
    dimmed = value.style === 'classic';
  return (
    <Box
      data-header-settings
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 260px' },
        gap: 2.5,
        alignItems: 'start',
      }}
    >
      <Paper
        component="section"
        variant="outlined"
        aria-labelledby={`${id}-title`}
        sx={{ minWidth: 0, overflow: 'hidden' }}
      >
        <Box sx={{ p: 2.5 }}>
          <Typography component="h2" variant="subtitle1" fontWeight={600} id={`${id}-title`}>
            Header scene
          </Typography>
          <Typography variant="body2" color="text.secondary">
            What shows at the top of {groupName}.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '20px 28px', px: 2.5, pb: 2.5 }}>
          <SceneCardTheme tone={dimmed ? 'theme' : previewTone}>
            <Box
              data-scene-preview-card={dimmed ? 'theme' : previewTone}
              sx={{
                flex: '1 1 280px',
                alignSelf: 'flex-start',
                minWidth: 0,
                ...(!dimmed &&
                  previewTone === 'dark' && {
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                    borderRadius: '14px',
                    overflow: 'hidden',
                  }),
              }}
            >
              {preview}
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1,
                  mt: 1,
                  ...(!dimmed && previewTone === 'dark' && { px: 1, pb: 1 }),
                }}
              >
                <Typography variant="overline">Preview</Typography>
                <Typography variant="caption" color="text.secondary" aria-live="polite">
                  {previewCaption ??
                    (dimmed
                      ? 'Classic header'
                      : `${HEADER_SCENES.find((scene) => scene.id === value.scene)?.name}, ${headerTimeLabel(value.time)}`)}
                </Typography>
              </Box>
            </Box>
          </SceneCardTheme>
          <Box
            sx={{
              flex: '1.2 1 300px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <FormControl disabled={saving}>
              <FormLabel id={`${id}-header`}>Header</FormLabel>
              <RadioGroup
                row
                aria-labelledby={`${id}-header`}
                name={`${id}-header`}
                value={value.style}
                onChange={(_, style) =>
                  onChange({ ...value, style: style as GroupHeader['style'] })
                }
                sx={{ gap: 1, mt: 0.75 }}
              >
                {(['scene', 'classic'] as const).map((style) => (
                  <FormControlLabel
                    key={style}
                    value={style}
                    control={<Radio size="small" />}
                    label={style === 'scene' ? 'Scene' : 'Classic header'}
                    sx={{
                      ...chip,
                      borderColor: value.style === style ? 'primary.main' : 'border.strong',
                      bgcolor: value.style === style ? 'tint.brand' : 'background.paper',
                    }}
                  />
                ))}
              </RadioGroup>
            </FormControl>
            <Box
              component="fieldset"
              disabled={dimmed || saving}
              aria-label="Scene options"
              sx={{
                border: 0,
                p: 0,
                m: 0,
                minWidth: 0,
                opacity: dimmed ? 0.45 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <FormControl>
                <FormLabel id={`${id}-scene`}>Scene</FormLabel>
                <RadioGroup
                  aria-labelledby={`${id}-scene`}
                  name={`${id}-scene`}
                  value={value.scene}
                  onChange={(_, scene) =>
                    onChange({ ...value, scene: scene as GroupHeader['scene'] })
                  }
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
                    gap: 1,
                    mt: 0.75,
                  }}
                >
                  {HEADER_SCENES.map((scene) => (
                    <FormControlLabel
                      key={scene.id}
                      value={scene.id}
                      control={
                        <Radio
                          size="small"
                          slotProps={{ input: { 'aria-label': scene.name } }}
                          icon={<Box component="span" sx={{ width: 20, height: 20 }} />}
                          checkedIcon={<CheckCircleIcon sx={{ fontSize: 20 }} />}
                          sx={{ position: 'absolute', right: 2, top: 2, p: 0.5, zIndex: 1 }}
                        />
                      }
                      label={
                        <Box>
                          <Box
                            aria-hidden
                            sx={{
                              height: 60,
                              overflow: 'hidden',
                              borderRadius: '8px',
                              position: 'relative',
                              bgcolor: 'surface.muted',
                            }}
                          >
                            {thumbnails[scene.id]}
                          </Box>
                          <Typography
                            component="span"
                            sx={{
                              display: 'block',
                              fontSize: 12,
                              lineHeight: 1.3,
                              mt: 0.5,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {scene.name}
                          </Typography>
                        </Box>
                      }
                      sx={{
                        position: 'relative',
                        m: 0,
                        p: '4px 4px 6px',
                        border: '1px solid',
                        borderRadius: '12px',
                        alignItems: 'stretch',
                        borderColor: value.scene === scene.id ? 'primary.main' : 'border.strong',
                        bgcolor: value.scene === scene.id ? 'tint.brand' : 'background.paper',
                        color: value.scene === scene.id ? 'primary.main' : 'text.secondary',
                        '& .MuiFormControlLabel-label': { width: '100%', textAlign: 'center' },
                      }}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
              <FormControl>
                <FormLabel id={`${id}-time`}>Time of day</FormLabel>
                <RadioGroup
                  row
                  aria-labelledby={`${id}-time`}
                  name={`${id}-time`}
                  value={value.time}
                  onChange={(_, time) => onChange({ ...value, time: time as GroupHeader['time'] })}
                  sx={{ gap: 1, mt: 0.75 }}
                >
                  {HEADER_TIMES.map((time) => (
                    <FormControlLabel
                      key={time}
                      value={time}
                      control={<Radio size="small" />}
                      label={headerTimeLabel(time)}
                      sx={{
                        ...chip,
                        borderColor: value.time === time ? 'primary.main' : 'border.strong',
                        bgcolor: value.time === time ? 'tint.brand' : 'background.paper',
                      }}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  On this browser
                </Typography>
                <FormControlLabel
                  label={
                    <Box>
                      <Typography fontWeight={600}>Motion</Typography>
                      <Typography variant="caption" color="text.secondary" id={`${id}-motion-hint`}>
                        Clouds, water and people move
                      </Typography>
                    </Box>
                  }
                  control={
                    <Switch
                      checked={preferences.motion}
                      onChange={(_, motion) => onPreferences({ ...preferences, motion })}
                      slotProps={{
                        input: {
                          role: 'switch',
                          'aria-label': 'Motion',
                          'aria-describedby': `${id}-motion-hint`,
                        },
                      }}
                    />
                  }
                  sx={{
                    m: 0,
                    width: '100%',
                    minHeight: 56,
                    flexDirection: 'row-reverse',
                    justifyContent: 'space-between',
                  }}
                />
                <FormControlLabel
                  label={
                    <Box>
                      <Typography fontWeight={600}>Follow the pointer</Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        id={`${id}-pointer-hint`}
                      >
                        The scene shifts a little as you move over it
                      </Typography>
                    </Box>
                  }
                  control={
                    <Switch
                      checked={preferences.followPointer}
                      onChange={(_, followPointer) =>
                        onPreferences({ ...preferences, followPointer })
                      }
                      slotProps={{
                        input: {
                          role: 'switch',
                          'aria-label': 'Follow the pointer',
                          'aria-describedby': `${id}-pointer-hint`,
                        },
                      }}
                    />
                  }
                  sx={{
                    m: 0,
                    width: '100%',
                    minHeight: 56,
                    flexDirection: 'row-reverse',
                    justifyContent: 'space-between',
                    borderTop: '1px solid',
                    borderColor: 'divider',
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mx: 2.5, mb: 2 }}>
            Header not saved. {error} Your choices are kept.
          </Alert>
        )}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '10px 16px',
            p: '14px 20px 18px',
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            role="status"
            sx={{ flex: '1 1 240px' }}
          >
            {changed
              ? `Not saved yet. Everyone in ${groupName} will see this once you save.`
              : savedNotice
                ? `Saved. Everyone in ${groupName} sees this header now.`
                : `Everyone in ${groupName} sees this header.`}
          </Typography>
          <Button variant="outlined" disabled={!changed || saving} onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="contained" disabled={!changed || saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </Box>
      </Paper>
      <Paper component="section" variant="outlined" aria-labelledby={`${id}-who`} sx={{ p: 2.5 }}>
        <Typography
          component="h2"
          variant="subtitle1"
          fontWeight={600}
          id={`${id}-who`}
          sx={{ mb: 1.5 }}
        >
          Who sees what
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography variant="body2">
            <strong>Everyone in the Group</strong> sees the header, scene and time of day you save,
            on the web and on Android.
          </Typography>
          <Typography variant="body2">
            <strong>Only you</strong> get your Motion and pointer choices, and only in this browser.
          </Typography>
          <Typography variant="body2">
            <strong>Anyone in the Group</strong> can change the scene. Activity shows who changed
            it.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            If your device asks for reduced motion, the scene stays still whatever is set here.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
