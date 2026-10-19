'use client';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { exportPreviewSchema } from '@splitbook/shared/export-preview';
import { apiFetch, signInAgain } from '@/lib/utils/api-fetch';
import { exportFailureMessage } from './export-form';
import type { PreviewState } from './ExportPreview';

/** Debounce the complete query; never display a previous selection's response. */
export function useExportPreview(userId: string, url: string | null, idleMessage: string) {
  const [settledUrl, setSettledUrl] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledUrl(url), 300);
    return () => window.clearTimeout(timer);
  }, [url]);
  const current = url !== null && url === settledUrl;
  const { data, error, mutate } = useSWR(
    current ? ['export-preview', userId, url] : null,
    async ([, , path]) => {
      const response = await apiFetch(path);
      if (response.status === 401) signInAgain();
      if (!response.ok)
        throw new Error(
          exportFailureMessage(response.status, await response.json().catch(() => null)),
        );
      const parsed = exportPreviewSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('The export preview could not be read.');
      return parsed.data;
    },
    { keepPreviousData: false, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const state: PreviewState = !url
    ? { status: 'idle', message: idleMessage }
    : !current
      ? { status: 'loading' }
      : error
        ? { status: 'error', message: error.message }
        : data
          ? { status: 'ready', data }
          : { status: 'loading' };
  return { state, retry: () => void mutate() };
}
