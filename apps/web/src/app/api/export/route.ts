import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { getAuthUser, failedRead, unauthorized, validationError } from '@/lib/utils/api-response';
import { exportService } from '@/lib/services/export.service';
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

    if (parsed.data.preview)
      return Response.json(await exportService.preview(user.id, parsed.data), {
        headers: { 'Cache-Control': API_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' },
      });

    const download = await (parsed.data.format === 'json'
      ? exportService.backup(user.id, parsed.data)
      : exportService.csv(user.id, parsed.data));
    return new Response(Buffer.from(download.body), {
      status: 200,
      headers: {
        'Content-Type': download.contentType,
        // File names are lower-case ASCII (`exportSlug`), so they need no encoding.
        'Content-Disposition': `attachment; filename="${download.fileName}"`,
        'Cache-Control': API_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return failedRead(err, req);
  }
}
