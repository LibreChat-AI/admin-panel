import type { SessionRecoveryStatus } from './session';

export interface ConfigDraftContextValue extends SessionRecoveryStatus {
  editSessionId: number;
  registerDraft: (id: string, dirty: boolean) => void;
}

export interface ConfigDraftsState {
  hasPendingDrafts: boolean;
  registerDraft: ConfigDraftContextValue['registerDraft'];
}
