import Typography from '@mui/material/Typography';
/** Backup-specific explanation, independent of the CSV preview. */
export default function BackupOption() {
  return (
    <Typography color="text.secondary">
      One JSON file holds all chosen Groups, exact minor units, stored payers and shares, Tags and
      member names. Backups cover all time. Contact fields are omitted and addresses in text are
      redacted. Payments, deleted Expenses and edit history follow the include options.
    </Typography>
  );
}
