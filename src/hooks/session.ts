import { getRouteApi } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as t from '@/types';
import { SystemCapabilities, hasImpliedCapability } from '@/constants';
import { getEffectiveCapabilitiesFn, verifyAdminTokenFn } from '@/server';
import { holdSessionRedirects } from '@/utils';
import { useLocalize } from './useLocalize';

const Route = getRouteApi('/_app');

/** Keep a form mounted until its original admin can safely continue editing. */
export function useSessionRecovery({
  active,
  dirty,
  requiredCapabilities = [],
  identity,
}: t.SessionRecoveryOptions): t.SessionRecoveryState {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { user, tenantId } = Route.useRouteContext();
  const original = useRef<t.AdminSessionIdentity | null>(null);
  const generation = useRef(0);
  const retrying = useRef(false);
  const failure = useRef<t.SessionErrorCode | null>(null);
  const [sessionError, setSessionError] = useState<t.SessionErrorCode | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (active) {
      original.current ??= identity ?? { userId: user.id, tenantId: tenantId ?? null };
      return;
    }
    generation.current += 1;
    original.current = null;
    failure.current = null;
    setSessionError(null);
    setRecoveryError(null);
  }, [active, identity, user.id, tenantId]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const handleSessionError = useCallback((code: t.SessionErrorCode) => {
    failure.current = code;
    setSessionError(code);
  }, []);

  const requireSession = useMemo(() => {
    let formGeneration: number | null = null;
    return () => {
      formGeneration ??= generation.current;
      if (!active || formGeneration !== generation.current) {
        throw new Error('OPENID_SESSION_ENDED');
      }
      if (failure.current) throw new Error(failure.current);
    };
  }, [active]);

  useEffect(() => {
    if (!active || (!dirty && !sessionError)) return;
    const release = holdSessionRedirects(handleSessionError);
    void queryClient.cancelQueries({ predicate: (query) => query.state.data !== undefined });
    return release;
  }, [active, dirty, sessionError, handleSessionError, queryClient]);

  const retrySession = useCallback(async () => {
    if (!active || retrying.current) return;
    retrying.current = true;
    const request = generation.current;
    setRecoveryError(null);
    try {
      const verified = await verifyAdminTokenFn({ data: { refresh: true } });
      if (request !== generation.current) return;
      if (!verified.valid || !verified.user) {
        handleSessionError(
          verified.error === 'AUTH_SESSION_CHECK_UNAVAILABLE'
            ? 'AUTH_SESSION_CHECK_UNAVAILABLE'
            : 'OPENID_SESSION_ENDED',
        );
        setRecoveryError(
          localize(
            verified.error === 'AUTH_SESSION_CHECK_UNAVAILABLE'
              ? 'com_config_session_retry_failed'
              : 'com_config_session_still_ended',
          ),
        );
        return;
      }
      const previous = original.current;
      if (
        !previous ||
        verified.user.id !== previous.userId ||
        (verified.tenantId ?? null) !== previous.tenantId
      ) {
        setRecoveryError(localize('com_config_session_identity_changed'));
        return;
      }
      const { capabilities } = await getEffectiveCapabilitiesFn();
      if (request !== generation.current) return;
      if (
        ![SystemCapabilities.ACCESS_ADMIN, ...requiredCapabilities].every((capability) =>
          hasImpliedCapability(capabilities, capability),
        )
      ) {
        setRecoveryError(localize('com_config_session_permission_lost'));
        return;
      }
      queryClient.setQueryData(['effectiveCapabilities', verified.user.id], {
        available: true,
        capabilities,
      });
      failure.current = null;
      setSessionError(null);
    } catch {
      if (request === generation.current) {
        setRecoveryError(localize('com_config_session_retry_failed'));
      }
    } finally {
      retrying.current = false;
    }
  }, [active, handleSessionError, localize, queryClient, requiredCapabilities]);

  return {
    sessionError,
    recoveryError,
    blocked: active && sessionError !== null,
    handleSessionError,
    requireSession,
    retrySession,
  };
}
