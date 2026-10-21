import { createElement, createRef, useEffect, useState, type ComponentType, type Ref } from 'react';
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

/** A DOM input as these tests need one: its caret, and the listeners the field adds to it. */
function inputNode(caret: (start: number, end: number) => void = () => {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const node = {
    setSelectionRange: caret,
    focus: () => {},
    value: '',
    readOnly: false,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  };
  return { node, listeners };
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
    let setOutside: (value: string) => void = () => {};
    function Form() {
      const [value, setValue] = useState(initial);
      useEffect(() => {
        setOutside = setValue;
      }, []);
      return createElement(Field, {
        currency,
        value,
        onValueChange: (next: string) => {
          changed(next);
          setValue(next);
        },
      });
    }
    const { node, listeners } = inputNode(caret);
    await act(async () => {
      renderer = create(createElement(Form), {
        createNodeMock: (element) => (element.type === 'input' ? node : null),
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
    /** An IME's composition so far. */
    const compose = (value: string) =>
      act(async () =>
        input().props.onChange({
          target: { value, selectionStart: value.length, selectionEnd: value.length },
          nativeEvent: { inputType: 'insertCompositionText', data: value, isComposing: true },
        }),
      );
    /** Undo or Redo, as the browser asks for it before it would change the text. */
    const history = async (inputType: 'historyUndo' | 'historyRedo', cancelable = true) => {
      const event = { inputType, cancelable, preventDefault: vi.fn() };
      await act(async () => listeners.get('beforeinput')?.(event));
      return event;
    };
    /** An Undo or Redo the browser made itself, as its input event says. */
    const madeByBrowser = (inputType: 'historyUndo' | 'historyRedo') =>
      act(async () => listeners.get('input')?.({ inputType }));
    /** A key pressed with Cmd, Ctrl, Shift or Alt; `code` is its place on the keyboard. */
    const press = async (
      key: string,
      {
        code = `Key${key.toUpperCase()}`,
        metaKey = false,
        ctrlKey = false,
        shiftKey = false,
        altKey = false,
        isComposing = false,
      } = {},
    ) => {
      const event = {
        key,
        code,
        metaKey,
        ctrlKey,
        shiftKey,
        altKey,
        isComposing,
        preventDefault: vi.fn(),
      };
      await act(async () => listeners.get('keydown')?.(event));
      return event;
    };
    /** An IME's composition ends. */
    const composed = () => act(async () => listeners.get('compositionend')?.({}));
    /** The form sets the amount itself, as a Suggested payment does. */
    const outside = (value: string) => act(async () => setOutside(value));
    return {
      input,
      node,
      changed,
      caret,
      edit,
      compose,
      composed,
      history,
      madeByBrowser,
      press,
      outside,
    };
  }

  it(`${name}: still hands the caller's inputRef the input, as Record payment focuses it`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { node } = inputNode();
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
          createNodeMock: (element) => (element.type === 'input' ? inputNode(caret).node : null),
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
    // The 5 replaced what Redo would have put back, so Undo goes back to 123.
    await history('historyUndo');
    expect(input().props.value).toBe('123');
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

  it(`${name}: an Undo the browser makes itself, as from its menu, steps the field's history once`, async () => {
    const { input, changed, edit, madeByBrowser } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    await madeByBrowser('historyUndo');
    expect(input().props.value).toBe('123');
    expect(changed).toHaveBeenLastCalledWith('123');
    // Its change, with the browser's own text, steps nothing more.
    await edit('', 0, 'historyUndo');
    expect(input().props.value).toBe('123');
  });

  it(`${name}: an Undo the browser won't let go of steps once, as it makes it`, async () => {
    const { input, edit, history, madeByBrowser } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    const undo = await history('historyUndo', false);
    expect(undo.preventDefault).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1,234');
    await madeByBrowser('historyUndo');
    await edit('', 0, 'historyUndo');
    expect(input().props.value).toBe('123');
  });

  it(`${name}: after the form sets the amount itself, Undo doesn't bring back what was typed before`, async () => {
    const { input, changed, edit, history, outside } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    await outside('500');
    expect(input().props.value).toBe('500');
    changed.mockClear();
    await history('historyUndo');
    expect(input().props.value).toBe('500');
    expect(changed).not.toHaveBeenCalled();
  });

  it(`${name}: an Undo while not focused changes nothing`, async () => {
    const { input, changed, edit, press } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    await act(async () => input().props.onBlur({}));
    changed.mockClear();
    await press('z', { metaKey: true });
    expect(input().props.value).toBe('12.00');
    expect(changed).not.toHaveBeenCalled();
  });

  it(`${name}: a comma typed after 1,250, then a 5, stays as typed and refused, never 12,505`, async () => {
    const { input, changed, edit } = await focused('EUR', '');
    for (const typed of ['1', '12', '125', '1250']) await edit(typed);
    await edit('1,250,', 6, 'insertText', ',');
    expect(input().props.value).toBe('1,250,');
    await edit('1,250,5', 7, 'insertText', '5');
    expect(input().props.value).toBe('1,250,5');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: a 5 pasted over 500.00 selected in 10,500.00 stays as typed and refused, never 105`, async () => {
    const { input, changed, edit } = await focused('EUR', '10500');
    await edit('10,5', 4, 'insertFromPaste');
    expect(input().props.value).toBe('10,5');
    expect(readAmountEntry(changed.mock.lastCall![0], 'EUR').status).toBe('invalid');
  });

  it(`${name}: Cmd+Z, Ctrl+Shift+Z and Ctrl+Y step back and forward, whatever the browser's own Undo holds`, async () => {
    const { input, edit, press } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    const undo = await press('z', { metaKey: true });
    expect(undo.preventDefault).toHaveBeenCalled();
    expect(input().props.value).toBe('123');
    await press('Z', { ctrlKey: true, shiftKey: true });
    expect(input().props.value).toBe('1,234');
    await press('z', { ctrlKey: true });
    await press('y', { ctrlKey: true });
    expect(input().props.value).toBe('1,234');
    // Other shortcuts are the browser's.
    const other = await press('z', { metaKey: true, altKey: true });
    const all = await press('a', { metaKey: true });
    const plain = await press('z');
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(all.preventDefault).not.toHaveBeenCalled();
    expect(plain.preventDefault).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1,234');
  });

  it(`${name}: after the form sets the amount and the member types on, Undo goes back to the form's amount`, async () => {
    const { input, changed, edit, history, outside } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    await outside('500');
    await edit('5000');
    expect(input().props.value).toBe('5,000');
    await history('historyUndo');
    expect(input().props.value).toBe('500');
    expect(changed).toHaveBeenLastCalledWith('500');
  });

  it(`${name}: an edit that changes nothing, as Backspace over a grouping comma, is no Undo step`, async () => {
    const { input, edit, history } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234']) await edit(typed);
    await edit('1234', 1, 'deleteContentBackward');
    expect(input().props.value).toBe('1,234');
    await history('historyUndo');
    expect(input().props.value).toBe('123');
  });

  it(`${name}: Undo takes back an IME's composition at once`, async () => {
    const { input, edit, compose, history } = await focused('EUR', '');
    for (const composing of ['1', '12', '123']) await compose(composing);
    expect(input().props.value).toBe('123');
    // What's typed after it is a step of its own.
    await edit('1234');
    await history('historyUndo');
    expect(input().props.value).toBe('123');
    await history('historyUndo');
    expect(input().props.value).toBe('');
    await history('historyRedo');
    expect(input().props.value).toBe('123');
  });

  it(`${name}: Undo after leaving the field and coming back starts from what focus showed`, async () => {
    const { input, edit, history } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    await act(async () => input().props.onBlur({}));
    await act(async () => input().props.onFocus({ target: input().props }));
    await history('historyUndo');
    expect(input().props.value).toBe('12.00');
  });

  it(`${name}: Cmd+Z leaves a read-only amount alone, as one in doubt is`, async () => {
    const { input, node, changed, edit, press } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    node.readOnly = true;
    changed.mockClear();
    const undo = await press('z', { metaKey: true });
    expect(undo.preventDefault).not.toHaveBeenCalled();
    expect(input().props.value).toBe('12');
    expect(changed).not.toHaveBeenCalled();
  });

  it(`${name}: Ctrl+Z undoes on a Cyrillic layout too, and Cmd+Y stays the browser's`, async () => {
    const { input, edit, press } = await focused('EUR', '');
    for (const typed of ['1', '12']) await edit(typed);
    const undo = await press('я', { code: 'KeyZ', ctrlKey: true });
    expect(undo.preventDefault).toHaveBeenCalled();
    expect(input().props.value).toBe('1');
    const history = await press('y', { metaKey: true });
    expect(history.preventDefault).not.toHaveBeenCalled();
    expect(input().props.value).toBe('1');
    // Cmd+Z while an IME composes is the IME's.
    const composing = await press('z', { metaKey: true, isComposing: true });
    expect(composing.preventDefault).not.toHaveBeenCalled();
  });

  it(`${name}: two compositions are two Undo steps`, async () => {
    const { input, compose, composed, history } = await focused('EUR', '');
    for (const composing of ['1', '12']) await compose(composing);
    await composed();
    await compose('123');
    await history('historyUndo');
    expect(input().props.value).toBe('12');
    await history('historyUndo');
    expect(input().props.value).toBe('');
  });

  it(`${name}: an edit that changes nothing still ends what Redo would put back`, async () => {
    const { input, edit, history } = await focused('EUR', '');
    for (const typed of ['1', '12', '123', '1234', '12345']) await edit(typed);
    await history('historyUndo');
    expect(input().props.value).toBe('1,234');
    await edit('1234', 1, 'deleteContentBackward');
    await history('historyRedo');
    expect(input().props.value).toBe('1,234');
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
