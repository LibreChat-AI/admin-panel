import type * as t from '@/types';

/**
 * The storage backends `fileStrategy` and `fileStrategies` take, in the order
 * the panel offers them, with the environment variables LibreChat's server
 * reads to reach each one (packages/api/src/cdn). S3 and CloudFront accept
 * an IAM role instead of keys; Azure accepts a managed identity instead of a
 * connection string.
 */
export const STORAGE_BACKENDS: readonly t.StorageBackendInfo[] = [
  { backend: 'local', envVars: [] },
  {
    backend: 's3',
    envVars: ['AWS_REGION', 'AWS_BUCKET_NAME'],
    noteKey: 'com_config_storage_env_note_s3',
  },
  {
    backend: 'azure_blob',
    envVars: ['AZURE_STORAGE_CONNECTION_STRING'],
    noteKey: 'com_config_storage_env_note_azure_blob',
  },
  {
    backend: 'firebase',
    envVars: [
      'FIREBASE_API_KEY',
      'FIREBASE_AUTH_DOMAIN',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_STORAGE_BUCKET',
      'FIREBASE_MESSAGING_SENDER_ID',
      'FIREBASE_APP_ID',
    ],
  },
  {
    backend: 'cloudfront',
    envVars: ['AWS_REGION', 'AWS_BUCKET_NAME'],
    noteKey: 'com_config_storage_env_note_cloudfront',
  },
];

/** The storage backend LibreChat uses when nothing is set. */
export const DEFAULT_STORAGE_BACKEND: t.KnownStorageBackend = 'local';

/** `fileStrategies` keys in display order: the catch-all first, then each kind of file. */
export const STORAGE_FILE_TYPES: readonly t.StorageFileType[] = [
  'default',
  'avatar',
  'image',
  'document',
  'skills',
];

/** Storage backend → locale key of its proper name ("Amazon S3", "Local filesystem"). */
export const STORAGE_BACKEND_LABELS: Readonly<Record<t.KnownStorageBackend, string>> = {
  local: 'com_config_storage_backend_local',
  firebase: 'com_config_storage_backend_firebase',
  s3: 'com_config_storage_backend_s3',
  azure_blob: 'com_config_storage_backend_azure_blob',
  cloudfront: 'com_config_storage_backend_cloudfront',
};

/**
 * `fileConfig.endpoints` keys LibreChat looks up besides custom endpoint
 * names (`getEndpointFileConfig`): `default` applies to endpoints without an
 * entry, `custom` to custom endpoints without their own.
 */
export const FILE_ENDPOINT_KEYS: readonly string[] = [
  'default',
  'agents',
  'assistants',
  'azureAssistants',
  'openAI',
  'azureOpenAI',
  'anthropic',
  'google',
  'bedrock',
  'custom',
];
