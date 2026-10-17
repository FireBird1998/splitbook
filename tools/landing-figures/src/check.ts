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
  return problems;
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
