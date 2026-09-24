/**
 * Server functions for TerraVox tool management.
 *
 * Calls the LibreChat proxy (/api/terravox/tools/all) which forwards to the
 * Tool Gateway admin catalog: every manifest incl. disabled ones.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { apiFetch } from './utils/api';

const toolManifestSchema = z.object({
  tool_id: z.string(),
  version: z.string(),
  display_name: z.string(),
  description: z.string(),
  expose: z.array(z.string()).optional(),
  allowed_groups: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  dangerous: z.boolean().optional(),
  result: z
    .object({
      renderer: z.string().optional(),
    })
    .optional(),
});

export type TerraVoxTool = z.infer<typeof toolManifestSchema>;

export const getToolsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ tools: TerraVoxTool[] }> => {
    const response = await apiFetch('/api/terravox/tools/all');
    if (!response.ok) {
      throw new Error(`Failed to fetch tools: ${response.status}`);
    }
    const json = (await response.json()) as { tools?: unknown[] };
    const parsed = z.array(toolManifestSchema).safeParse(json.tools ?? []);
    if (!parsed.success) {
      throw new Error('Failed to parse tool catalog');
    }
    return { tools: parsed.data };
  },
);

export const toolsQueryOptions = queryOptions({
  queryKey: ['terravox', 'tools', 'all'],
  queryFn: () => getToolsFn().then((r) => r.tools),
  staleTime: 30_000,
});
