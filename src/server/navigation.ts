import { createServerFn } from '@tanstack/react-start';
import { getApiBaseUrl } from './utils/url';

function configuredHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function resolveNavigationUrls(gatewayValue?: string, chatValue?: string) {
  const gatewayUrl = configuredHttpUrl(gatewayValue);
  const libreChatUrl = configuredHttpUrl(chatValue);
  return {
    gatewayUrl,
    governanceAdminUrl: gatewayUrl && `${gatewayUrl}/admin`,
    chatUrl: gatewayUrl
      ? `${gatewayUrl}/api/auth/open-chat`
      : libreChatUrl && `${libreChatUrl}/c/new`,
  };
}

export const getNavigationUrlsFn = createServerFn({ method: 'GET' }).handler(() =>
  resolveNavigationUrls(
    process.env.WEB_PUBLIC_URL,
    process.env.LIBRECHAT_PUBLIC_URL || getApiBaseUrl(),
  ),
);
