import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

/**
 * Settings' confirmation before Disconnect (#615), which an assistant's own page asks too (#620).
 */
export default function DisconnectDialog({
  name,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
  onExited,
}: {
  name: string | null;
  open: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  onExited?: () => void;
}) {
  return (
    <Dialog
      open={open}
      slotProps={{ transition: { onExited } }}
      onClose={() => {
        if (!busy) onCancel();
      }}
      aria-labelledby="disconnect-assistant-title"
      aria-describedby="disconnect-assistant-description"
    >
      <DialogTitle id="disconnect-assistant-title">Disconnect {name}?</DialogTitle>
      <DialogContent>
        <DialogContentText id="disconnect-assistant-description">
          The assistant stops at once. Items already prepared stay in your To review. Previously
          shared information may remain in your assistant.
        </DialogContentText>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          color="error"
          sx={{ color: 'status.negative' }}
          disabled={busy || !name}
          onClick={onConfirm}
        >
          Disconnect
        </Button>
      </DialogActions>
    </Dialog>
  );
}
