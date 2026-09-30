/** Public build handshake; never exposes credentials, sessions, or ledger data. */
export function GET() {
  const googleWebClientId = process.env.AUTH_GOOGLE_ID;
  const available =
    process.env.MOBILE_APP_ENV === 'staging' &&
    process.env.AUTH_MODE === 'google' &&
    !process.env.AUTH_TEST_ID_TOKEN_SECRET &&
    process.env.ALLOW_DEMO_AUTH !== 'true' &&
    /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleWebClientId ?? '');
  return Response.json(available ? { environment: 'staging', googleWebClientId } : {}, {
    status: available ? 200 : 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}
