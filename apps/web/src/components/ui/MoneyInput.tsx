'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, Ref } from 'react';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import InputBase, { type InputBaseProps } from '@mui/material/InputBase';
import { useForkRef } from '@mui/material/utils';
import {
  formatAmountEntry,
  regroupAmountEntry,
  ungroupAmountEntry,
} from '@splitbook/shared/amount-entry';
import { getCurrencyPrecision } from '@splitbook/shared/currency';

type MoneyEntryProps = {
  value: string;
  currency: string;
  onValueChange: (value: string) => void;
};

/** The index just after the first `count` characters of `text` that are not commas. */
function indexAfter(text: string, count: number): number {
  let index = 0;
  for (let seen = 0; seen < count && index < text.length; index++) {
    if (text[index] !== ',') seen++;
  }
  return index;
}

/** How many characters of `after`, commas aside, run to the end of what changed from `before`. */
function changedUpTo(before: string, after: string): number {
  const [from, to] = [before.replaceAll(',', ''), after.replaceAll(',', '')];
  let same = 0;
  while (same < Math.min(from.length, to.length) && from[same] === to[same]) same++;
  let tail = 0;
  while (
    tail < Math.min(from.length, to.length) - same &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail++;
  }
  return to.length - tail;
}

const commas = (text: string) => text.split(',').length - 1;

/** What the field shows, and the form's amount behind it. */
type Entry = { text: string; value: string };

/** Group only the display; focus and blur never edit the form's stored value. */
function useMoneyEntry(
  { value, currency, onValueChange }: MoneyEntryProps,
  inputRef: Ref<HTMLInputElement> | undefined,
) {
  const [editing, setEditing] = useState<Entry | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ref = useForkRef(input, inputRef);
  // Where the caret goes once a regrouped amount is on screen; React leaves it at the end.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  // The field's own Undo and Redo since focus (#773). Regrouping writes the text from script,
  // which leaves the browser nothing to undo: its Undo only moved the caret to the start, so the
  // next digit went in front.
  const history = useRef<{ entries: Entry[]; at: number }>({ entries: [], at: 0 });
  const shown =
    editing === null
      ? formatAmountEntry(value, currency)
      : editing.value === value
        ? editing.text
        : ungroupAmountEntry(value);
  const step = (by: -1 | 1) => {
    const { entries, at } = history.current;
    const from = entries[at];
    const to = entries[at + by];
    if (editing === null || from === undefined || to === undefined) return;
    // The form changed the amount itself since: what came before it is no longer the field's.
    if (from.value !== value) {
      history.current = { entries: [{ text: shown, value }], at: 0 };
      return;
    }
    history.current.at = at + by;
    caret.current = indexAfter(to.text, changedUpTo(from.text, to.text));
    setEditing(to);
    onValueChange(to.value);
  };
  useLayoutEffect(() => {
    const node = input.current;
    if (node === null) return;
    const undoOrRedo = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      // One the browser won't let go of still arrives as a change, and steps there.
      if (!event.cancelable) return;
      event.preventDefault();
      step(event.inputType === 'historyUndo' ? -1 : 1);
    };
    node.addEventListener('beforeinput', undoOrRedo);
    return () => node.removeEventListener('beforeinput', undoOrRedo);
  });
  return {
    value: shown,
    inputRef: ref,
    // Do not rewrite the DOM value on focus: that would drop Tab's selection or a clicked
    // caret. Keep the displayed text until the member edits it; blur still groups it.
    onFocus: () => {
      const entry = { text: formatAmountEntry(value, currency), value };
      history.current = { entries: [entry], at: 0 };
      setEditing(entry);
    },
    onBlur: () => setEditing(null),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const typed = event.target.value;
      // Regroup as the member types (#773), the caret after as many characters as before. Only
      // the browser's event says what an edit typed; a change a password manager, autofill or a
      // test sends may carry none. An IME's composition stays as typed while it lasts.
      const {
        inputType = '',
        isComposing = false,
        data = null,
      } = (event.nativeEvent as Partial<InputEvent> | undefined) ?? {};
      if (inputType === 'historyUndo' || inputType === 'historyRedo') {
        step(inputType === 'historyUndo' ? -1 : 1);
        return;
      }
      // A Backspace, Delete or Cut types nothing; when a paste doesn't say what it typed, a
      // comma it added shows in the count.
      const typedText = inputType.startsWith('delete') ? '' : data;
      const typedComma =
        typedText === null ? commas(typed) > commas(shown) : typedText.includes(',');
      const edit = typedComma
        ? undefined
        : { from: shown, typedDigits: typedText === null || /\d/.test(typedText) };
      const regrouped = isComposing ? null : regroupAmountEntry(typed, currency, edit);
      // Not while unfocused, as autofill edits: the caret would wait for focus and undo Tab's
      // selection.
      if (editing !== null && regrouped !== null && regrouped !== typed) {
        const leftOfCaret = typed.slice(0, event.target.selectionStart ?? typed.length);
        const caretAt = indexAfter(regrouped, leftOfCaret.replaceAll(',', '').length);
        // A grouping comma that Delete took out comes back, so the caret steps past it.
        const stepPast = inputType === 'deleteContentForward' && regrouped[caretAt] === ',';
        caret.current = stepPast ? caretAt + 1 : caretAt;
      }
      const next = {
        text: regrouped ?? typed,
        value: regrouped === null ? ungroupAmountEntry(typed) : regrouped.replaceAll(',', ''),
      };
      const { entries, at } = history.current;
      history.current = { entries: [...entries.slice(0, at + 1), next], at: at + 1 };
      setEditing((current) => (current === null ? null : next));
      onValueChange(next.value);
    },
  };
}

export function MoneyTextField({
  currency,
  value,
  onValueChange,
  onFocus,
  onBlur,
  inputRef,
  slotProps,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & MoneyEntryProps) {
  const entry = useMoneyEntry({ currency, value, onValueChange }, inputRef);
  return (
    <TextField
      {...props}
      {...entry}
      type="text"
      onFocus={(event) => {
        entry.onFocus();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        entry.onBlur();
        onBlur?.(event);
      }}
      slotProps={{
        ...slotProps,
        htmlInput: (owner) => ({
          ...(typeof slotProps?.htmlInput === 'function'
            ? slotProps.htmlInput(owner)
            : slotProps?.htmlInput),
          inputMode: getCurrencyPrecision(currency) === 0 ? 'numeric' : 'decimal',
        }),
      }}
    />
  );
}

export function MoneyInputBase({
  currency,
  value,
  onValueChange,
  onFocus,
  onBlur,
  inputRef,
  inputProps,
  ...props
}: Omit<InputBaseProps, 'value' | 'onChange' | 'type'> & MoneyEntryProps) {
  const entry = useMoneyEntry({ currency, value, onValueChange }, inputRef);
  return (
    <InputBase
      {...props}
      {...entry}
      type="text"
      onFocus={(event) => {
        entry.onFocus();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        entry.onBlur();
        onBlur?.(event);
      }}
      inputProps={{
        ...inputProps,
        inputMode: getCurrencyPrecision(currency) === 0 ? 'numeric' : 'decimal',
      }}
    />
  );
}
