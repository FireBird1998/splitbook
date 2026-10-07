import {
  error,
  forbidden,
  getAuthUser,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/utils/api-response';
import { ExportTooLargeError, exportService } from '@/lib/services/export.service';
import { parseExportQuery } from '@splitbook/shared/export-request';

/**
 * GET /api/export?groups=a,b&from=2026-09-01&to=2026-09-30&include=payments,shares&format=csv&tz=…
 *
 * The member's export (#317): one CSV, or a zip of several, as an attachment. Refusals and
 * failures answer in the usual JSON shape. See docs/api.md, "Export".
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const parsed = parseExportQuery(new URL(req.url).searchParams);
    if (!parsed.success) return validationError(parsed.error);

    const download = await exportService.csv(user.id, parsed.data);
    return new Response(Buffer.from(download.body), {
      status: 200,
      headers: {
        'Content-Type': download.contentType,
        // File names are lower-case ASCII (`exportSlug`), so they need no encoding.
        'Content-Disposition': `attachment; filename="${download.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    // The Group reads' own refusal, whichever Group of the request it was.
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof ExportTooLargeError)
      return error(
        `This export would have ${err.rows.toLocaleString('en-US')} rows, more than the ` +
          `${err.limit.toLocaleString('en-US')} one download can hold. ` +
          'Pick fewer Groups or a shorter period.',
        413,
        'EXPORT_TOO_LARGE',
      );
    return serverError(err);
  }
}
