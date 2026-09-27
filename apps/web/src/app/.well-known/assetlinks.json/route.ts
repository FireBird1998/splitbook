/** Public Android domain-association metadata; never reads sessions or ledger data. */
export function GET() {
  const fingerprints = (process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase());
  if (
    process.env.ANDROID_APP_LINKS_ENV !== 'staging' ||
    fingerprints.some((value) => !/^(?:[\dA-F]{2}:){31}[\dA-F]{2}$/.test(value))
  ) {
    return Response.json([], { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.splitbook.app.staging',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
