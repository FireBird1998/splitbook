'use client';
import Link from 'next/link';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { ExportRequest } from '@splitbook/shared/export-request';
import { statementPath } from '@splitbook/shared/statement-request';
export default function StatementOption({ request }: { request: ExportRequest | null }) {
  const ready = request?.groupIds.length === 1;
  return (
    <>
      <Typography color="text.secondary">
        Pick one Group and a period. Open its statement, then print or save as PDF.
      </Typography>
      {ready ? (
        <Button
          component={Link}
          href={statementPath(request.groupIds[0], request)}
          variant="contained"
        >
          Open statement
        </Button>
      ) : (
        <Typography role="status">Choose exactly one Group and finish the period.</Typography>
      )}
    </>
  );
}
