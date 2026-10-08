import { forbidden, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/utils/api-response';
import { exportService, ExportTooLargeError } from '@/lib/services/export.service';
import StatementView from '@/components/statement/StatementView';
import { parseStatementQuery } from '@splitbook/shared/statement-request';
import type { Statement } from '@splitbook/shared/statement';
import Typography from '@mui/material/Typography';
import { Types } from 'mongoose';
import './statement.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Group statement' };
export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) forbidden();
  const query = await searchParams;
  let statement: Statement | null = null;
  let failure = '';
  try {
    const options = parseStatementQuery({
      get: (key) => (typeof query[key] === 'string' ? query[key] : null),
    });
    statement = await exportService.statement(
      user.id,
      {
        groupIds: [id.toLowerCase()],
        format: 'csv',
        include: ['payments'],
        ...options,
      },
      { wholeTrip: options.wholeTrip },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN') forbidden();
    if (error instanceof RangeError) failure = 'Choose a valid period and time zone.';
    else if (error instanceof ExportTooLargeError)
      failure = 'This statement is too large to prepare. Export fewer records as CSV.';
    else throw error;
  }
  return statement ? (
    <StatementView statement={statement} />
  ) : (
    <Typography role="alert">{failure}</Typography>
  );
}
