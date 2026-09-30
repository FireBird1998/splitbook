import { describe, expect, it, vi } from 'vitest';
import { createGoogleIdentityProvider, type NativeGoogleSdk } from './google-identity';

function setup() {
  const sdk = {
    configure: vi.fn<NativeGoogleSdk['configure']>(),
    checkPlayServices: vi.fn<NativeGoogleSdk['checkPlayServices']>().mockResolvedValue(),
    presentExplicitSignIn: vi.fn<NativeGoogleSdk['presentExplicitSignIn']>().mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-issued-token' },
    }),
    signOut: vi.fn<NativeGoogleSdk['signOut']>().mockResolvedValue(),
  };
  let nonce = 0;
  const acquire = createGoogleIdentityProvider(
    '123-test.apps.googleusercontent.com',
    async () => sdk,
    () => `nonce-${++nonce}`,
  );
  return { sdk, acquire };
}

describe('native Google identity acquisition', () => {
  it('uses a fresh nonce and explicit chooser, then clears provider identity before returning', async () => {
    const { sdk, acquire } = setup();
    expect(await acquire()).toEqual({
      status: 'success',
      idToken: 'google-issued-token',
      nonce: 'nonce-1',
    });
    expect(await acquire()).toMatchObject({ nonce: 'nonce-2' });
    expect(sdk.configure).toHaveBeenLastCalledWith({
      webClientId: '123-test.apps.googleusercontent.com',
      nonce: 'nonce-2',
      autoSelectOnSignIn: false,
      offlineAccess: false,
    });
    expect(sdk.signOut).toHaveBeenCalledTimes(2);
  });
  it('treats dismissed chooser as cancellation and still clears cached provider identity', async () => {
    const { sdk, acquire } = setup();
    sdk.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    expect(await acquire()).toEqual({ status: 'cancelled' });
    expect(sdk.signOut).toHaveBeenCalledOnce();
  });
  it('explains unavailable Play services without exposing native errors', async () => {
    const { sdk, acquire } = setup();
    sdk.checkPlayServices.mockRejectedValue({
      code: 'PLAY_SERVICES_NOT_AVAILABLE',
      message: 'private diagnostics',
    });
    expect(await acquire()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Google Play services'),
    });
    expect(sdk.presentExplicitSignIn).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledOnce();
  });
  it('refuses an app session if provider cleanup fails', async () => {
    const { sdk, acquire } = setup();
    sdk.signOut.mockRejectedValue(new Error('native cleanup failed'));
    const result = await acquire();
    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('clear') });
    expect(result).not.toHaveProperty('idToken');
  });
  it('does not reconfigure a chooser already in progress', async () => {
    const { sdk, acquire } = setup();
    let release!: () => void;
    sdk.checkPlayServices.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = acquire();
    await vi.waitFor(() => expect(sdk.checkPlayServices).toHaveBeenCalledOnce());
    expect(await acquire()).toMatchObject({ status: 'error' });
    expect(sdk.configure).toHaveBeenCalledOnce();
    release();
    expect(await first).toMatchObject({ status: 'success' });
  });
});
