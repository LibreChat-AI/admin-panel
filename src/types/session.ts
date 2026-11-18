import type { ReactNode } from 'react';
import type { AdminSessionIdentity, SessionErrorCode } from './auth';

export interface SessionRecoveryOptions {
  active: boolean;
  dirty: boolean;
  requiredCapabilities?: readonly string[];
  identity?: AdminSessionIdentity;
}

export interface SessionRecoveryStatus {
  sessionError: SessionErrorCode | null;
  recoveryError: string | null;
  blocked: boolean;
  retrySession: () => Promise<void>;
}

export interface SessionRecoveryState extends SessionRecoveryStatus {
  handleSessionError: (code: SessionErrorCode) => void;
  requireSession: () => void;
}

export interface SessionDraftErrorProps {
  code: SessionErrorCode;
  error: string | null;
  onRetry: () => Promise<void>;
  children?: ReactNode;
}
