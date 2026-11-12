import { useState } from 'react';
import type * as t from '@/types';
import { backendName, backendsInUse, isCloudFrontReady, resolveStorage } from './storage';
import { STORAGE_FILE_TYPES } from '@/constants';
import { useLocalize, useYamlConfig, useStorageStates } from '@/hooks';
import { NestedGroup, OtherSettings } from '../../renderer';
import { getValueAtPath, isConfigRecord } from '@/utils';
import { DecorativeIcon } from '@/components/shared';
import { ConfigSection } from '../../ConfigSection';
import { StorageConfirm } from './StorageConfirm';
import { countConfigured } from '../../counts';
import { BackendRow } from './BackendRow';
import { EnvVars } from './EnvVars';

const PRIMARY = 'fileStrategy';
const PER_TYPE = 'fileStrategies';
const CLOUDFRONT = 'cloudfront';
const FILE_TYPES: ReadonlySet<string> = new Set(STORAGE_FILE_TYPES);

function sumCounts(counts: Array<t.SectionCount | undefined>): t.SectionCount {
  return counts.reduce<t.SectionCount>(
    (sum, count) => ({
      total: sum.total + (count?.total ?? 0),
      configured: sum.configured + (count?.configured ?? 0),
      overrides: (sum.overrides ?? 0) + (count?.overrides ?? 0),
    }),
    { total: 0, configured: 0, overrides: 0 },
  );
}

/**
 * The Storage card (FX-6): `fileStrategy`, `fileStrategies` and `cloudfront`
 * as one card. The storage backend first, with the variables it needs on the
 * server; the per-type overrides in a group whose Default choices name the
 * backend each type inherits; CloudFront (read only from librechat.yaml)
 * only while it is in use or configured. Changing where files go is
 * confirmed first.
 */
