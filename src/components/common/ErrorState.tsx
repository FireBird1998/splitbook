import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

interface ErrorStateProps {
  /** A user-safe explanation, never an unfiltered server error. */
  message: string;
  severity?: 'error' | 'warning';
  onRetry?: () => void;
  retryLabel?: string;
}

export default function ErrorState({
  message,
  severity = 'error',
  onRetry,
  retryLabel = 'Retry',
}: ErrorStateProps) {
  const tone = severity === 'error' ? 'negative' : 'warning';
  return (
    <Alert
      severity={severity}
      role="alert"
      sx={{
        bgcolor: `tint.${tone}`,
        color: `status.${tone}`,
        '& .MuiAlert-icon': { color: 'inherit' },
        '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' },
      }}
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}
