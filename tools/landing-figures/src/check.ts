import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { formatCurrency } from '@splitbook/shared/currency';
import { sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';
import { isPng, pngSize, pngText } from './png.ts';
import { andList } from './figures/common.mjs';
import type { Movement, story } from './story.ts';

type Story = ReturnType<typeof story>;
/**
 * What is left of each member's balance once these movements are paid: zero for everyone when
 * they account for every balance exactly.
 */
function leftAfter(
  movements: Movement[],
  members: readonly { id: string }[],
  balances: Record<string, number>,
): Record<string, number> {
  const left = Object.fromEntries(members.map((m) => [m.id, balances[m.id] ?? 0]));
  for (const m of movements) {
    left[m.from] = sumMinorAmounts([left[m.from] ?? 0, m.amountMinor]);
    left[m.to] = sumMinorAmounts([left[m.to] ?? 0, -m.amountMinor]);
  }
  return left;
}

/** What is wrong with a story, in words; empty when every figure built from it tells the truth. */
export function verifyStory(s: Story): string[] {
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(Math.abs(minor), s.currency), s.currency);
  const signed = (minor: number) => `${minor < 0 ? '−' : '+'}${money(minor)}`;
  const problems: string[] = [];
  for (const step of s.steps) {
    for (const part of step.split) {
      const chips = sumMinorAmounts(
        step.chips.filter((chip) => chip.to === part.user).map((chip) => chip.amountMinor),
      );
      if (chips !== part.amountMinor) {
        const name = s.members.find((m) => m.id === part.user)?.name ?? part.user;
        problems.push(
          `${step.title}' chips for ${name} add up to ${money(chips)}, not their share of ${money(part.amountMinor)}.`,
        );
      }
    }
    const total = sumMinorAmounts(Object.values(step.after));
    if (total !== 0) problems.push(`After ${step.title} the counters add up to ${total}, not 0.`);
  }
  const last = s.steps.at(-1);
  if (last) {
    const balances: Record<string, number> = { ...last.after };
    // Paying every debt the Expenses left would clear every balance, and so would the payments
    // that replace them.
    const stillOwed = (movements: Movement[]) => {
      const left = leftAfter(movements, s.members, balances);
      return s.members
        .filter((m) => left[m.id] !== 0)
        .map((m) => ({ ...m, left: left[m.id] ?? 0 }));
    };
    const offByDebts = stillOwed(s.debts);
    if (offByDebts.length)
      problems.push(
        `The debts leave ${andList(offByDebts.map((m) => `${m.name} at ${signed((balances[m.id] ?? 0) - m.left)}`))}, not their balances.`,
      );
    const unsettled = stillOwed(s.transfers);
    if (unsettled.length)
      problems.push(
        `Settling up leaves ${andList(unsettled.map((m) => `${m.name} at ${signed(m.left)}`))}.`,
      );
  }
  // Fig 2's bars: every chip of a prepared item adds up to what the assistant prepared.
  for (const item of s.prepared) {
    const chips = sumMinorAmounts(item.chips.map((chip) => chip.amountMinor));
    if (chips !== item.amountMinor)
      problems.push(
        `${item.title}'s chips add up to ${money(chips)}, not ${money(item.amountMinor)}.`,
      );
  }
  return problems;
}

/**
 * A tour's counters in a frame it drew, in whole rupees: what each reads and where it is heading.
 * The sampler keeps a frame only when its readings changed, so `frame` counts every frame drawn.
 */
export interface CounterFrame {
  frame: number;
  shown: number[];
  target: number[];
}

/** How many of a tour's counter problems check names before it counts the rest. */
const NAMED_PROBLEMS = 3;

/**
 * What is wrong with the counters a tour drew, frame by frame: a frame whose counters don't add up
 * to zero, or a counter that passes where it is heading. Each counter must read somewhere between
 * its last frame and its target. Empty when every frame a visitor could read is true.
 */
export function counterProblems(frames: CounterFrame[], names: readonly string[]): string[] {
  if (!frames.length) return ['The tour drew no counters.'];
  const signed = (rupees: number) =>
    rupees === 0 ? '0' : `${rupees > 0 ? '+' : '−'}${Math.abs(rupees)}`;
  const problems: string[] = [];
  frames.forEach(({ frame, shown, target }, f) => {
    const total = shown.reduce((a, b) => a + b, 0);
    if (total !== 0)
      problems.push(
        `In frame ${frame} the counters add up to ${signed(total)}, not 0: ${shown.map(signed).join(', ')}.`,
      );
    const last = frames[f - 1]?.shown ?? shown;
    shown.forEach((value, i) => {
      const from = last[i] ?? value;
      const to = target[i] ?? value;
      if (value < Math.min(from, to) || value > Math.max(from, to))
        problems.push(
          `In frame ${frame} ${names[i] ?? `counter ${i + 1}`}'s counter reads ${signed(value)}, past where it is heading (${signed(to)}).`,
        );
    });
  });
  return problems.length > NAMED_PROBLEMS
    ? [...problems.slice(0, NAMED_PROBLEMS), `And ${problems.length - NAMED_PROBLEMS} more.`]
    : problems;
}

/** What a tour's plate reads and its live region says, which is all a screen reader hears. */
export interface Reading {
  readout: string;
  status: string;
}

