import { Icon } from '@clickhouse/click-ui';
import { Link } from '@tanstack/react-router';
import { useLocalize } from '@/hooks';

export function AccessDenied() {
  const localize = useLocalize();

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-fill">
        <span aria-hidden="true" className="text-muted">
          <Icon name="lock" size="md" />
        </span>
      </div>
      <h2 className="text-[21px] font-semibold text-ink">{localize('com_access_denied_title')}</h2>
      <p className="max-w-md text-center text-sm text-muted">
        {localize('com_access_denied_description')}
      </p>
      <Link to="/" className="aimo-btn aimo-btn-outline mt-2">
        {localize('com_nav_go_home')}
      </Link>
    </div>
  );
}
