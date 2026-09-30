import type { GoogleIdentityResult } from './data/types';

/** Only the capabilities needed for identity acquisition; no app session lives here. */
export interface NativeGoogleSdk {
  configure(options: {
    webClientId: string;
    nonce: string;
    offlineAccess: boolean;
    autoSelectOnSignIn: boolean;
  }): void;
  checkPlayServices(showErrorResolutionDialog: boolean): Promise<void>;
  presentExplicitSignIn(): Promise<{
    type: 'success' | 'cancelled' | 'noSavedCredentialFound';
    data: { idToken: string } | null;
  }>;
  signOut(): Promise<void>;
}

function failure(error: unknown): GoogleIdentityResult {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'SIGN_IN_CANCELLED') return { status: 'cancelled' };
  return {
    status: 'error',
    message:
      code === 'PLAY_SERVICES_NOT_AVAILABLE'
        ? 'Google Play services need an update before you can sign in. Update them and try again.'
        : code === 'DEVELOPER_ERROR'
          ? 'Google sign-in is not ready for this build. Please contact the beta organizer.'
          : 'Could not open Google sign-in. Please try again.',
  };
}

export function createGoogleIdentityProvider(
  webClientId: string,
  loadSdk: () => Promise<NativeGoogleSdk>,
  newNonce: () => string,
): () => Promise<GoogleIdentityResult> {
  let pending = false;
  return async () => {
    if (pending) return { status: 'error', message: 'Finish the current Google sign-in first.' };
    pending = true;
    let sdk: NativeGoogleSdk | undefined;
    let result: GoogleIdentityResult;
    try {
      sdk = await loadSdk();
      const nonce = newNonce();
      if (!nonce) throw new Error('Missing nonce');
      sdk.configure({ webClientId, nonce, offlineAccess: false, autoSelectOnSignIn: false });
      await sdk.checkPlayServices(true);
      const response = await sdk.presentExplicitSignIn();
      if (response.type === 'cancelled') result = { status: 'cancelled' };
      else if (response.type === 'success' && response.data?.idToken) {
        result = { status: 'success', idToken: response.data.idToken, nonce };
      } else {
        result = {
          status: 'error',
          message: 'No Google account is available. Add an account on this device and try again.',
        };
      }
    } catch (error) {
      result = failure(error);
    } finally {
      // The SDK persists Google identity independently. Remove it after every attempt;
      // only the controller's signed Better Auth cookie may restore an app session.
      try {
        await sdk?.signOut();
      } catch {
        result = {
          status: 'error',
          message: 'Could not clear the Google sign-in attempt. Please try again.',
        };
      }
      pending = false;
    }
    return result;
  };
}
