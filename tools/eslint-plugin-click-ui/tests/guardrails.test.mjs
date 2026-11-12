/**
 * Guardrail rules (VS-12). Run with: node --test tools/eslint-plugin-click-ui/tests/
 */
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { RuleTester } from 'eslint';

const require = createRequire(import.meta.url);
const noBareIcon = require('../rules/no-bare-icon-in-interactive');
const noLegacyVariable = require('../rules/no-legacy-arbitrary-variable');
const requireButtonHtmlType = require('../rules/require-button-html-type');

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const ICON = "import { Icon } from '@clickhouse/click-ui';\n";

ruleTester.run('no-bare-icon-in-interactive', noBareIcon, {
  valid: [
    { code: `${ICON}<span className="x"><Icon name="info-in-circle" /> Note</span>` },
    {
      code: `${ICON}<button type="button"><span aria-hidden="true"><Icon name="trash" /></span></button>`,
    },
    { code: `${ICON}<button type="button"><Icon name="trash" aria-hidden="true" /></button>` },
    { code: `${ICON}<a href="/x"><span aria-hidden><Icon name="url" /></span>Docs</a>` },
    {
      code: 'import { DecorativeIcon } from \'@/components/shared\';\n<button type="button"><DecorativeIcon name="plus" />Add</button>',
    },
    {
      code: 'import { Icon } from \'./local\';\n<button type="button"><Icon name="plus" /></button>',
    },
  ],
  invalid: [
    {
      code: `${ICON}<button type="button"><Icon name="cross" /></button>`,
      errors: [{ messageId: 'bareIcon', data: { icon: 'cross', parent: 'button' } }],
    },
    {
      code: `${ICON}<div role="button" tabIndex={0}><span><Icon name="chevron-right" /></span>Title</div>`,
      errors: [{ messageId: 'bareIcon' }],
    },
    {
      code: `${ICON}<Link to="/access"><Icon name="lock" />Roles</Link>`,
      errors: [{ messageId: 'bareIcon' }],
    },
    {
      code: `import { Icon as I } from '@clickhouse/click-ui';\n<button type="button">{items.map((x) => <I key={x} name="plus" />)}</button>`,
      errors: [{ messageId: 'bareIcon' }],
    },
  ],
});

ruleTester.run('no-legacy-arbitrary-variable', noLegacyVariable, {
  valid: [
    { code: '<div className="border border-(--cui-color-stroke-default)" />' },
    { code: '<div className="w-[20%] text-[11px] max-w-[1040px]" />' },
    { code: 'const c = cn("bg-(--cui-color-background-panel)/90", ok && "hover:text-(--x)");' },
    { code: 'const css = "var(--cui-color-accent)";' },
  ],
  invalid: [
    {
      code: '<div className="rounded border border-[--click-control-border-color]" />',
      errors: [
        {
          messageId: 'legacyVariable',
          data: {
            legacy: 'border-[--click-control-border-color]',
            fixed: 'border-(--click-control-border-color)',
          },
        },
      ],
    },
    {
      code: 'const c = cn("px-2", "hover:bg-[--click-control-bg-hover]");',
      errors: [{ messageId: 'legacyVariable' }],
    },
    {
      code: 'const c = `text-xs ${x} text-[--click-text-secondary]`;',
      errors: [{ messageId: 'legacyVariable' }],
    },
  ],
});

ruleTester.run('require-button-html-type', requireButtonHtmlType, {
  valid: [
    {
      code: 'import { Button } from \'@clickhouse/click-ui\';\n<Button htmlType="button" label="Add" />',
    },
  ],
  invalid: [
    {
      code: 'import { Button } from \'@clickhouse/click-ui\';\n<Button label="Add" />',
      errors: [{ messageId: 'missingHtmlType' }],
    },
  ],
});
