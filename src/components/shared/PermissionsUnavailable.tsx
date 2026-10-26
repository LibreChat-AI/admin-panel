import { useLocalize } from '@/hooks';

export function PermissionsUnavailable() {
  const localize = useLocalize();
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-[21px] font-semibold text-ink">
        {localize('com_perm_unavailable_title')}
      </h2>
      <p className="max-w-md text-center text-sm text-muted">
        {localize('com_perm_unavailable_desc')}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="aimo-btn aimo-btn-outline mt-2"
      >
        {localize('com_ui_reload')}
      </button>
    </div>
  );
}
