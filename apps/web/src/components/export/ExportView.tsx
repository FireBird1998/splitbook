'use client';

import ExportPreviewPanel, { type PreviewState } from './ExportPreview';
import { useExportPreview } from './use-export-preview';
import ExportFormatOptions, { type ExportChoice } from './ExportFormatOptions';
import BackupOption from './BackupOption';
import StatementOption from './StatementOption';
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ErrorState from '@/components/common/ErrorState';
import { useGroups } from '@/lib/hooks/use-groups';
import { apiFetch } from '@/lib/utils/api-fetch';
import { FONT_MONO, RADIUS } from '@/lib/theme/tokens';
import { exportPath } from '@splitbook/shared/api-paths';
import { saveFile } from '@/lib/utils/save-file';
import {
  EXPORT_INCLUDES,
  planExportFiles,
  type ExportFilePlan,
  type ExportInclude,
  type ExportRequest,
} from '@splitbook/shared/export-request';
import {
  DEFAULT_INCLUDE,
  INCLUDE_LABELS,
  currencyNote,
  exportFailureMessage,
  exportGroupOptions,
  exportRequest,
  fileNameFromDisposition,
  initialCustomRange,
  initialSelection,
  periodOptions,
  periodWindow,
  type CustomRange,
  type ExportGroupOption,
  type ExportPeriod,
  type PeriodOption,
} from './export-form';

const CARD_RADIUS = `${RADIUS.lg}px`;
const CONTROL_RADIUS = `${RADIUS.md}px`;

/** The viewer's own time zone: the calendar their payments' days and times are read in. */
function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export type ExportGroupsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; groups: ExportGroupOption[] };

/** The files a download holds, and the names of the Groups they come from, in request order. */
export type ExportFiles = ExportFilePlan & { groupNames: string[] };

export type DownloadState =
  | { status: 'idle' }
  | { status: 'preparing'; fileName: string }
  | { status: 'done'; fileName: string }
  | { status: 'failed'; message: string };

interface ExportViewProps {
  userId: string;
  /** From `/export?group=<id>`: a Group's header opened the page for that Group. */
  preselectedGroupId: string | null;
}

/**
 * The Export page (#317, design canvas "Export"): pick Groups, a period and what to include,
 * then download the Group's CSV, or one zip when there are several files. The server builds
 * the files (`GET /api/export`); amounts stay in their own currency.
 */
