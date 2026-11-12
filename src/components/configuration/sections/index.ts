/**
 * Section renderer registry.
 *
 * Map a top-level config section key to a custom React component.  The
 * component receives the same `FieldRendererProps` as the standard
 * `FieldRenderer`, so it always has full context (getValue, onChange,
 * configuredPaths, permissions, etc.).
 *
 * Any section NOT listed here falls back to the generic `FieldRenderer`.
 */

import type React from 'react';
import type * as t from '@/types';
import {
  MemoryRenderer,
  InterfaceRenderer,
  WebSearchRenderer,
  SummarizationRenderer,
  ContentFiltersRenderer,
} from './features';
import {
  CreditsRenderer,
  RateLimitsRenderer,
  SkillSyncRenderer,
  RegistrationRenderer,
} from './system';
import { StorageRenderer, FileConfigRenderer } from './files';
import { CustomEndpointsRenderer } from './endpoints';
import { LangfuseRenderer } from './LangfuseRenderer';
import { ProvidersRenderer } from './providers';
import { ModelSpecsRenderer } from './specs';
import { McpServersRenderer } from './mcp';

export const SECTION_RENDERERS: Partial<Record<string, React.ComponentType<t.FieldRendererProps>>> =
  {
    endpoints: CustomEndpointsRenderer,
    endpointsProviders: ProvidersRenderer,
    mcpServers: McpServersRenderer,
    langfuse: LangfuseRenderer,
    modelSpecs: ModelSpecsRenderer,
    filters: ContentFiltersRenderer,
    interface: InterfaceRenderer,
    memory: MemoryRenderer,
    webSearch: WebSearchRenderer,
    summarization: SummarizationRenderer,
    fileConfig: FileConfigRenderer,
    registration: RegistrationRenderer,
    rateLimits: RateLimitsRenderer,
    skillSync: SkillSyncRenderer,
  };

/** Sections whose custom renderer handles its own accordion — they are rendered
 *  directly in ConfigTabContent without an outer MultiAccordion.Item wrapper. */
export const SELF_CONTAINED_SECTION_RENDERERS = new Set(['endpointsProviders']);

/**
 * Renderers for sections that share a `SectionMeta.group`: the group's
 * sections on a tab render together as one card (WS14: Storage).
 */
export const SECTION_GROUP_RENDERERS: Partial<
  Record<string, React.ComponentType<t.SectionGroupRendererProps>>
> = {
  storage: StorageRenderer,
  credits: CreditsRenderer,
};

/** Read-only sections whose renderer stays open when nothing is set (a table of LibreChat's defaults). */
export const UNFOLDED_READ_ONLY_SECTIONS: ReadonlySet<string> = new Set(['rateLimits']);

/** Section-specific detail under the read-only banner (FX-10): what LibreChat reads instead. */
export const READ_ONLY_DETAIL_KEYS: Readonly<Record<string, string>> = {
  cloudfront: 'com_config_readonly_detail_cloudfront',
  rateLimits: 'com_config_readonly_detail_rate_limits',
  turnstile: 'com_config_readonly_detail_turnstile',
  permissions: 'com_config_readonly_detail_permissions',
  openapi: 'com_config_readonly_detail_openapi',
  clientLimits: 'com_config_readonly_detail_client_limits',
  telemetry: 'com_config_readonly_detail_telemetry',
  conversationList: 'com_config_readonly_detail_conversation_list',
  passwordHashing: 'com_config_readonly_detail_password_hashing',
};
