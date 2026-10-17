import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { formatCurrency } from '@splitbook/shared/currency';
import { sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';
import { isPng, pngSize, pngText } from './png.ts';
import type { story } from './story.ts';

type Story = ReturnType<typeof story>;

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
    const left: Record<string, number> = { ...last.after };
    for (const t of s.transfers) {
      left[t.from] = (left[t.from] ?? 0) + t.amountMinor;
      left[t.to] = (left[t.to] ?? 0) - t.amountMinor;
    }
    const unsettled = s.members.filter((m) => left[m.id] !== 0);
    if (unsettled.length) {
      const list = unsettled.map((m) => `${m.name} at ${signed(left[m.id] ?? 0)}`);
      problems.push(
        `Settling up leaves ${list.slice(0, -1).join(', ')}${list.length > 1 ? ' and ' : ''}${list.at(-1)}.`,
      );
    }
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
