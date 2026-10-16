import { useNavigate } from '@tanstack/react-router';
import { useState, useRef, useEffect, useCallback } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { availableScopesOptions, getBatchFieldProfilesFn } from '@/server';

const LAST_SCOPE_KEY = 'config:lastScope';

const profileMapOptions = (fieldPaths: string[]) =>
  queryOptions({
    queryKey: ['profileMap', fieldPaths],
    queryFn: () =>
      getBatchFieldProfilesFn({ data: { paths: fieldPaths } }).then(
        (r: { profileMap: Record<string, string[]> }) => r.profileMap,
      ),
    enabled: fieldPaths.length > 0,
    staleTime: 60_000,
  });

/**
 * The open profile (scope), restored once from the URL or the last-used scope,
 * and the scope selector dialog state (WS8: scopes and profiles).
 */
export function useScopeSelection({
  initialScope,
}: t.ScopeSelectionOptions): t.ScopeSelectionState {
  const navigate = useNavigate({ from: '/configuration/' });
  const [scopeSelectorOpen, setScopeSelectorOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<t.ScopeSelection>({ type: 'BASE' });

  const selectScope = useCallback(
    (newSelection: t.ScopeSelection) => {
      setSelectedScope(newSelection);
      const scopeId =
        newSelection.type === 'SCOPE' && newSelection.scope._id
          ? newSelection.scope._id
          : undefined;
      if (scopeId) {
        localStorage.setItem(LAST_SCOPE_KEY, scopeId);
      } else {
        localStorage.removeItem(LAST_SCOPE_KEY);
      }
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: scopeId }) });
    },
    [navigate],
  );

  const savedScope = useRef(localStorage.getItem(LAST_SCOPE_KEY) ?? undefined);
  const scopeToRestore = initialScope ?? savedScope.current;
  const { data: allScopes } = useQuery({
    ...availableScopesOptions,
    enabled: !!scopeToRestore,
  });
  const initialScopeApplied = useRef(false);
  useEffect(() => {
    if (scopeToRestore && allScopes && !initialScopeApplied.current) {
      const match =
        allScopes.find((s) => s._id === scopeToRestore) ??
        (() => {
          const [type, ...rest] = scopeToRestore.split(':');
          const id = rest.join(':');
          return allScopes.find(
            (s) => s.principalType === (type as PrincipalType) && s.principalId === id,
          );
        })();
      if (match) {
        initialScopeApplied.current = true;
        setSelectedScope({ type: 'SCOPE', scope: match });
        if (!initialScope) {
          navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: match._id }) });
        }
      }
    }
  }, [scopeToRestore, allScopes, initialScope, navigate]);

  const isEditingScope = selectedScope.type === 'SCOPE';
  const editingScope: t.ConfigScope | undefined =
    selectedScope.type === 'SCOPE' ? selectedScope.scope : undefined;

  return {
    selectedScope,
    selectScope,
    isEditingScope,
    editingScope,
    scopeSelectorOpen,
    setScopeSelectorOpen,
  };
}

/** Which profiles override each field, for the per-field profile indicators (WS8). */
export function useProfileMap(fieldPaths: string[]): t.ProfileMapState {
  const queryClient = useQueryClient();
  const { data: profileMap = {} } = useQuery(profileMapOptions(fieldPaths));

  const handleProfileChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['profileMap'] });
    queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
  }, [queryClient]);

  return { profileMap, handleProfileChange };
}
