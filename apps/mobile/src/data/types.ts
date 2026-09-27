import type { GroupCategory } from '@splitbook/shared/types';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface MobileGroup {
  id: string;
  name: string;
  description: string;
  category: GroupCategory;
  defaultCurrency: string;
  members: Array<{
    user: SessionUser;
    role: 'admin' | 'member';
    joinedAt: Date;
  }>;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'denied';

export interface MobileSnapshot {
  auth: {
    status: 'restoring' | 'signed-out' | 'signing-in' | 'authenticated' | 'error';
    user: SessionUser | null;
    message: string | null;
  };
  screen: 'groups' | 'group';
  groups: { status: LoadStatus; data: MobileGroup[]; message: string | null };
  detail: {
    status: LoadStatus;
    id: string | null;
    data: MobileGroup | null;
    message: string | null;
  };
}

export interface MobileConfig {
  /** Backend origin, without /api. May use an emulator's address for a local server. */
  apiBaseUrl: string;
  /** The origin configured as trusted by the backend, which can differ on an emulator. */
  authOrigin: string;
  /** The caller must combine __DEV__ with an explicit development-persona setting. */
  developmentPersonaEnabled: boolean;
}

export interface CredentialStore {
  /** Store one signed session cookie, scoped to this backend. Never a raw session token. */
  load(): Promise<string | null>;
  save(cookie: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CookieHeaders {
  get(name: string): string | null;
  getSetCookie?(): string[];
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: CookieHeaders;
  json(): Promise<unknown>;
}

export type MobileFetch = (url: string, init: RequestInit) => Promise<FetchResponse>;

export interface MobileDependencies {
  fetch: MobileFetch;
  credentials: CredentialStore;
  now?: () => number;
}
