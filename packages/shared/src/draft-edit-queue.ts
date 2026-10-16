import type { PersistedExpenseDraft } from './validators/expense-draft';

type DraftEditResult<Input> =
  | { kind: 'kept'; draft: PersistedExpenseDraft }
  | { kind: 'changed'; before: PersistedExpenseDraft; draft: PersistedExpenseDraft }
  | { kind: 'interrupted'; draft: PersistedExpenseDraft; input: Input }
  | { kind: 'failed'; draft: PersistedExpenseDraft; input: Input; cause: unknown };

/**
 * Serializes explicitly started Draft edits, coalescing typing without losing the next
 * revision or typing entered during refresh. It never schedules, persists or retries a write.
 * Callers own conflict presentation and when an interrupted edit may be retried.
 */
export function draftEditQueue<Input>(options: {
  current(): boolean;
  canWrite(): boolean;
  replace(draft: PersistedExpenseDraft, input: Input): Promise<PersistedExpenseDraft>;
  kept(draft: PersistedExpenseDraft, pending: boolean): void;
  refresh(): Promise<void>;
  /** Keep client-owned recovery inside the same flight; it returns the adopted revision. */
  recover?(
    failure: Extract<DraftEditResult<Input>, { kind: 'failed' }>,
  ): Promise<PersistedExpenseDraft>;
  /** Web verifies each kept edit; Android verifies once its current burst has drained. */
  refreshAfter: 'write' | 'drain';
}) {
  let pending: { input: Input } | null = null;
  let observed: PersistedExpenseDraft | null = null;
  let flight: Promise<DraftEditResult<Input>> | null = null;

  const drain = async (
    initial: PersistedExpenseDraft,
    firstInput: Input,
  ): Promise<DraftEditResult<Input>> => {
    let version = initial;
    let submitted = firstInput;
    let replacing: { input: Input } | null = null;
    const external = (): DraftEditResult<Input> | null => {
      const latest = observed;
      observed = null;
      if (!latest || latest.revision <= version.revision) return null;
      pending = null;
      return { kind: 'changed', before: version, draft: latest };
    };
    try {
      do {
        while (pending && options.current() && options.canWrite()) {
          submitted = pending.input;
          replacing = pending;
          pending = null;
          version = await options.replace(version, submitted);
          replacing = null;
          if (!options.current()) return { kind: 'interrupted', draft: version, input: submitted };
          const changed = external();
          if (changed) return changed;
          options.kept(version, pending !== null);
          if (options.refreshAfter === 'write') {
            await options.refresh();
            const changed = external();
            if (changed) return changed;
          }
        }
        if (options.refreshAfter === 'drain') {
          await options.refresh();
          const changed = external();
          if (changed) return changed;
        }
      } while (pending && options.current() && options.canWrite());
      return pending
        ? { kind: 'interrupted', draft: version, input: pending.input }
        : { kind: 'kept', draft: version };
    } catch (cause) {
      observed = null;
      // Keep the latest correction available, but only another explicit flush may send it.
      pending ??= replacing;
      const failure = {
        kind: 'failed' as const,
        draft: version,
        input: pending?.input ?? submitted,
        cause,
      };
      if (!options.recover || !options.current()) return failure;
      try {
        return { ...failure, draft: await options.recover(failure) };
      } catch (recoveryCause) {
        return { ...failure, cause: recoveryCause };
      }
    }
  };
  return {
    change(input: Input) {
      pending = { input };
    },
    get pending() {
      return pending !== null;
    },
    get writing() {
      return flight !== null;
    },
    /**
     * A poll may observe our own write before its reply. Hold newer reads until the reply
     * can distinguish that write from an external edit. False lets an idle caller adopt now.
     */
    receive(draft: PersistedExpenseDraft) {
      if (!flight) return false;
      if (!observed || draft.revision > observed.revision) observed = draft;
      return true;
    },
    clear() {
      pending = null;
      observed = null;
    },
    flush(initial: PersistedExpenseDraft): Promise<DraftEditResult<Input>> {
      if (flight) return flight;
      if (!pending) return Promise.resolve({ kind: 'kept', draft: initial });
      const firstInput = pending.input;
      const settle = (
        result: DraftEditResult<Input>,
      ): DraftEditResult<Input> | Promise<DraftEditResult<Input>> => {
        // Reads and typing may arrive between drain returning and this continuation.
        // Decide their outcome and release the flight together, with no intervening await.
        const latest = observed;
        observed = null;
        if (options.current() && latest && latest.revision > result.draft.revision) {
          pending = null;
          result = {
            kind: 'changed',
            before: result.kind === 'changed' ? result.before : result.draft,
            draft: latest,
          };
        }
        if (result.kind === 'kept' && pending) {
          if (options.current() && options.canWrite())
            return drain(result.draft, pending.input).then(settle);
          result = { kind: 'interrupted', draft: result.draft, input: pending.input };
        }
        flight = null;
        return result;
      };
      // Set the flight before any adapter can synchronously deliver a read or another flush.
      flight = Promise.resolve()
        .then(() => drain(initial, firstInput))
        .then(settle);
      return flight;
    },
  };
}
