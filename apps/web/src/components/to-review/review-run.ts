import { summarizeReviewRun, type ReviewRunOutcome } from '@splitbook/shared/to-review';

/** Ephemeral web selection; request recovery and editing stay with their existing owners. */
export type WebReviewRun = {
  readonly ids: readonly string[];
  readonly index: number;
  readonly currentId: string | null;
  readonly outcomes: readonly ReviewRunOutcome[];
  readonly summary: ReturnType<typeof summarizeReviewRun>;
};

function snapshot(
  ids: readonly string[],
  index: number,
  outcomes: readonly ReviewRunOutcome[],
): WebReviewRun {
  return {
    ids,
    index,
    currentId: ids[index] ?? null,
    outcomes,
    summary: summarizeReviewRun(outcomes),
  };
}

/** The caller chooses the order; subsequent reads cannot reorder or add run items. */
export function startReviewRun(ids: readonly string[]): WebReviewRun {
  return snapshot([...new Set(ids)], 0, []);
}

/** Only confirmed decisions settle an item. Failed and uncertain saves stay current. */
export function settleReviewRun(
  run: WebReviewRun,
  completed: readonly ReviewRunOutcome[],
  presentIds: readonly string[],
): WebReviewRun {
  const outcomes = new Map(run.outcomes.map((outcome) => [outcome.id, outcome]));
  for (const outcome of completed) {
    if (
      run.ids.includes(outcome.id) &&
      (outcome.status === 'saved' || outcome.status === 'deleted' || outcome.status === 'skipped')
    )
      outcomes.set(outcome.id, outcome);
  }
  let index = run.index;
  // A later read may have removed an upcoming item; absence is never our save outcome.
  while (
    index < run.ids.length &&
    (outcomes.has(run.ids[index]) || !presentIds.includes(run.ids[index]))
  )
    index++;
  return snapshot(run.ids, index, [...outcomes.values()]);
}

/** Closing leaves only still-present, unfinished selections for later. */
export function closeReviewRun(run: WebReviewRun, presentIds: readonly string[]): WebReviewRun {
  const remaining = run.ids
    .slice(run.index)
    .filter((id) => presentIds.includes(id) && !run.outcomes.some((outcome) => outcome.id === id))
    .map((id) => ({ id, status: 'skipped' as const }));
  return snapshot(run.ids, run.ids.length, [...run.outcomes, ...remaining]);
}
