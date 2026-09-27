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

export interface GroupDraft {
  name: string;
  description: string;
  category: GroupCategory;
  defaultCurrency: string;
  startDate: string;
  endDate: string;
}

export interface GroupCreation {
  draft: GroupDraft;
  status: 'editing' | 'saving' | 'error' | 'uncertain';
  message: string | null;
}

export interface InvitationPreview {
  id: string;
  name: string;
  category: GroupCategory;
  memberCount: number;
}

export interface PendingInvitationStore {
  load(): Promise<string | null>;
  save(code: string): Promise<void>;
  clear(): Promise<void>;
}

export interface MobileSnapshot {
  auth: {
    status: 'restoring' | 'signed-out' | 'signing-in' | 'authenticated' | 'error';
    user: SessionUser | null;
    message: string | null;
  };
  screen: 'groups' | 'group' | 'create' | 'invite' | 'settings';
  creation: GroupCreation;
  share: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    url: string | null;
    message: string | null;
  };
  invitation: {
    code: string | null;
    status: 'idle' | 'loading' | 'ready' | 'joining' | 'error' | 'invalid' | 'denied';
    preview: InvitationPreview | null;
    message: string | null;
  };
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
  /** Exact web origin allowed to supply invitations for this build's environment. */
  inviteOrigin?: string;
  /** The caller must combine __DEV__ with an explicit development-persona setting. */
  developmentPersonaEnabled: boolean;
}

export interface CredentialStore {
  /** Store one signed session cookie, scoped to this backend. Never a raw session token. */
  load(): Promise<string | null>;
  save(cookie: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountLocalStorage {
  owner: {
    load(): Promise<string | null>;
    save(accountId: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** Backend-scoped tombstone: a restart must finish cleanup before restoring a session. */
  cleanupMarker: {
    load(): Promise<boolean>;
    mark(): Promise<void>;
    clear(): Promise<void>;
  };
  /** Register at startup. Each store clears all its account keys for this backend. */
  stores: readonly { clear(): Promise<void> }[];
}

/** Capture before asynchronous work. Retired sessions cannot write account data. */
export interface AccountStorageLease {
  accountId: string;
  write<T>(operation: () => Promise<T>): Promise<T>;
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
  pendingInvitation?: PendingInvitationStore;
  accountLocal?: AccountLocalStorage;
  now?: () => number;
}
