import { describe, expect, it } from 'vitest';
import { buildOAuthExchangePayload } from './oauth';

describe('buildOAuthExchangePayload', () => {
  it('includes the stored PKCE verifier in the exchange body', () => {
    const result = buildOAuthExchangePayload('a'.repeat(64), 'verifier-123');

    expect(result).toBe(JSON.stringify({ code: 'a'.repeat(64), code_verifier: 'verifier-123' }));
  });

  it('builds no body instead of omitting an undefined verifier', () => {
    expect(buildOAuthExchangePayload('a'.repeat(64), undefined)).toBeUndefined();
  });

  it('rejects an empty verifier because LibreChat will enforce the stored challenge', () => {
    expect(buildOAuthExchangePayload('a'.repeat(64), '')).toBeUndefined();
  });
});
