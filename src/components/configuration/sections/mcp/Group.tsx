import { useContext } from 'react';
import type * as t from '@/types';
import { ConfiguredOnlyContext } from '@/contexts/ConfiguredOnlyContext';
import { useCollapsibleSection } from '../../useCollapsibleSection';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { SettingsSection } from '../../SettingsSection';
import { CountBadge } from '@/components/shared';
import { isRowVisible } from '@/utils';

/**
 * A collapsible group of a server's fields (Connection, Authentication, …).
 * It opens while the tab filter matches a field in it, follows Expand all,
 * and is left out when the filter matches none of its fields, or with "Set
 * values only" when none of them holds a value.
 */
export function McpFieldGroup({
  title,
  description,
  paths,
  defaultExpanded,
  configured = 0,
  total = 0,
  hasValues = true,
  children,
}: t.McpFieldGroupProps) {
  const rowFilter = useContext(RowFilterContext);
  const configuredOnly = useContext(ConfiguredOnlyContext);
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
    revealPaths: paths,
  });
  if (!paths.some((path) => isRowVisible(rowFilter, path))) return null;
  if (configuredOnly && !hasValues) return null;
  return (
    <SettingsSection
      sectionRef={sectionRef}
      title={title}
      description={description}
      variant="group"
      badge={total > 0 ? <CountBadge configured={configured} total={total} /> : undefined}
      expanded={isExpanded}
      onToggle={toggle}
      hasEverExpanded={hasEverExpanded}
    >
      {children}
    </SettingsSection>
  );
}
