import type * as t from '@/types';

/**
 * Cross-area field metadata (enum labels, units, runtime defaults, path-scoped
 * labels), keyed by wildcard path (WS2). Area workstreams add their own
 * registry files (`providers.ts`, `endpoints.ts`, `specs.ts`, `mcp.ts`, …) and
 * list them in `META_SOURCES` in `index.ts`.
 */
export const GENERIC_FIELD_META: t.FieldMetaRegistry = {};
