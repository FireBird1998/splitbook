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

/** Group only the display; focus and blur never edit the form's stored value. */
function useMoneyEntry(
  { value, currency, onValueChange }: MoneyEntryProps,
  inputRef: Ref<HTMLInputElement> | undefined,
) {
  const [editing, setEditing] = useState<{ text: string; value: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ref = useForkRef(input, inputRef);
  // Where the caret goes once a regrouped amount is on screen; React leaves it at the end.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const shown =
    editing === null
      ? formatAmountEntry(value, currency)
      : editing.value === value
        ? editing.text
        : ungroupAmountEntry(value);
  return {
    value: shown,
    inputRef: ref,
    // Do not rewrite the DOM value on focus: that would drop Tab's selection or a clicked
    // caret. Keep the displayed text until the member edits it; blur still groups it.
    onFocus: () => setEditing({ text: formatAmountEntry(value, currency), value }),
    onBlur: () => setEditing(null),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const typed = event.target.value;
      // Regroup as the member types (#773), the caret after as many characters as before. Only
      // the input type tells Backspace, Delete or Cut from typing over a selection; a change a
      // password manager, autofill or a test sends may carry none. An IME's composition stays
      // as typed while it lasts.
      const { inputType = '', isComposing = false } =
        (event.nativeEvent as Partial<InputEvent> | undefined) ?? {};
      const deletedFrom = inputType.startsWith('delete') ? shown : undefined;
      const regrouped = isComposing ? null : regroupAmountEntry(typed, currency, deletedFrom);
      // Not while unfocused, as autofill edits: the caret would wait for focus and undo Tab's
      // selection.
      if (editing !== null && regrouped !== null && regrouped !== typed) {
        const leftOfCaret = typed.slice(0, event.target.selectionStart ?? typed.length);
        const caretAt = indexAfter(regrouped, leftOfCaret.replaceAll(',', '').length);
        // A grouping comma that Delete took out comes back, so the caret steps past it.
        const stepPast = inputType === 'deleteContentForward' && regrouped[caretAt] === ',';
        caret.current = stepPast ? caretAt + 1 : caretAt;
      }
      const plain = regrouped === null ? ungroupAmountEntry(typed) : regrouped.replaceAll(',', '');
      setEditing((current) =>
        current === null ? null : { text: regrouped ?? typed, value: plain },
      );
      onValueChange(plain);
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
