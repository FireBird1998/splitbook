import { createElement, createRef, useState, type ComponentType, type Ref } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { readAmountEntry } from '@splitbook/shared/amount-entry';
import { MoneyInputBase, MoneyTextField } from './MoneyInput';

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it('shows a new controlled amount while focused, rather than keeping an earlier suggestion (#773)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const field = (value: string) =>
    createElement(MoneyInputBase, { currency: 'INR', value, onValueChange: () => {} });
  await act(async () => {
    renderer = create(field('1842.5'));
  });
  const input = () => renderer.root.findByType('input');
  await act(async () => input().props.onFocus({}));
  expect(input().props.value).toBe('1,842.50');
  await act(async () => renderer.update(field('2302.5')));
  expect(input().props.value).toBe('2302.5');
  await act(async () => input().props.onBlur({}));
  expect(input().props.value).toBe('2,302.50');
});

const fields: Array<
  [
    string,
    ComponentType<{
      value: string;
      currency: string;
      onValueChange: (value: string) => void;
      inputRef?: Ref<HTMLInputElement>;
    }>,
  ]
> = [
  ['MoneyInputBase', MoneyInputBase],
  ['MoneyTextField', MoneyTextField],
];
for (const [name, Field] of fields) {
  it.each([
    ['EUR', '500', '500.00', '300', '300'],
    // Grouped as it is typed since the Designer's #773 gap.
    ['EUR', '1842.5', '1,842.50', '2000', '2,000'],
    ['JPY', '1200', '1,200', '800', '800'],
  ])(
    `${name}: preserves Tab's selected %s amount so typing replaces it`,
    async (currency, initial, shown, replacement, replaced) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const changed = vi.fn();
      function Form() {
        const [value, setValue] = useState(initial);
        return createElement(Field, {
          currency,
          value,
          onValueChange: (next: string) => {
            changed(next);
            setValue(next);
          },
        });
      }
      await act(async () => {
        renderer = create(createElement(Form));
      });
      const input = () => renderer.root.findByType('input');
      expect(input().props.value).toBe(shown);
      // Tab selects the input's displayed text. Rewriting value during focus destroys that
      // native selection; the real-keyboard journey verifies the browser and POST body too.
      await act(async () =>
        input().props.onFocus({
          target: { value: shown, selectionStart: 0, selectionEnd: shown.length },
        }),
      );
      expect(input().props.value).toBe(shown);
      await act(async () =>
        input().props.onChange({ target: { value: replacement }, nativeEvent: new Event('input') }),
      );
      expect(input().props.value).toBe(replaced);
      expect(changed).toHaveBeenLastCalledWith(replacement);
    },
  );
  it(`${name}: does not move a clicked caret by rewriting the displayed amount`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => {
      renderer = create(
        createElement(Field, { currency: 'EUR', value: '1842.5', onValueChange: () => {} }),
      );
    });
    const input = () => renderer.root.findByType('input');
    await act(async () =>
      input().props.onFocus({ target: { value: '1,842.50', selectionStart: 3, selectionEnd: 3 } }),
    );
    expect(input().props.value).toBe('1,842.50');
  });
}