export function StorageRenderer({
  sections,
  propsFor,
  renderSection,
  counts,
  showConfiguredOnly,
}: t.SectionGroupRendererProps) {
  const localize = useLocalize();
  const yaml = useYamlConfig();
  const states = useStorageStates();
  const [pending, setPending] = useState<t.StorageChangeRequest | null>(null);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const primary = byId.get(PRIMARY);
  const perType = byId.get(PER_TYPE);
  const cloudfront = byId.get(CLOUDFRONT);
  const host = sections[0];
  const resolved = resolveStorage(states);
  const cloudFrontReady = isCloudFrontReady(yaml);
  const nameOf = (backend: t.StorageBackend) => backendName(backend, localize);

  const requestChange = (request: t.StorageChangeRequest) =>
    setPending({
      ...request,
      apply: () => {
        setPending(null);
        request.apply();
      },
    });

  const inheritLabel = (type: t.StorageFileType): string => {
    if (type === 'skills' && resolved.image !== resolved.document) {
      return localize('com_config_storage_inherit_skills', {
        image: nameOf(resolved.image),
        document: nameOf(resolved.document),
      });
    }
    if (type === 'skills') {
      return localize('com_config_storage_inherit_skills_same', { name: nameOf(resolved.image) });
    }
    const from = type === 'default' ? resolved.primary : resolved.default;
    return localize('com_config_storage_inherit', { name: nameOf(from) });
  };
  /** Skill files follow the image and document backends (`getFileStrategy`), not the default. */
  const inheritedOf = (type: t.StorageFileType): readonly t.StorageBackend[] => {
    if (type === 'default') return [resolved.primary];
    if (type !== 'skills') return [resolved.default];
    return resolved.image === resolved.document
      ? [resolved.image]
      : [resolved.image, resolved.document];
  };

  const cloudFrontValue = getValueAtPath(yaml, CLOUDFRONT);
  const cloudFrontConfigured =
    isConfigRecord(cloudFrontValue) || (counts[CLOUDFRONT]?.configured ?? 0) > 0;
  const cloudFrontInUse = backendsInUse(resolved).has('cloudfront');
  const showsCloudFront = cloudFrontInUse || cloudFrontConfigured;
  /** CloudFront's settings count only while its panel shows. */
  const total = sumCounts(
    sections
      .filter((section) => section.id !== CLOUDFRONT || showsCloudFront)
      .map((section) => counts[section.id]),
  );
  const perTypeCounts = perType
    ? countConfigured(perType.fields, PER_TYPE, propsFor(perType).configuredPaths)
    : undefined;
  const typesOverridingPrimary = resolved.default !== resolved.primary;

  return (
    <ConfigSection
      sectionId={host.id}
      title={localize('com_config_storage_title')}
      description={localize('com_config_storage_desc')}
      configuredCount={total.configured}
      totalCount={total.total}
      overrideCount={total.overrides}
      defaultExpanded
      showConfiguredOnly={showConfiguredOnly}
    >
      {primary && (
        <BackendRow
          path={PRIMARY}
          label={localize('com_config_storage_primary')}
          description={localize('com_config_storage_primary_desc')}
          inherited={[resolved.primary]}
          inheritLabel={localize('com_config_storage_inherit_default', {
            name: nameOf(resolved.primary),
          })}
          cloudFrontReady={cloudFrontReady}
          field={primary.sectionField}
          fieldProps={propsFor(primary)}
          onRequestChange={requestChange}
        >
          <EnvVars backend={resolved.primary} />
          {typesOverridingPrimary && (
            <p className="m-0 flex items-start gap-1.5 text-xs text-(--settings-warn-fg)">
              <DecorativeIcon name="warning" size="sm" />
              {localize('com_config_storage_primary_shadowed', { name: nameOf(resolved.default) })}
            </p>
          )}
        </BackendRow>
      )}
      {perType && (
        <NestedGroup
          label={localize('com_config_storage_per_type')}
          sectionId={`section-${PER_TYPE}`}
          configuredCount={perTypeCounts?.configured}
          totalCount={perTypeCounts?.total}
          revealPaths={[PER_TYPE]}
          description={localize('com_config_storage_per_type_desc')}
        >
          {STORAGE_FILE_TYPES.map((type) => (
            <BackendRow
              key={type}
              path={`${PER_TYPE}.${type}`}
              label={localize(`com_config_storage_type_${type}`)}
              description={localize(`com_config_storage_type_${type}_desc`)}
              fileType={type}
              inherited={inheritedOf(type)}
              inheritLabel={inheritLabel(type)}
              cloudFrontReady={cloudFrontReady}
              field={perType.fields.find((field) => field.key === type)}
              fieldProps={propsFor(perType)}
              onRequestChange={requestChange}
            />
          ))}
          <OtherSettings {...propsFor(perType)} placed={FILE_TYPES} />
        </NestedGroup>
      )}
      {cloudfront &&
        (showsCloudFront ? (
          <NestedGroup
            label={localize('com_config_section_cloudfront')}
            sectionId={`section-${CLOUDFRONT}`}
            configuredCount={counts[CLOUDFRONT]?.configured}
            totalCount={counts[CLOUDFRONT]?.total}
            defaultExpanded={cloudFrontInUse}
            revealPaths={[CLOUDFRONT]}
          >
            {cloudFrontInUse && !cloudFrontReady && (
              <p
                role="alert"
                className="m-0 mb-2 rounded-md bg-(--settings-danger-bg) px-3 py-2 text-xs text-(--settings-danger-fg)"
              >
                {localize('com_config_storage_cloudfront_not_ready')}
              </p>
            )}
            {renderSection(cloudfront)}
          </NestedGroup>
        ) : (
          <p
            id={`section-${CLOUDFRONT}`}
            className="m-0 py-3 text-xs text-(--cui-color-text-muted)"
          >
            {localize('com_config_storage_cloudfront_unused')}
          </p>
        ))}
      <StorageConfirm request={pending} onCancel={() => setPending(null)} />
    </ConfigSection>
  );
}
