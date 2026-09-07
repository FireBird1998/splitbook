'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { formatCurrency } from '@splitbook/shared/currency';

interface DeleteExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  expense: Record<string, unknown> | null;
  groupId: string;
  onDeleted: (expenseId: string) => void;
}

export default function DeleteExpenseDialog({
  open,
  onClose,
  expense,
  groupId,
  onDeleted,
}: DeleteExpenseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!expense) return null;

  const handleDelete = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/groups/${groupId}/expenses/${expense._id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete expense');
        return;
      }

      onDeleted(expense._id as string);
      onClose();
    } catch {
      setError('Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Expense</DialogTitle>
      <DialogContent>
        {error && (
          <Box
            sx={{
              bgcolor: (theme) => `${theme.palette.error.main}12`,
              color: 'error.main',
              px: 1.5,
              py: 1,
              borderRadius: 2,
              fontSize: '0.875rem',
              mb: 1.5,
            }}
          >
            {error}
          </Box>
        )}
        <Typography variant="body2" color="text.primary">
          Are you sure you want to delete{' '}
          <strong>&ldquo;{expense.description as string}&rdquo;</strong> (
          {formatCurrency(expense.amount as number, expense.currency as string)}
          )?
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          This can be undone shortly after deletion.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleDelete} variant="contained" color="error" disabled={loading}>
          {loading ? <CircularProgress size={20} /> : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
