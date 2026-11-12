import { useContext } from 'react';
import type * as t from '@/types';
import { useCollapsibleSection } from '../../useCollapsibleSection';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { SettingsSection } from '../../SettingsSection';
import { CountBadge } from '@/components/shared';
import { isRowVisible } from '@/utils';

/**
 * One group of the spec editor (Basics, Model, Capabilities, …): a nested
 * settings group that opens for a search hit inside it and follows Expand
 * all. While the tab filter is on, a group with no matching row is hidden.
 */
export function SpecGroup({
  title,
  description,
  paths,
  defaultExpanded = false,
  configuredCount = 0,
  totalCount = 0,
  children,
}: t.SpecGroupProps) {
  const rowFilter = useContext(RowFilterContext);
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
    revealPaths: paths,
  });
  if (!paths.some((path) => isRowVisible(rowFilter, path))) return null;
  return (
    <SettingsSection
      sectionRef={sectionRef}
      title={title}
      description={isExpanded ? description : undefined}
      variant="group"
      badge={
        totalCount > 0 && !isExpanded ? (
          <CountBadge configured={configuredCount} total={totalCount} />
        ) : undefined
      }
      expanded={isExpanded}
      onToggle={toggle}
      hasEverExpanded={hasEverExpanded}
    >
      {children}
    </SettingsSection>
  );
}
