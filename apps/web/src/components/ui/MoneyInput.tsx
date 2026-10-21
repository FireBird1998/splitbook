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

/** What the field shows, and the form's amount behind it. */
type Entry = { text: string; value: string };

/** Undo steps back and Redo forward; any other input is no step. */
const historyStep = (inputType: string) =>
  inputType === 'historyUndo' ? -1 : inputType === 'historyRedo' ? 1 : 0;

/** Cmd or Ctrl with Z undoes and with Shift+Z or Y redoes; any other key is no step. */
function shortcutStep({ key, metaKey, ctrlKey, shiftKey, altKey }: KeyboardEvent) {
  if (!(metaKey || ctrlKey) || altKey) return 0;
  if (key.toLowerCase() === 'z') return shiftKey ? 1 : -1;
  return key.toLowerCase() === 'y' && !shiftKey ? 1 : 0;
}

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
  // next digit went in front. One composition is one step.
  const history = useRef<{ entries: Entry[]; at: number; composing: boolean }>({
    entries: [],
    at: 0,
    composing: false,
  });
  const shown =
    editing === null
      ? formatAmountEntry(value, currency)
      : editing.value === value
        ? editing.text
        : ungroupAmountEntry(value);
  /** The history, begun again from the amount the form set itself, if it did since. */
  const synced = () => {
    if (history.current.entries[history.current.at]?.value !== value) {
      history.current = { entries: [{ text: shown, value }], at: 0, composing: false };
    }
    return history.current;
  };
  const step = (by: number) => {
    if (editing === null || by === 0) return;
    const { entries, at } = synced();
    const from = entries[at];
    const to = entries[at + by];
    if (from === undefined || to === undefined) return;
    history.current = { entries, at: at + by, composing: false };
    caret.current = indexAfter(to.text, changedUpTo(from.text, to.text));
    setEditing(to);
    onValueChange(to.value);
  };
  useLayoutEffect(() => {
    const node = input.current;
    if (node === null) return;
    // From the keyboard, whatever the browser's own Undo holds: Chromium redoes only what it
    // undid itself.
    const fromKeys = (event: KeyboardEvent) => {
      const by = shortcutStep(event);
      if (by === 0) return;
      event.preventDefault();
      step(by);
    };
    // From the browser's menu: taken before it acts, or heard after when it won't let go.
    const beforeInput = (event: InputEvent) => {
      const by = historyStep(event.inputType);
      if (by === 0 || !event.cancelable) return;
      event.preventDefault();
      step(by);
    };
    const afterInput = (event: Event) => step(historyStep((event as InputEvent).inputType));
    node.addEventListener('keydown', fromKeys);
    node.addEventListener('beforeinput', beforeInput);
    node.addEventListener('input', afterInput);
    return () => {
      node.removeEventListener('keydown', fromKeys);
      node.removeEventListener('beforeinput', beforeInput);
      node.removeEventListener('input', afterInput);
    };
  });
  return {
    value: shown,
    inputRef: ref,
    // Do not rewrite the DOM value on focus: that would drop Tab's selection or a clicked
    // caret. Keep the displayed text until the member edits it; blur still groups it.
    onFocus: () => {
      const entry = { text: formatAmountEntry(value, currency), value };
      history.current = { entries: [entry], at: 0, composing: false };
      setEditing(entry);
    },
    onBlur: () => setEditing(null),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const typed = event.target.value;
      // Regroup as the member types (#773), the caret after as many characters as before. Only
      // the browser's event says what an edit typed: nothing for a Backspace, Delete or Cut; a
      // change a password manager, autofill or a test sends may not say. An IME's composition
      // stays as typed while it lasts.
      const {
        inputType = '',
        isComposing = false,
        data = null,
      } = (event.nativeEvent as Partial<InputEvent> | undefined) ?? {};
      // The field's history answers Undo and Redo, as its listeners hear them.
      if (historyStep(inputType) !== 0) return;
      const edit = { from: shown, typed: inputType.startsWith('delete') ? '' : data };
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
      const { entries, at, composing } = synced();
      const last = entries[at];
      if (last === undefined || last.text !== next.text || last.value !== next.value) {
        // A composition's updates replace each other.
        const kept = composing && isComposing ? at : at + 1;
        history.current = {
          entries: [...entries.slice(0, kept), next],
          at: kept,
          composing: isComposing,
        };
      }
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
