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
  // Its tint, primary text, and status-coloured icon and Retry are every banner's (#772, #782).
  return (
    <Alert
      severity={severity}
      role="alert"
      sx={{ '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}
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
