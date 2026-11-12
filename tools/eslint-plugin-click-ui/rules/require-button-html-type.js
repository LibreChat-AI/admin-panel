/**
 * Rule: require-button-html-type
 * Requires an explicit `htmlType` on click-ui `Button` and `IconButton`.
 *
 * click-ui renders `<button type={htmlType}>`, and its `type` prop is the visual
 * variant. Without `htmlType` the browser defaults the element to
 * `type="submit"`, so inside a `<form>` pressing Enter in any input "clicks"
 * the first such button (for example a delete button).
 */

const BUTTON_COMPONENTS = new Set(['Button', 'IconButton']);
const CLICK_UI_SOURCE = '@clickhouse/click-ui';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an explicit htmlType on click-ui Button and IconButton',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingHtmlType:
        '{{name}} must set htmlType ("button" or "submit"); without it the element defaults to a submit button.',
    },
    schema: [],
  },

  create(context) {
    const localNames = new Map();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== CLICK_UI_SOURCE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported = specifier.imported.name;
          if (BUTTON_COMPONENTS.has(imported)) {
            localNames.set(specifier.local.name, imported);
          }
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const imported = localNames.get(node.name.name);
        if (!imported) return;
        const hasSpread = node.attributes.some((attr) => attr.type === 'JSXSpreadAttribute');
        if (hasSpread) return;
        const hasHtmlType = node.attributes.some(
          (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'htmlType',
        );
        if (hasHtmlType) return;
        context.report({ node, messageId: 'missingHtmlType', data: { name: imported } });
      },
    };
  },
};