// #773, the Designer's gap: while focused the field kept its grouped text and only took an edit
// that left the commas in their usual places, so Backspace after the 8 in "1,842.50" gave
// "1,42.50", which was refused. The field now regroups as the member types, the caret after as
// many characters as before, and a comma that may be a decimal comma ("10,5") stays as typed.
for (const [name, Field] of fields) {
  /** The field, focused on `initial` as grouped, with what it hands the form and its caret. */
  async function focused(currency: string, initial: string) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const changed = vi.fn();
    const caret = vi.fn();
    function Form() {
      const [value, setValue] = useState(initial);
      return createElement(Field, {
        currency,
        value,
        onValueChange: (next: string) => {
          changed(next);
          setValue(next);
        },
      });
    }
    let beforeInput: ((event: unknown) => void) | undefined;
    await act(async () => {
      renderer = create(createElement(Form), {
        createNodeMock: (element) =>
          element.type === 'input'
            ? {
                setSelectionRange: caret,
                focus: () => {},
                value: '',
                addEventListener: (type: string, listener: (event: unknown) => void) => {
                  if (type === 'beforeinput') beforeInput = listener;
                },
                removeEventListener() {},
              }
            : null,
      });
    });
    const input = () => renderer.root.findByType('input');
    await act(async () => input().props.onFocus({ target: input().props }));
    /** What the member's keystroke left in the field, the caret at `at`; `data` is what it typed. */
    const edit = (
      value: string,
      at = value.length,
      inputType = 'insertText',
      data: string | null = null,
    ) =>
      act(async () =>
        input().props.onChange({
          target: { value, selectionStart: at, selectionEnd: at },
          nativeEvent: { inputType, data },
        }),
      );
    /** Undo or Redo, as the browser asks for it before it would change the text. */
    const history = async (inputType: 'historyUndo' | 'historyRedo') => {
      const event = { inputType, cancelable: true, preventDefault: vi.fn() };
      await act(async () => beforeInput?.(event));
      return event;
    };
    return { input, changed, caret, edit, history };
  }

  it(`${name}: still hands the caller's inputRef the input, as Record payment focuses it`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const node = {
      setSelectionRange: () => {},
      focus: () => {},
      value: '',
      addEventListener() {},
      removeEventListener() {},
    };
    const inputRef = createRef<HTMLInputElement>();
    await act(async () => {
      renderer = create(
        createElement(Field, { currency: 'EUR', value: '', onValueChange: () => {}, inputRef }),
        { createNodeMock: (element) => (element.type === 'input' ? node : null) },
      );
    });
    expect(inputRef.current).toBe(node);
  });

  it(`${name}: an edit while not focused, as autofill makes, leaves Tab's later selection alone`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const caret = vi.fn();
    await act(async () => {
      renderer = create(
        createElement(Field, { currency: 'EUR', value: '', onValueChange: () => {} }),
        {
          createNodeMock: (element) =>
            element.type === 'input'
              ? {
                  setSelectionRange: caret,
                  focus: () => {},
                  value: '',
                  addEventListener() {},
                  removeEventListener() {},
                }
              : null,
        },
      );
    });
    await act(async () =>
      renderer.root.findByType('input').props.onChange({
        target: { value: '1842', selectionStart: 4, selectionEnd: 4 },
        nativeEvent: { inputType: 'insertReplacementText' },
      }),
    );
    await act(async () => renderer.root.findByType('input').props.onFocus({}));
    expect(caret).not.toHaveBeenCalled();
  });

  it(`${name}: Backspace after the 8 in 1,842.50 regroups to 142.50, the caret after the 1`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    expect(input().props.value).toBe('1,842.50');
    await edit('1,42.50', 2, 'deleteContentBackward');
    expect(input().props.value).toBe('142.50');
    expect(changed).toHaveBeenLastCalledWith('142.50');
    expect(caret).toHaveBeenLastCalledWith(1, 1);
  });

  it(`${name}: a 5 typed after "1," regroups to 15,842.50, the caret after the 5`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit('1,5842.50', 3);
    expect(input().props.value).toBe('15,842.50');
    expect(changed).toHaveBeenLastCalledWith('15842.50');
    expect(caret).toHaveBeenLastCalledWith(2, 2);
  });

  it(`${name}: deleting the first digit of 1,842.50 leaves 842.50`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit(',842.50', 0, 'deleteContentBackward');
    expect(input().props.value).toBe('842.50');
    expect(changed).toHaveBeenLastCalledWith('842.50');
    expect(caret).toHaveBeenLastCalledWith(0, 0);
  });

  it(`${name}: Backspace over a grouping comma steps back past it, so the next one takes the 1`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit('1842.50', 1, 'deleteContentBackward');
    expect(input().props.value).toBe('1,842.50');
    expect(changed).toHaveBeenLastCalledWith('1842.50');
    expect(caret).toHaveBeenLastCalledWith(1, 1);
  });

  it(`${name}: Delete before a grouping comma steps past it, so the next one takes the 8`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit('1842.50', 1, 'deleteContentForward');
    expect(input().props.value).toBe('1,842.50');
    expect(caret).toHaveBeenLastCalledWith(2, 2);
    await edit('1,42.50', 2, 'deleteContentForward');
    expect(input().props.value).toBe('142.50');
    expect(changed).toHaveBeenLastCalledWith('142.50');
    expect(caret).toHaveBeenLastCalledWith(1, 1);
  });

  it(`${name}: a point typed after the 12 in 1,250 reads 12.50, the caret after the point`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '');
    for (const typed of ['1', '12', '125', '1250']) await edit(typed);
    expect(input().props.value).toBe('1,250');
    await edit('1,2.50', 4, 'insertText', '.');
    expect(input().props.value).toBe('12.50');
    expect(changed).toHaveBeenLastCalledWith('12.50');
    expect(caret).toHaveBeenLastCalledWith(3, 3);
  });

  it(`${name}: Backspace over the point in 1,842.50, then the point typed back, gives 1,842.50`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit('1,84250', 5, 'deleteContentBackward');
    expect(input().props.value).toBe('184,250');
    expect(caret).toHaveBeenLastCalledWith(5, 5);
    await edit('184,2.50', 6, 'insertText', '.');
    expect(input().props.value).toBe('1,842.50');
    expect(changed).toHaveBeenLastCalledWith('1842.50');
    expect(caret).toHaveBeenLastCalledWith(6, 6);
  });

  it(`${name}: a 9 typed over 842 selected in 1,842.50 reads 19.50, the caret after the 9`, async () => {
    const { input, changed, caret, edit } = await focused('EUR', '1842.5');
    await edit('1,9.50', 3, 'insertText', '9');
    expect(input().props.value).toBe('19.50');
    expect(changed).toHaveBeenLastCalledWith('19.50');
    expect(caret).toHaveBeenLastCalledWith(2, 2);
  });

  it(`${name}: a 9 pasted over 842 reads 19.50 too, but a pasted comma stays refused`, async () => {
    const pasted = await focused('EUR', '1842.5');
    await pasted.edit('1,9.50', 3, 'insertFromPaste');
    expect(pasted.input().props.value).toBe('19.50');
    await act(async () => renderer.unmount());
    const comma = await focused('EUR', '1842.5');
    await comma.edit('1,9,5.50', 5, 'insertFromPaste');
    expect(comma.input().props.value).toBe('1,9,5.50');
    expect(readAmountEntry(comma.changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: Undo after a regroup steps back to 123, so a 5 makes 1,235, never 51,234`, async () => {
    const { input, changed, caret, edit, history } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    expect(input().props.value).toBe('1,234');
    const undo = await history('historyUndo');
    expect(undo.preventDefault).toHaveBeenCalled();
    expect(input().props.value).toBe('123');
    expect(changed).toHaveBeenLastCalledWith('123');
    expect(caret).toHaveBeenLastCalledWith(3, 3);
    await edit('1235');
    expect(input().props.value).toBe('1,235');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR')).toEqual({
      status: 'valid',
      amountMinor: 123500,
    });
  });

  it(`${name}: Redo puts an undone edit back, the caret after it`, async () => {
    const { input, changed, caret, edit, history } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    await history('historyUndo');
    expect(input().props.value).toBe('123');
    await history('historyRedo');
    expect(input().props.value).toBe('1,234');
    expect(changed).toHaveBeenLastCalledWith('1234');
    expect(caret).toHaveBeenLastCalledWith(5, 5);
    // Nothing to redo: the amount stays.
    await history('historyRedo');
    expect(input().props.value).toBe('1,234');
  });

  it(`${name}: Undo of a Backspace puts the 8 back, the caret after it, and stops at the amount focus showed`, async () => {
    const { input, changed, caret, edit, history } = await focused('EUR', '1842.5');
    await edit('1,42.50', 2, 'deleteContentBackward');
    await history('historyUndo');
    expect(input().props.value).toBe('1,842.50');
    // The form's own amount at focus, as it had it.
    expect(changed).toHaveBeenLastCalledWith('1842.5');
    expect(caret).toHaveBeenLastCalledWith(3, 3);
    const past = await history('historyUndo');
    expect(past.preventDefault).toHaveBeenCalled();
    expect(input().props.value).toBe('1,842.50');
  });

  it(`${name}: an Undo the browser makes itself steps the field's history, not the browser's`, async () => {
    const { input, changed, edit } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    await edit('', 0, 'historyUndo');
    expect(input().props.value).toBe('123');
    expect(changed).toHaveBeenLastCalledWith('123');
  });

  it(`${name}: a whole yen amount regroups too, and INR groups as it does on blur`, async () => {
    const yen = await focused('JPY', '1842');
    expect(yen.input().props.value).toBe('1,842');
    await yen.edit('1,42', 2, 'deleteContentBackward');
    expect(yen.input().props.value).toBe('142');
    expect(yen.changed).toHaveBeenLastCalledWith('142');
    await act(async () => renderer.unmount());
    const rupees = await focused('INR', '');
    for (const typed of ['1', '18', '184', '1842', '1,8425', '18,4250']) await rupees.edit(typed);
    expect(rupees.input().props.value).toBe('184,250');
    expect(readAmountEntry(rupees.changed.mock.lastCall![0], 'INR')).toEqual({
      status: 'valid',
      amountMinor: 18425000,
    });
    await act(async () => rupees.input().props.onBlur({}));
    expect(rupees.input().props.value).toBe('184,250.00');
  });

  it(`${name}: "10,5" typed key by key stays as typed and is refused, never 105`, async () => {
    const { input, changed, edit } = await focused('EUR', '');
    for (const typed of ['1', '10', '10,', '10,5']) await edit(typed);
    expect(input().props.value).toBe('10,5');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: a 5 typed over 500.00 selected in 10,500.00 stays as typed and refused, never 105`, async () => {
    const { input, changed, edit } = await focused('EUR', '10500');
    expect(input().props.value).toBe('10,500.00');
    await edit('10,5', 4, 'insertText', '5');
    expect(input().props.value).toBe('10,5');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: an IME's composition stays as typed while it lasts`, async () => {
    const { input, changed } = await focused('JPY', '');
    await act(async () =>
      input().props.onChange({
        target: { value: '1842', selectionStart: 4, selectionEnd: 4 },
        nativeEvent: { inputType: 'insertCompositionText', isComposing: true },
      }),
    );
    expect(input().props.value).toBe('1842');
    expect(changed).toHaveBeenLastCalledWith('1842');
  });

  it(`${name}: an amount the currency refuses stays as typed, as blur leaves it`, async () => {
    const euros = await focused('EUR', '');
    await euros.edit('1200.001');
    expect(euros.input().props.value).toBe('1200.001');
    await act(async () => renderer.unmount());
    const yen = await focused('JPY', '');
    await yen.edit('1842.5');
    expect(yen.input().props.value).toBe('1842.5');
    await act(async () => yen.input().props.onBlur({}));
    expect(yen.input().props.value).toBe('1842.5');
  });

  it(`${name}: "10,50" then a point stays as typed and refused, never 1,050`, async () => {
    const { input, changed, edit } = await focused('EUR', '');
    for (const typed of ['1', '10', '10,', '10,5', '10,50']) await edit(typed);
    await edit('10,50.', 6, 'insertText', '.');
    expect(input().props.value).toBe('10,50.');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: Backspace in a refused "10,55" leaves "10,5" as typed, still refused`, async () => {
    const { input, changed, edit } = await focused('EUR', '');
    for (const typed of ['1', '10', '10,', '10,5', '10,55']) await edit(typed);
    await edit('10,5', 4, 'deleteContentBackward');
    expect(input().props.value).toBe('10,5');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: Tab's selection, then 3, 0 and 0, saves 300`, async () => {
    const { input, changed, edit } = await focused('EUR', '1842.5');
    for (const typed of ['3', '30', '300']) await edit(typed);
    expect(input().props.value).toBe('300');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR')).toEqual({
      status: 'valid',
      amountMinor: 30000,
    });
  });
}
