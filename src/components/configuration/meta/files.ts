import { fileConfig } from 'librechat-data-provider';
import type * as t from '@/types';
import { STORAGE_BACKEND_LABELS, STORAGE_FILE_TYPES } from '@/constants';
import { DEFAULT_MIME_LISTS } from '@/utils';

const BYTES_PER_MB = 1024 * 1024;

/** MIME pattern lists, edited with the MIME list editor (FX-7). */
const MIME_LIST_PATHS = [
  'fileConfig.text.supportedMimeTypes',
  'fileConfig.ocr.supportedMimeTypes',
  'fileConfig.endpoints.{}.supportedMimeTypes',
];

function megabytes(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

function strategyMeta(): t.FieldMetaRegistry {
  const entries: t.FieldMetaRegistry = {
    fileStrategy: { enumLabels: STORAGE_BACKEND_LABELS, labelKey: 'com_config_storage_primary' },
    fileStrategies: { order: [...STORAGE_FILE_TYPES], labelKey: 'com_config_storage_per_type' },
  };
  for (const type of STORAGE_FILE_TYPES) {
    entries[`fileStrategies.${type}`] = {
      enumLabels: STORAGE_BACKEND_LABELS,
      labelKey: `com_config_storage_type_${type}`,
    };
  }
  return entries;
}

/**
 * Files & storage field metadata (WS14): storage backend names, runtime
 * defaults taken from LibreChat's own `fileConfig` (in MB, as librechat.yaml
 * takes them), the MIME list editor, and plain-language group names.
 */
export const FILES_FIELD_META: t.FieldMetaRegistry = {
  ...strategyMeta(),
  fileConfig: {
    order: [
      'serverFileSizeLimit',
      'avatarSizeLimit',
      'fileContextSizeLimit',
      'fileTokenLimit',
      'fileContextCharLimit',
      'legacyFileUploadUX',
      'textFallbackWithoutTools',
      'codeEnvLivenessSafeWindowMs',
      'endpoints',
      'text',
      'ocr',
      'defaultLLMDeliveryPath',
      'clientImageResize',
      'imageGeneration',
      'skills',
    ],
  },
  'fileConfig.serverFileSizeLimit': { runtimeDefault: megabytes(fileConfig.serverFileSizeLimit) },
  'fileConfig.avatarSizeLimit': { runtimeDefault: megabytes(fileConfig.avatarSizeLimit) },
  'fileConfig.fileContextSizeLimit': {
    runtimeDefault: megabytes(fileConfig.fileContextSizeLimit),
  },
  'fileConfig.fileTokenLimit': { runtimeDefault: fileConfig.fileTokenLimit },
  'fileConfig.fileContextCharLimit': { runtimeDefault: fileConfig.fileContextCharLimit },
  /** LibreChat's code file provisioning assumes 6 hours when unset (`staleSafeWindowMs`). */
  'fileConfig.codeEnvLivenessSafeWindowMs': { runtimeDefault: 6 * 60 * 60 * 1000 },
  'fileConfig.skills.fileSizeLimit': { runtimeDefault: megabytes(fileConfig.skills.fileSizeLimit) },
  'fileConfig.skills.importCleanupConcurrency': {
    runtimeDefault: fileConfig.skills.importCleanupConcurrency,
  },
  'fileConfig.clientImageResize.maxWidth': {
    runtimeDefault: fileConfig.clientImageResize.maxWidth,
  },
  'fileConfig.clientImageResize.maxHeight': {
    runtimeDefault: fileConfig.clientImageResize.maxHeight,
  },
  'fileConfig.clientImageResize.quality': { runtimeDefault: fileConfig.clientImageResize.quality },
  'fileConfig.text.supportedMimeTypes': { runtimeDefault: [...DEFAULT_MIME_LISTS.text] },
  'fileConfig.ocr.supportedMimeTypes': { runtimeDefault: [...DEFAULT_MIME_LISTS.ocr] },
  'fileConfig.endpoints.{}.disabled': { runtimeDefault: false },
  'fileConfig.endpoints': { labelKey: 'com_config_filelimits_title' },
  'fileConfig.endpoints.{}': {
    order: ['disabled', 'fileLimit', 'fileSizeLimit', 'totalSizeLimit'],
  },
  'fileConfig.text': { labelKey: 'com_config_mime_text_group' },
  'fileConfig.ocr': { labelKey: 'com_config_mime_ocr_group' },
  ...Object.fromEntries(
    MIME_LIST_PATHS.map((path): [string, t.FieldMeta] => [
      path,
      { control: 'mime-list', emptyListIsValue: true, width: 'L' },
    ]),
  ),
};
