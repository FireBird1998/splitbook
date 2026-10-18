import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  counterProblems,
  staleOutputs,
  statusProblems,
  stillDrift,
  vendorDrift,
  verifyStory,
} from './check.ts';
import { withPngText } from './png.ts';
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
      'The debts leave You at +₹500.00, not their balances.',
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

  it('flags debts that would leave a member somewhere other than their balance', () => {
    const s = story();
    const debts = s.debts.map((d, i) =>
      i === 0 ? { ...d, amountMinor: d.amountMinor + 10000 } : d,
    );
    expect(verifyStory({ ...s, debts })).toEqual([
      'The debts leave You at +₹600.00 and Priya at −₹200.00, not their balances.',
    ]);
  });

  it('flags payments that leave a balance unsettled', () => {
    const s = story();
    expect(verifyStory({ ...s, transfers: s.transfers.slice(0, 2) })).toEqual([
      'Settling up leaves Priya at −₹100.00 and Sam at +₹100.00.',
    ]);
  });

  it("flags a prepared item whose chips don't add up to its amount", () => {
    const s = story();
    const [dinner, cab] = s.prepared;
    const chips = dinner!.chips.map((chip, i) =>
      i === 0 ? { ...chip, amountMinor: chip.amountMinor - 100 } : chip,
    );
    expect(verifyStory({ ...s, prepared: [{ ...dinner!, chips }, cab!] })).toEqual([
      "Dinner at Thalassa's chips add up to ₹2,399.00, not ₹2,400.00.",
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

describe('stillDrift', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  /** The first bytes of a PNG: its signature and the header chunk with its width and height. */
  const pngHead = (width: number, height: number) => {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'latin1');
    head.writeUInt32BE(width, 16);
    head.writeUInt32BE(height, 20);
    return head;
  };

  const size = { width: 1200, height: 630 };

  it('passes a still of the right size, drawn from the current figure', () => {
    dir = mkdtempSync(join(tmpdir(), 'landing-still-'));
    writeFileSync(join(dir, 'fig-light.png'), withPngText(pngHead(1200, 630), 'Source', 'abc'));
    expect(stillDrift(join(dir, 'fig-light.png'), size, 'abc')).toEqual([]);
  });

  it('flags a still drawn from another version of the figure, or not stamped', () => {
    dir = mkdtempSync(join(tmpdir(), 'landing-still-'));
    writeFileSync(join(dir, 'old.png'), withPngText(pngHead(1200, 630), 'Source', 'abc'));
    writeFileSync(join(dir, 'plain.png'), pngHead(1200, 630));
    const stale = 'was drawn from another version of the figure.';
    expect(stillDrift(join(dir, 'old.png'), size, 'def')).toEqual([`old.png ${stale}`]);
    expect(stillDrift(join(dir, 'plain.png'), size, 'def')).toEqual([`plain.png ${stale}`]);
  });

  it('flags a still that is missing, not a PNG, or the wrong size', () => {
    dir = mkdtempSync(join(tmpdir(), 'landing-still-'));
    writeFileSync(join(dir, 'small.png'), withPngText(pngHead(1199, 630), 'Source', 'abc'));
    writeFileSync(join(dir, 'text.png'), 'not an image');
    expect(stillDrift(join(dir, 'gone.png'), size, 'abc')).toEqual(['gone.png is missing.']);
    expect(stillDrift(join(dir, 'text.png'), size, 'abc')).toEqual(['text.png is not a PNG.']);
    expect(stillDrift(join(dir, 'small.png'), size, 'abc')).toEqual([
      'small.png is 1199 × 630, not 1200 × 630.',
    ]);
  });
});

// #511: the check reads a tour's counters in every frame it draws, in rupees, with where each is
// heading.
describe('counterProblems', () => {
  const NAMES = ['You', 'Priya', 'Sam', 'Alex'];
  const frame = (shown: number[], target: number[]) => ({ shown, target });
  /** Frames drawn one after another, numbered from 1. */
  const drawn = (...list: ReturnType<typeof frame>[]) =>
    list.map((f, i) => ({ frame: i + 1, ...f }));

  it('passes counters that move only toward where they are heading and always add up to zero', () => {
    expect(
      counterProblems(
        drawn(
          frame([500, -100, 300, -700], [500, -100, 300, -700]),
          frame([300, -100, 300, -500], [0, -100, 300, -200]),
          frame([0, -100, 300, -200], [0, -100, 300, -200]),
          // Starting over jumps to new readings.
          frame([0, 0, 0, 0], [0, 0, 0, 0]),
        ),
        NAMES,
      ),
    ).toEqual([]);
  });

  it('flags a counter that passes where it is heading', () => {
    expect(
      counterProblems(
        drawn(
          frame([500, -100, 300, -700], [0, -100, 300, -200]),
          frame([-19, -100, 300, -181], [0, -100, 300, -200]),
        ),
        NAMES,
      ),
    ).toEqual([
      "In frame 2 You's counter reads −19, past where it is heading (0).",
      "In frame 2 Alex's counter reads −181, past where it is heading (−200).",
    ]);
  });

  it('flags a frame whose counters do not add up to zero', () => {
    expect(
      counterProblems(
        drawn(frame([3, -1, -1, -1], [0, 0, 0, 0]), frame([2, -1, -1, -1], [0, 0, 0, 0])),
        NAMES,
      ),
    ).toEqual(['In frame 2 the counters add up to −1, not 0: +2, −1, −1, −1.']);
  });

  it('names the frame a reading was drawn in when only changed readings are kept', () => {
    expect(
      counterProblems(
        [
          { frame: 1, ...frame([0, 0], [0, 0]) },
          { frame: 41, ...frame([0, 0], [500, -500]) },
          { frame: 42, ...frame([520, -520], [500, -500]) },
        ],
        ['You', 'Alex'],
      ),
    ).toEqual([
      "In frame 42 You's counter reads +520, past where it is heading (+500).",
      "In frame 42 Alex's counter reads −520, past where it is heading (−500).",
    ]);
  });

  it('flags a tour that showed no counters, and names only the first few problems', () => {
    expect(counterProblems([], NAMES)).toEqual(['The tour drew no counters.']);
    const off = drawn(...Array.from({ length: 8 }, () => frame([1, 0, 0, 0], [1, 0, 0, 0])));
    expect(counterProblems(off, NAMES)).toEqual([
      'In frame 1 the counters add up to +1, not 0: +1, 0, 0, 0.',
      'In frame 2 the counters add up to +1, not 0: +1, 0, 0, 0.',
      'In frame 3 the counters add up to +1, not 0: +1, 0, 0, 0.',
      'And 5 more.',
    ]);
  });
});

describe('statusProblems', () => {
  /** A key's step: what the plate reads and the live region says after it, and said before it. */
  const step = (key: string, readout: string, status: string, before: string) => ({
    key,
    readout,
    status,
    before,
  });
  /** Steps one after another, each starting from what the last one said. */
  const stepped = (...list: [key: string, readout: string, status?: string][]) =>
    list.map(([key, readout, status = readout], i, all) =>
      step(key, readout, status, i ? (all[i - 1]![2] ?? all[i - 1]![1]) : ''),
    );
  const EMPTY = 'Claude connected · To review empty';

  it('passes a tour whose live region tells every step as drawn, round to the restart and Home', () => {
    expect(
      statusProblems(
        stepped(
          ['ArrowRight', 'Claude prepares Dinner ₹2,400'],
          // The live region may say more than the plate.
          ['ArrowRight', 'You +500 · Alex −700', 'All 3 Expenses split. You +500 · Alex −700'],
          ['ArrowRight', EMPTY],
          ['ArrowRight', 'Claude prepares Dinner ₹2,400'],
          ['Home', EMPTY],
          // Home where the tour already starts says the same again.
          ['Home', EMPTY],
        ),
      ),
    ).toEqual([]);
  });

  it('flags a step whose live region still describes the step before it', () => {
    expect(
      statusProblems(
        stepped(
          ['ArrowRight', 'Cab ₹600 waits'],
          ['ArrowRight', EMPTY, 'Cab ₹600 waits'],
          ['ArrowRight', 'Claude prepares Dinner ₹2,400'],
          ['Home', EMPTY, ''],
        ),
      ),
    ).toEqual([
      `After key 2 (→) the live region says "Cab ₹600 waits", but the plate reads "${EMPTY}".`,
      `After key 4 (Home) the live region says "", but the plate reads "${EMPTY}".`,
    ]);
  });

  it('flags a → that leaves the live region saying what it said before', () => {
    expect(
      statusProblems([
        step(
          'ArrowRight',
          'Pay 2 of 3 · Alex pays Sam ₹200',
          'Pay 2 of 3 · Alex pays Sam ₹200',
          'Pay 2 of 3 · Alex pays Sam ₹200',
        ),
        step('ArrowRight', EMPTY, EMPTY, 'Pay 2 of 3 · Alex pays Sam ₹200'),
        step('Home', EMPTY, EMPTY, EMPTY),
      ]),
    ).toEqual([
      'After key 1 (→) the live region says nothing new: still "Pay 2 of 3 · Alex pays Sam ₹200".',
    ]);
  });

  it('flags a run that never reached the restart by →, or never pressed Home', () => {
    expect(statusProblems([])).toEqual(['The tour took no steps.']);
    expect(
      statusProblems(
        stepped(
          ['ArrowRight', 'One'],
          ['ArrowRight', 'Two'],
          ['ArrowRight', 'One'],
          ['Home', EMPTY],
        ),
      ),
    ).toEqual([`The → presses never came round to the restart ("${EMPTY}"), so it went untested.`]);
    expect(statusProblems(stepped(['ArrowRight', EMPTY], ['ArrowRight', 'Two']))).toEqual([
      'The tour was never started over with Home.',
    ]);
  });
});
