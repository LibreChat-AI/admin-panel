import { useMemo, useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type * as t from '@/types';
import { ConfigPage, ConfigSkeleton, ConfigLoadError } from '@/components/configuration';
import { AccessDenied, PermissionsUnavailable } from '@/components/shared';
import { baseConfigOptions, configSchemaTreeOptions } from '@/server';
import { hasConfigCapability } from '@/utils';
import { useCapabilities } from '@/hooks';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const Route = createFileRoute('/_app/configuration/')({
  validateSearch: (search: Record<string, unknown>): t.ConfigSearchParams => ({
    tab: optionalString(search.tab),
    field: optionalString(search.field),
    scope: optionalString(search.scope),
    customized: search.customized === 1 || search.customized === '1' ? 1 : undefined,
  }),
  /**
   * The schema is cached for the session; the base config is prefetched so the
   * form mounts with its baseline. A base-config failure is left to the page
   * (it can be a missing permission), a schema failure shows the error route.
   */
  loader: async ({ context: { queryClient } }) => {
    const [tree] = await Promise.all([
      queryClient.query({ ...configSchemaTreeOptions, staleTime: 'static' }),
      queryClient.query(baseConfigOptions).catch(() => undefined),
    ]);
    return { tree };
  },
  pendingMs: 200,
  pendingMinMs: 300,
  pendingComponent: ConfigSkeleton,
  errorComponent: ConfigRouteError,
  component: ConfigurationPage,
});

function ConfigurationPage() {
  const { tab, field, scope, customized } = Route.useSearch();
  const { hasCapability, isLoading, isError } = useCapabilities();
  const { tree: schemaTree } = Route.useLoaderData();

  const canViewAnyConfig = useMemo(
    () =>
      hasConfigCapability(hasCapability, null, 'read') ||
      hasConfigCapability(hasCapability, null, 'manage') ||
      schemaTree.some(
        (s) =>
          hasConfigCapability(hasCapability, s.key, 'read') ||
          hasConfigCapability(hasCapability, s.key, 'manage'),
      ),
    [hasCapability, schemaTree],
  );

  if (isLoading) return <ConfigSkeleton />;
  if (isError) return <PermissionsUnavailable />;
  if (!canViewAnyConfig) return <AccessDenied />;
  return (
    <ConfigPage
      initialTab={tab}
      highlightField={field}
      initialScope={scope}
      customizedOnly={customized === 1}
    />
  );
}

/** Rendered inside the app layout, so the sidebar and header stay usable. */
function ConfigRouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    router.invalidate().finally(() => setRetrying(false));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-2">
      <ConfigLoadError error={error} onRetry={retry} retrying={retrying} />
    </div>
  );
}
