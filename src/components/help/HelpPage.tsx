import { Icon } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';

const RESOURCES = [
  {
    titleKey: 'com_help_docs_title',
    descKey: 'com_help_docs_desc',
    icon: 'document',
    href: 'https://www.librechat.ai/docs',
  },
] as const;

export function HelpPage() {
  const localize = useLocalize();

  return (
    <div
      role="region"
      aria-label={localize('com_nav_help')}
      className="admin-content-page flex flex-1 flex-col gap-7 overflow-auto"
    >
      <section aria-label={localize('com_help_resources')}>
        <h3 className="aimo-label mb-3">{localize('com_help_resources')}</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {RESOURCES.map((resource) => (
            <a
              key={resource.titleKey}
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
              className="aimo-card aimo-card-link group flex items-start gap-4 px-5 py-4.5 no-underline"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-link"
              >
                <Icon name={resource.icon} width="18px" height="18px" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[17px] leading-snug font-semibold tracking-[-0.022em] text-ink">
                  {localize(resource.titleKey)}
                </span>
                <span className="text-sm text-muted">{localize(resource.descKey)}</span>
              </div>
              <span
                aria-hidden="true"
                className="mt-1 text-muted transition-colors group-hover:text-link"
              >
                ↗
              </span>
            </a>
          ))}
        </div>
      </section>

      <section aria-label={localize('com_help_support')} className="aimo-tile">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.022em] text-tile-title">
          {localize('com_help_support')}
        </h3>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex">
            <Icon name="question" size="sm" />
          </span>
          {localize('com_help_support_text')}
        </div>
      </section>
    </div>
  );
}
