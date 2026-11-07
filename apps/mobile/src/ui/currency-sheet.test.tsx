import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { barCentres, countApart, findHosts, outerTexts, wordsOf } from '../test-utils/layout';
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

// #962: at 130% on a 412 dp phone, Done sat 8.6 dp below "Currency" (22.5 px on the emulator),
// centred on the title and its subtitle. It centres on the title's first line at large text,
// and at 100% both stay on 28 dp, down the 56 dp header.
it.each([
  [412, 1.3, 0.5],
  [360, 2, 0.5],
  [412, 2, 0.5],
  [360, 1.3, 0.5],
  [412, 1, 0],
])('centres Done on “Currency”, %s dp at %s× text (#962)', (width, fontScale, within) => {
  setWindow({ width, height: 915, fontScale });
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
  const header = findHosts(renderer!.toJSON(), (props) => props.testID === 'sheet-drag-area')[0]!
    .children![1] as ReactTestRendererJSON;
  const found = barCentres(header, fontScale, width, {
    done: (node) => node.props.accessibilityLabel === 'Done',
  });
  expect(Object.keys(found).sort()).toEqual(['done', 'title']);
  expect(Math.abs(found.done! - found.title!)).toBeLessThanOrEqual(within);
  if (fontScale === 1) expect(found).toEqual({ title: 28, done: 28 });
});
