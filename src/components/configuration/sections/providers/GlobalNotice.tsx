import { revealConfigPath } from '../../review/reveal';
import { DecorativeIcon } from '@/components/shared';
import { GLOBAL_PROVIDER_KEY } from '@/constants';
import { useLocalize } from '@/hooks';

const GLOBAL_TITLES_PATH = `endpoints.${GLOBAL_PROVIDER_KEY}.titleConvo`;

/**
 * D11 banner in a provider's Title generation group: while Global overrides
 * exist, LibreChat reads title settings only from them, so this provider's
 * are ignored. Links to the Global title settings.
 */
export function GlobalTitlesNotice() {
  const localize = useLocalize();
  return (
    <div className="settings-banner" role="note">
      <span className="settings-banner-icon">
        <DecorativeIcon name="info-in-circle" size="sm" />
      </span>
      <p className="settings-banner-text">
        {localize('com_config_providers_global_titles_banner')}{' '}
        <button
          type="button"
          className="provider-link"
          onClick={() => revealConfigPath(GLOBAL_TITLES_PATH)}
        >
          {localize('com_config_providers_global_titles_link')}
        </button>
      </p>
    </div>
  );
}