export default function ExportView({ userId, preselectedGroupId }: ExportViewProps) {
  const { data, error, mutate } = useGroups(userId);
  const router = useRouter();
  const pathname = usePathname();
  // The page's "this month" stays the month it was opened in.
  const [now] = useState(() => new Date());
  const [picked, setPicked] = useState<string[] | null>(null);
  const [format, setFormat] = useState<ExportChoice>('csv');
  const [period, setPeriod] = useState<ExportPeriod>('this');
  const [custom, setCustom] = useState<CustomRange>(() => initialCustomRange(now));
  const [include, setInclude] = useState<Record<ExportInclude, boolean>>({ ...DEFAULT_INCLUDE });
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' });

  const groups = useMemo(() => (data ? exportGroupOptions(data) : null), [data]);
  const selected = useMemo(
    () =>
      groups
        ? (picked ?? initialSelection(groups, preselectedGroupId)).filter((id) =>
            groups.some((group) => group.id === id),
          )
        : [],
    [groups, picked, preselectedGroupId],
  );

  const options = useMemo(() => periodOptions(now), [now]);
  const days = format === 'json' ? {} : periodWindow(period, now, custom);
  const request = groups
    ? exportRequest({
        groups,
        selected,
        window: days,
        include,
        timeZone: viewerTimeZone(),
        format: format === 'json' ? 'json' : 'csv',
      })
    : null;
  const groupNames = request
    ? request.groupIds.map((id) => groups!.find((group) => group.id === id)!.name)
    : [];
  const plan: ExportFiles | null = request
    ? {
        ...planExportFiles(groupNames, request),
        groupNames,
        ...(format === 'json'
          ? { download: `splitbook-${groupNames.length}-groups-backup.json`, zipped: false }
          : {}),
      }
    : null;

  const previewUrl =
    request && (format !== 'statement' || selected.length === 1)
      ? exportPath({ ...request, format, preview: true })
      : null;
  const preview = useExportPreview(
    userId,
    previewUrl,
    !groups
      ? 'Loading Groups…'
      : selected.length === 0
        ? 'Pick at least one Group.'
        : format === 'statement' && selected.length !== 1
          ? 'Choose exactly one Group.'
          : 'Finish the period to preview.',
  );

  /** Any change of choice starts over: the last download's status no longer applies. */
  const change = (apply: () => void) => {
    apply();
    setDownload((current) => (current.status === 'preparing' ? current : { status: 'idle' }));
  };

  const startDownload = async () => {
    if (!request || !plan || download.status === 'preparing') return;
    setDownload({ status: 'preparing', fileName: plan.download });
    try {
      const response = await apiFetch(exportPath(request));
      if (response.status === 401) {
        // The session is gone: sign in again and come back here, as the reads do.
        router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setDownload({ status: 'failed', message: exportFailureMessage(response.status, body) });
        return;
      }
      const fileName =
        fileNameFromDisposition(response.headers.get('Content-Disposition')) ?? plan.download;
      saveFile(await response.blob(), fileName);
      setDownload({ status: 'done', fileName });
    } catch {
      setDownload({ status: 'failed', message: exportFailureMessage(0, null) });
    }
  };

  const groupsState: ExportGroupsState = groups
    ? { status: 'ready', groups }
    : error
      ? { status: 'error' }
      : { status: 'loading' };

  return (
    <ExportPageView
      preview={preview.state}
      onRetryPreview={preview.retry}
      groups={groupsState}
      onRetryGroups={() => void mutate()}
      selected={selected}
      onToggleGroup={(id) =>
        change(() =>
          setPicked(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]),
        )
      }
      onToggleAll={() =>
        change(() =>
          setPicked(
            groups && selected.length === groups.length ? [] : (groups ?? []).map((g) => g.id),
          ),
        )
      }
      format={format}
      onFormat={(next) => change(() => setFormat(next))}
      statementRequest={request}
      period={format === 'json' ? 'all' : period}
      periodOptions={options}
      onPeriod={(next) => change(() => setPeriod(next))}
      custom={custom}
      onCustom={(next) => change(() => setCustom(next))}
      windowError={'error' in days ? days.error : null}
      include={include}
      onInclude={(name, on) => change(() => setInclude((current) => ({ ...current, [name]: on })))}
      plan={plan}
      currencyNote={groups ? currencyNote(groups, selected) : null}
      download={download}
      onDownload={() => void startDownload()}
    />
  );
}

export interface ExportPageViewProps {
  preview: PreviewState;
  onRetryPreview: () => void;
  format?: ExportChoice;
  onFormat?: (format: ExportChoice) => void;
  statementRequest?: ExportRequest | null;
  groups: ExportGroupsState;
  onRetryGroups: () => void;
  selected: readonly string[];
  onToggleGroup: (id: string) => void;
  onToggleAll: () => void;
  period: ExportPeriod;
  periodOptions: readonly PeriodOption[];
  onPeriod: (period: ExportPeriod) => void;
  custom: CustomRange;
  onCustom: (range: CustomRange) => void;
  /** Why the custom range can't be used yet. */
  windowError: string | null;
  include: Readonly<Record<ExportInclude, boolean>>;
  onInclude: (name: ExportInclude, on: boolean) => void;
  /** The files the download holds; null until a Group is picked and the period is complete. */
  plan: ExportFiles | null;
  currencyNote: string | null;
  download: DownloadState;
  onDownload: () => void;
}

/** The page itself, from its state: what the tests render. */
export function ExportPageView(props: ExportPageViewProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography
          component="h1"
          sx={{
            m: 0,
            fontSize: '1.75rem',
            lineHeight: 1.15,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'text.primary',
          }}
        >
          Export
        </Typography>
        <Typography sx={{ m: 0, color: 'text.secondary' }}>
          Take your Group data with you as CSV, a JSON backup, or a printable statement.
        </Typography>
      </Box>

      {props.groups.status === 'error' ? (
        <ErrorState
          message="Your Groups could not be loaded."
          onRetry={props.onRetryGroups}
          retryLabel="Try again"
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              lg: 'minmax(300px, 0.7fr) minmax(0, 1.3fr)',
            },
            gap: 2.5,
            alignItems: 'start',
          }}
        >
          <Card
            id="export-new"
            title="New export"
            sx={{ flex: '1 1 380px', minWidth: 0 }}
            busy={props.groups.status === 'loading'}
          >
            <ExportForm {...props} />
          </Card>
          <ExportPreviewPanel state={props.preview} onRetry={props.onRetryPreview} />
        </Box>
      )}
    </Box>
  );
}

