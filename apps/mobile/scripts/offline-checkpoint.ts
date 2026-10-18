import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import type { SavedQueryRecords } from '../src/data/saved-copy-budget';

/** A verifier must finish saving the views it intends to restore before retiring their session. */
export async function waitForSavedQueries(
  rows: SavedQueryRecords,
  accountId: string,
  paths: readonly string[],
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const missing: string[] = [];
    for (const path of paths) if ((await rows.load(accountId, path)) === null) missing.push(path);
    if (!missing.length) return;
    assert.ok(
      performance.now() < deadline,
      `Offline restart needs saved queries: ${missing.join(', ')}`,
    );
    // Wait only for disk persistence. Controller errors and failed storage reads still fail;
    // no request, command or failed assertion is retried.
    await setTimeout(10);
  }
}
