/**
 * Rule: no-legacy-arbitrary-variable
 * Disallows Tailwind v3 arbitrary-variable classes such as
 * `border-[--cui-color-stroke-default]`.
 *
 * Tailwind 4 reads `[--x]` as a literal value, not `var(--x)`, so the class
 * silently does nothing. Write `border-(--cui-color-stroke-default)` instead.
 */

const LEGACY = /(?:^|[\s"'`:])(?:[\w-]+:)*!?-?[\w-]+-\[--[\w-]+\]/;
const MATCH = /[\w-]+-\[(--[\w-]+)\]/;

function check(context, node, text) {
  if (typeof text !== 'string' || !LEGACY.test(text)) return;
  const match = text.match(MATCH);
  const legacy = match ? match[0] : '[--…]';
  const fixed = match ? legacy.replace(`[${match[1]}]`, `(${match[1]})`) : '(--…)';
  context.report({ node, messageId: 'legacyVariable', data: { legacy, fixed } });
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Tailwind v3 arbitrary-variable syntax `-[--var]`; use `-(--var)`',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      legacyVariable:
        '"{{legacy}}" is Tailwind v3 syntax and has no effect in Tailwind 4; use "{{fixed}}".',
    },
    schema: [],
  },

  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value && node.value.cooked);
      },
    };
  },
};
