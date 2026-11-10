import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { refusalVocabulary } from '@splitbook/shared/refusals';

it('keeps the HTTP refusal code/status list in step with the vocabulary', () => {
  const document = readFileSync(resolve(process.cwd(), '../../docs/api.md'), 'utf8');
  const section = document
    .split('<!-- refusal-codes:start -->')[1]
    ?.split('<!-- refusal-codes:end -->')[0];
  const expected = Object.entries(refusalVocabulary)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, entry]) => {
      const statuses = [
        ...new Set([
          entry.status,
          ...Object.values(entry.variants).map((variant) => variant.status),
        ]),
      ].sort((left, right) => left - right);
      return `${code}|${statuses.join(', ')}`;
    });
  const actual = section
    ?.split('\n')
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, 3)
        .map((cell) => cell.trim().replaceAll('`', ''))
        .join('|'),
    );
  expect(actual).toEqual(expected);
});