function Card({
  id,
  title,
  subtitle,
  busy,
  sx,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  busy?: boolean;
  sx: object;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      aria-labelledby={`${id}-heading`}
      aria-busy={busy || undefined}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: CARD_RADIUS,
        ...sx,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '2px',
          minHeight: 56,
          px: 2.5,
          pt: 2,
          pb: 1,
        }}
      >
        <Typography
          id={`${id}-heading`}
          component="h2"
          sx={{ m: 0, fontSize: '1rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ px: 2.5, pt: 0.5, pb: 2.5 }}>{children}</Box>
    </Box>
  );
}

const sectionHeadingSx = {
  m: 0,
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  fontWeight: 600,
  color: 'text.primary',
} as const;

/** A labelled checkbox row, at least 48 px high (web.css: .ex-check). */
function CheckRow({
  checked,
  onChange,
  label,
  meta,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  meta?: string;
  disabled?: boolean;
}) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 48,
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <Checkbox
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        sx={{ p: 1, ml: -1 }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography
          component="span"
          sx={{
            fontSize: meta ? '0.9375rem' : '0.8125rem',
            fontWeight: meta ? 500 : 400,
            color: 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
        {meta ? (
          <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {meta}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function ExportForm(props: ExportPageViewProps) {
  const { groups, selected, plan, download } = props;
  if (groups.status === 'loading')
    return (
      <Box role="status" aria-label="Loading your Groups">
        {[0, 1, 2].map((row) => (
          <Box
            key={row}
            aria-hidden
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}
          >
            <Skeleton variant="rounded" width={18} height={18} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="30%" sx={{ fontSize: '0.75rem' }} />
            </Box>
          </Box>
        ))}
      </Box>
    );
  if (groups.status !== 'ready') return null;
  if (groups.groups.length === 0)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Typography sx={{ fontWeight: 600, color: 'text.primary' }}>No Groups to export</Typography>
        <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          Once you’re in a Group, you can download its Expenses and payments here.
        </Typography>
        <Button component={Link} href="/groups/new" variant="outlined" sx={{ mt: 1 }}>
          New Group
        </Button>
      </Box>
    );

  const allPicked = selected.length === groups.groups.length;
  const option = props.periodOptions.find((candidate) => candidate.value === props.period);
  const nothingPicked = selected.length === 0;
  const preparing = download.status === 'preparing';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            minHeight: 28,
          }}
        >
          <Typography id="export-groups-heading" component="h3" sx={sectionHeadingSx}>
            Groups
          </Typography>
          <Button
            variant="text"
            onClick={props.onToggleAll}
            sx={{ minHeight: 44, px: 1.25, mr: -1.25, fontWeight: 600 }}
          >
            {allPicked ? 'Clear all' : 'Select all'}
          </Button>
        </Box>
        <Box role="group" aria-labelledby="export-groups-heading">
          {groups.groups.map((group) => (
            <CheckRow
              key={group.id}
              checked={selected.includes(group.id)}
              onChange={() => props.onToggleGroup(group.id)}
              label={group.name}
              meta={group.meta}
            />
          ))}
        </Box>
      </Box>

      {props.onFormat ? (
        <ExportFormatOptions value={props.format ?? 'csv'} onChange={props.onFormat} />
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <TextField
          disabled={props.format === 'json'}
          select
          id="export-period"
          label="Period"
          value={props.period}
          onChange={(event) => props.onPeriod(event.target.value as ExportPeriod)}
          fullWidth
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          {props.periodOptions.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
        </TextField>
        {props.period === 'custom' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
              gap: 1.5,
              pt: 1,
            }}
          >
            <TextField
              id="export-from"
              type="date"
              label="From"
              value={props.custom.from}
              onChange={(event) => props.onCustom({ ...props.custom, from: event.target.value })}
              error={Boolean(props.windowError)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              id="export-to"
              type="date"
              label="To"
              value={props.custom.to}
              onChange={(event) => props.onCustom({ ...props.custom, to: event.target.value })}
              error={Boolean(props.windowError)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        ) : null}
        {props.period === 'custom' && props.windowError ? (
          <Typography role="alert" sx={{ fontSize: '0.75rem', color: 'status.negative' }}>
            {props.windowError}
          </Typography>
        ) : option?.hint ? (
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {option.hint}
          </Typography>
        ) : null}
      </Box>

      {props.format !== 'statement' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
          <Typography id="export-include-heading" component="h3" sx={sectionHeadingSx}>
            Include
          </Typography>
          <Box
            role="group"
            aria-labelledby="export-include-heading"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
              columnGap: 1.5,
            }}
          >
            {EXPORT_INCLUDES.map((name) => (
              <CheckRow
                key={name}
                checked={props.format === 'json' && name === 'shares' ? true : props.include[name]}
                onChange={(on) => props.onInclude(name, on)}
                label={INCLUDE_LABELS[name]}
                disabled={props.format === 'json' && name === 'shares'}
              />
            ))}
          </Box>
        </Box>
      ) : null}

      <Box
        role="note"
        sx={{
          display: 'flex',
          gap: 1.5,
          alignItems: 'flex-start',
          px: 1.75,
          py: 1.5,
          borderRadius: CONTROL_RADIUS,
          bgcolor: 'tint.info',
          fontSize: '0.8125rem',
          lineHeight: 1.45,
          color: 'text.primary',
        }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 18, mt: '1px', color: 'status.info' }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <span>Amounts stay in their own currency. Splitbook never converts them.</span>
          {props.currencyNote ? (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {props.currencyNote}
            </Box>
          ) : null}
        </Box>
      </Box>

      {props.format === 'statement' && <StatementOption request={props.statementRequest ?? null} />}
      {props.format === 'json' && <BackupOption />}
      {props.format !== 'statement' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="contained"
            fullWidth
            startIcon={<FileDownloadOutlinedIcon />}
            disabled={!plan || preparing}
            aria-describedby="export-file"
            onClick={props.onDownload}
            sx={{ minHeight: 44, borderRadius: CONTROL_RADIUS, fontWeight: 600 }}
          >
            {preparing
              ? 'Preparing…'
              : props.format === 'json'
                ? 'Download JSON backup'
                : 'Download CSV'}
          </Button>
          <Typography
            id="export-file"
            sx={{ fontSize: '0.75rem', color: 'text.secondary', textAlign: 'center' }}
          >
            {nothingPicked ? (
              'Pick at least one Group.'
            ) : plan ? (
              <>
                <FileName>{plan.download}</FileName> ·{' '}
                {props.format === 'json'
                  ? '1 JSON file · all time'
                  : plan.zipped
                    ? `${plan.files.length} CSV files in a .zip`
                    : '1 CSV file'}
              </>
            ) : (
              'Finish the period to download.'
            )}
          </Typography>
          <DownloadStatus download={download} onRetry={props.onDownload} />
        </Box>
      ) : null}
    </Box>
  );
}

function FileName({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: FONT_MONO,
        fontWeight: 500,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </Box>
  );
}

function DownloadStatus({ download, onRetry }: { download: DownloadState; onRetry: () => void }) {
  // One live region, present from the start, so each change is announced. A failure is an
  // alert of its own beside it, rather than a live region inside another.
  return (
    <>
      <Box role="status" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {download.status === 'preparing' ? (
          <>
            <LinearProgress aria-label="Preparing the export" sx={{ borderRadius: 3 }} />
            <Typography
              sx={{ fontSize: '0.8125rem', color: 'text.secondary', textAlign: 'center' }}
            >
              Preparing <FileName>{download.fileName}</FileName>…
            </Typography>
          </>
        ) : download.status === 'done' ? (
          <Typography
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              fontSize: '0.8125rem',
              color: 'status.positive',
              textAlign: 'center',
            }}
          >
            <CheckIcon sx={{ fontSize: 16 }} />
            <span>
              <FileName>{download.fileName}</FileName> is downloading.
            </span>
          </Typography>
        ) : null}
      </Box>
      {download.status === 'failed' ? (
        <ErrorState message={download.message} onRetry={onRetry} retryLabel="Try again" />
      ) : null}
    </>
  );
}
