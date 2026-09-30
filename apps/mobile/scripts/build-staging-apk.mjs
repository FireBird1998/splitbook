import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'package.json'));
const env = { ...process.env, EXPO_NO_DOTENV: '1' };
function requireSetting(name) {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} before building the staging APK.`);
  return value;
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; build stopped.`);
}

try {
  if (requireSetting('EXPO_PUBLIC_APP_ENV') !== 'staging')
    throw new Error('This command only builds the separate staging app.');
  const origin = new URL(requireSetting('EXPO_PUBLIC_API_URL'));
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.origin !== env.EXPO_PUBLIC_API_URL ||
    env.EXPO_PUBLIC_AUTH_ORIGIN !== origin.origin ||
    (env.EXPO_PUBLIC_INVITE_ORIGIN && env.EXPO_PUBLIC_INVITE_ORIGIN !== origin.origin)
  )
    throw new Error('Use one identical HTTPS origin for the staging API, auth and invitations.');
  const audience = requireSetting('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  for (const name of ['SPLITBOOK_ANDROID_KEYSTORE', 'SPLITBOOK_ANDROID_PASSWORD_FILE']) {
    const path = requireSetting(name);
    if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path.`);
    await access(path, constants.R_OK);
  }
  requireSetting('SPLITBOOK_ANDROID_KEY_ALIAS');
  const response = await fetch(`${origin.origin}/.well-known/splitbook-mobile.json`, {
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15000),
  });
  const server = response.ok ? await response.json() : null;
  if (server?.environment !== 'staging' || server.googleWebClientId !== audience)
    throw new Error('The server does not advertise the configured staging Google audience.');

  // Generate from tracked Expo configuration, never reuse a development package identity.
  run(process.execPath, [
    require.resolve('expo/bin/cli'),
    'prebuild',
    '--platform',
    'android',
    '--no-install',
  ]);
  run(
    './gradlew',
    [
      ':app:assembleRelease',
      '-PreactNativeArchitectures=arm64-v8a',
      '--init-script',
      resolve(root, 'scripts/android/staging-signing.gradle'),
    ],
    resolve(root, 'android'),
  );
  const output = resolve(root, 'android/app/build/outputs/apk/release');
  const metadata = JSON.parse(await readFile(resolve(output, 'output-metadata.json'), 'utf8'));
  if (metadata.applicationId !== 'com.splitbook.app.staging')
    throw new Error('Built package identity does not match staging; do not distribute it.');
  console.log(`Staging ARM64 APK: ${resolve(output, 'app-release.apk')}`);
  console.log(
    'Verify its signing certificate, Google registration and App Links before distribution.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Staging build failed.');
  process.exitCode = 1;
}
