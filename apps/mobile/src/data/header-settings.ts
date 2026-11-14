import type { GroupHeader } from '@splitbook/shared/group-header';
export interface HeaderSettings {
  groupId: string;
  saved: GroupHeader;
  draft: GroupHeader;
  status: 'editing' | 'saving' | 'error';
  message: string | null;
}
export const headerChanged = (state: HeaderSettings) =>
  state.draft.style !== state.saved.style ||
  state.draft.scene !== state.saved.scene ||
  state.draft.time !== state.saved.time;
