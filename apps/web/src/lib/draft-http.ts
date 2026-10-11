export function assertDraftOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin)
    throw new Error('FORBIDDEN');
}
/** Bound JSON bytes even when a client omits Content-Length or streams its request. */
export async function boundedBody(request: Request, maxBytes = 128 * 1024): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('REQUEST_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function draftBody(request: Request) {
  assertDraftOrigin(request);
  return JSON.parse(await boundedBody(request));
}
