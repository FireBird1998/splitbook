import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { countApart, outerTexts, wordsOf } from '../test-utils/layout';
import { setWindow } from '../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CurrencySheet } = await import('./currency-sheet');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

// #898: at 200% the sheet's subtitle read "Lisbon and Tokyo · 2 / currencies". A count and its
// noun are joined by a no-break space, so a line never breaks between them.
it.each([1.5, 2])('keeps “2 currencies” on one line at %s× text (#898)', (fontScale) => {
  setWindow({ width: 360, height: 640, fontScale });
  act(() => {
    renderer = create(
      <CurrencySheet
        visible
        groupName="Lisbon and Tokyo"
        choices={[
          { code: 'EUR', name: 'Euro', note: 'Your latest Expense here' },
          { code: 'INR', name: 'Indian Rupee', note: 'Main currency' },
        ]}
        currency="EUR"
        locked={false}
        offline={false}
        onChoose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
  });
  const json = renderer!.toJSON() as ReactTestRendererJSON | ReactTestRendererJSON[] | null;
  const lines = [json]
    .flat()
    .flatMap((node) => outerTexts(node))
    .map(wordsOf);
  expect(lines).toContain('Lisbon and Tokyo\u00a0· 2\u00a0currencies');
  for (const words of lines) expect(words, words).not.toMatch(countApart);
});
