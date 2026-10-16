import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { staleOutputs, vendorDrift, verifyStory } from './check.ts';
import { story } from './story.ts';

describe('verifyStory', () => {
  it('passes the landing story', () => {
    expect(verifyStory(story())).toEqual([]);
  });

  it('flags an Expense after which the counters no longer add up to zero', () => {
    const s = story();
    const groceries = s.steps[2]!;
    const broken = {
      ...s,
      steps: [
        s.steps[0]!,
        s.steps[1]!,
        { ...groceries, after: { ...groceries.after, you: groceries.after.you + 1 } },
      ],
    };
    expect(verifyStory(broken)).toEqual([
      'After Groceries the counters add up to 1, not 0.',
      'Settling up leaves You at +₹0.01.',
    ]);
  });

  it("flags an Expense whose chips don't add up to a member's share", () => {
    const s = story();
    const groceries = s.steps[2]!;
    const chips = groceries.chips.map((chip, i) =>
      i === groceries.chips.length - 1 ? { ...chip, amountMinor: chip.amountMinor - 50 } : chip,
    );
    const broken = { ...s, steps: [s.steps[0]!, s.steps[1]!, { ...groceries, chips }] };
    expect(verifyStory(broken)).toEqual([
      "Groceries' chips for You add up to ₹399.50, not their share of ₹400.00.",
    ]);
  });

  it('flags payments that leave a balance unsettled', () => {
    const s = story();
    expect(verifyStory({ ...s, transfers: s.transfers.slice(0, 2) })).toEqual([
      'Settling up leaves Priya at −₹100.00 and Sam at +₹100.00.',
    ]);
  });
});

describe('staleOutputs', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists every generated file that is missing, differs from what is committed or is no longer built', () => {
    root = mkdtempSync(join(tmpdir(), 'landing-figures-'));
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out/same.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'out/changed.ts'), 'export const b = 1;\n');
    writeFileSync(join(root, 'out/renamed.ts'), 'export const d = 4;\n');
    const files = new Map([
      ['out/same.ts', 'export const a = 1;\n'],
      ['out/changed.ts', 'export const b = 2;\n'],
      ['out/missing.ts', 'export const c = 3;\n'],
    ]);
    expect(staleOutputs(files, root, 'out')).toEqual([
      'out/changed.ts',
      'out/missing.ts',
      'out/renamed.ts',
    ]);
  });
});

describe('vendorDrift', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  it('flags vendored files that differ from the manifest, are missing or are not in it', () => {
    dir = mkdtempSync(join(tmpdir(), 'landing-vendor-'));
    mkdirSync(join(dir, 'kit'));
    writeFileSync(join(dir, 'LICENSE'), 'MIT\n');
    writeFileSync(join(dir, 'kit/a.mjs'), 'edited\n');
    writeFileSync(join(dir, 'kit/extra.mjs'), 'new\n');
    writeFileSync(join(dir, 'PROVENANCE.md'), 'note\n');
    writeFileSync(
      join(dir, 'MANIFEST.sha256'),
      [
        `${sha('MIT\n')}  ./LICENSE`,
        `${sha('original\n')}  ./kit/a.mjs`,
        `${sha('b\n')}  ./kit/b.mjs`,
      ]
        .map((line) => `${line}\n`)
        .join(''),
    );
    expect(vendorDrift(dir)).toEqual([
      'kit/a.mjs differs from MANIFEST.sha256.',
      'kit/b.mjs is in MANIFEST.sha256 but missing.',
      'kit/extra.mjs is not in MANIFEST.sha256.',
    ]);
  });

  it('passes the vendored Anatomy kit', () => {
    expect(vendorDrift(join(import.meta.dirname, '../vendor/anatomy'))).toEqual([]);
  });
});
