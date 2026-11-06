import { format } from 'date-fns';
import { NO_BREAK_SPACE } from '@splitbook/shared/separator';

/**
 * When a payment was recorded, as its record's header says it: "Fri 6 Nov, 03:21". The day and
 * month are joined by a no-break space, as "5 Nov 17:44" is (#895), so a line never breaks
 * between them.
 */
export const recordedWhen = (recordedAt: string) =>
  format(new Date(recordedAt), `EEE d${NO_BREAK_SPACE}MMM, HH:mm`);
