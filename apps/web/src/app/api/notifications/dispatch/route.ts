import { unauthorized } from '@/lib/utils/api-response';
import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dispatchExpenseAlerts } from '@/lib/notifications/dispatch';
/** Above the pass's 20-second budget, so the host never cuts a pass short (#843). */
export const maxDuration = 30;
export async function POST(request: Request) {
  const configured = process.env.NOTIFICATION_DISPATCH_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (
    !configured ||
    configured.length < 32 ||
    Buffer.byteLength(provided) !== Buffer.byteLength(configured) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(configured))
  )
    return unauthorized();
  if (new URL(request.url).search || (await request.text()).length)
    return NextResponse.json({ error: 'Invalid request', status: 400 }, { status: 400 });
  try {
    return NextResponse.json(
      { data: await dispatchExpenseAlerts(), status: 200 },
      { headers: { 'Cache-Control': API_CACHE_CONTROL } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Notification dispatch unavailable', status: 503 },
      { status: 503 },
    );
  }
}
