import { Button, Portal, Snackbar } from '@mui/material';
import { toReviewHref } from '@splitbook/shared/api-paths';

export default function KeptInToReview({
  groupId,
  onClose,
}: {
  groupId: string | null;
  onClose: () => void;
}) {
  return (
    <Portal>
      <Snackbar
        open={groupId !== null}
        autoHideDuration={6000}
        onClose={(_, reason) => {
          if (reason !== 'clickaway') onClose();
        }}
        message="Kept in To review"
        action={
          groupId ? (
            <Button color="inherit" href={toReviewHref(groupId)}>
              View
            </Button>
          ) : undefined
        }
      />
    </Portal>
  );
}
