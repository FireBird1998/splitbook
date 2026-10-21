'use client';

import { useState } from 'react';
import type { ChangeEvent } from 'react';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import InputBase, { type InputBaseProps } from '@mui/material/InputBase';
import { formatAmountEntry, ungroupAmountEntry } from '@splitbook/shared/amount-entry';
import { getCurrencyPrecision } from '@splitbook/shared/currency';

type MoneyEntryProps = {
  value: string;
  currency: string;
  onValueChange: (value: string) => void;
};

/** Group only the display; focus and blur never edit the form's stored value. */
function useMoneyEntry({ value, currency, onValueChange }: MoneyEntryProps) {
  const [editing, setEditing] = useState<string | null>(null);
  return {
    value: editing ?? formatAmountEntry(value, currency),
    onFocus: () => setEditing(ungroupAmountEntry(value)),
    onBlur: () => setEditing(null),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const typed = event.target.value;
      setEditing((current) => (current === null ? null : typed));
      onValueChange(ungroupAmountEntry(typed));
    },
  };
}

export function MoneyTextField({
  currency,
  value,
  onValueChange,
  onFocus,
  onBlur,
  slotProps,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & MoneyEntryProps) {
  const entry = useMoneyEntry({ currency, value, onValueChange });
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
  inputProps,
  ...props
}: Omit<InputBaseProps, 'value' | 'onChange' | 'type'> & MoneyEntryProps) {
  const entry = useMoneyEntry({ currency, value, onValueChange });
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