/** A tour just after a visitor pressed a key, and what its live region said before the key. */
export interface StatusStep extends Reading {
  key: string;
  before: string;
}

/** Whether the live region says what the plate reads (it may say more). */
export const saysWhatIsDrawn = ({ readout, status }: Reading) => status.includes(readout);

/**
 * What is wrong with what a screen reader hears as a visitor steps a tour by keyboard (#568): a
 * step after which the live region doesn't say what the plate reads, or a → after which it says
 * nothing new. The run must start the tour over with Home, and its → presses must come round to
 * that restart too. Empty when every step is told as drawn.
 */
export function statusProblems(steps: StatusStep[]): string[] {
  if (!steps.length) return ['The tour took no steps.'];
  const label = (key: string) => (key === 'ArrowRight' ? '→' : key);
  const problems = steps.flatMap((step, i) => {
    const after = `After key ${i + 1} (${label(step.key)})`;
    if (!saysWhatIsDrawn(step))
      return [
        `${after} the live region says "${step.status}", but the plate reads "${step.readout}".`,
      ];
    // Each → moves the tour on, so it has something new to tell.
    if (step.key === 'ArrowRight' && step.status === step.before)
      return [`${after} the live region says nothing new: still "${step.status}".`];
    return [];
  });
  const restart = steps.filter((s) => s.key === 'Home').at(-1)?.readout;
  if (restart === undefined) problems.push('The tour was never started over with Home.');
  else if (!steps.some((s) => s.key === 'ArrowRight' && s.readout === restart))
    problems.push(
      `The → presses never came round to the restart ("${restart}"), so it went untested.`,
    );
  return problems;
}

/**
 * A tour played on after a keyboard visitor paused it (#570). From the restart, the tour was paused
 * and stepped by → `presses` times to `at`, then played; it must move on by itself and come round
 * to its restart again.
 */
export interface ResumeRound {
  presses: number;
  at: string;
  movedOn: boolean;
  startedOver: boolean;
}

/**
 * What is wrong with a tour played on after Pause and → (#570): a step it stands still at once
 * playing again, or one it moves on from but never comes round to its restart. `rounds` covers
 * every step → reaches from the restart while paused; none means → never came round to it.
 */
export function resumeProblems({
  restart,
  rounds,
}: {
  restart: string;
  rounds: ResumeRound[];
}): string[] {
  if (!rounds.length) return [`Paused, → never came round to the restart ("${restart}").`];
  return rounds.flatMap(({ presses, at, movedOn, startedOver }) => {
    const after = `After Home, Pause, ${presses} × → and Play, the tour`;
    if (!movedOn) return [`${after} stood still at "${at}".`];
    if (!startedOver) return [`${after} moved on from "${at}" but never started over.`];
    return [];
  });
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();

/**
 * Generated files (path relative to root → text) that are missing on disk or differ from it, then
 * any file left in outDir that the build no longer writes.
 */
export function staleOutputs(files: Map<string, string>, root: string, outDir: string): string[] {
  const stale: string[] = [];
  for (const [path, text] of files) {
    const full = join(root, path);
    if (!existsSync(full) || readFileSync(full, 'utf8') !== text) stale.push(path);
  }
  if (existsSync(join(root, outDir))) {
    for (const file of filesUnder(join(root, outDir))) {
      const path = `${outDir}/${file}`;
      if (!files.has(path)) stale.push(path);
    }
  }
  return stale;
}

/** How a vendored folder differs from the bytes its MANIFEST.sha256 pins; empty when it matches. */
export function vendorDrift(dir: string): string[] {
  const pinned = new Map(
    readFileSync(join(dir, 'MANIFEST.sha256'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', path = ''] = line.split(/\s+/);
        return [path.replace(/^\.\//, ''), hash] as const;
      }),
  );
  const problems: string[] = [];
  for (const [path, hash] of pinned) {
    if (!existsSync(join(dir, path))) problems.push(`${path} is in MANIFEST.sha256 but missing.`);
    else if (
      createHash('sha256')
        .update(readFileSync(join(dir, path)))
        .digest('hex') !== hash
    )
      problems.push(`${path} differs from MANIFEST.sha256.`);
  }
  for (const path of filesUnder(dir)) {
    if (path !== 'MANIFEST.sha256' && path !== 'PROVENANCE.md' && !pinned.has(path))
      problems.push(`${path} is not in MANIFEST.sha256.`);
  }
  return problems;
}

/** The text chunk a still carries: the source it was drawn from (see stills.ts). */
export const STILL_SOURCE_KEY = 'Source';

/**
 * What is wrong with a figure's still: missing, not a PNG, not the link preview's size, or drawn
 * from another version of the figure than `source`.
 */
export function stillDrift(
  file: string,
  size: { width: number; height: number },
  source: string,
): string[] {
  const name = basename(file);
  if (!existsSync(file)) return [`${name} is missing.`];
  const png = readFileSync(file);
  if (!isPng(png)) return [`${name} is not a PNG.`];
  const { width, height } = pngSize(png);
  if (width !== size.width || height !== size.height)
    return [`${name} is ${width} × ${height}, not ${size.width} × ${size.height}.`];
  return pngText(png).get(STILL_SOURCE_KEY) === source
    ? []
    : [`${name} was drawn from another version of the figure.`];
}
