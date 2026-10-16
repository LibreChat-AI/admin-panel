/**
 * Rule: no-bare-icon-in-interactive
 * Disallows a click-ui `Icon` directly inside a button, link, tab or other
 * interactive element.
 *
 * click-ui renders every icon as `<svg role="img" aria-label={name}>`, so the
 * icon's name leaks into the accessible name of the control around it
 * ("chevron-right Expand all", or just "cross"). Use `DecorativeIcon`, or hide
 * the icon with an `aria-hidden` wrapper.
 */

const CLICK_UI_SOURCE = '@clickhouse/click-ui';
const INTERACTIVE_ELEMENTS = new Set(['button', 'a', 'summary', 'Link']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'checkbox',
  'radio',
  'treeitem',
]);

function attribute(node, name) {
  return node.openingElement.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name && attr.name.name === name,
  );
}

function staticValue(attr) {
  if (!attr || !attr.value) return attr ? true : undefined;
  if (attr.value.type === 'Literal') return attr.value.value;
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type === 'Literal') {
    return attr.value.expression.value;
  }
  return undefined;
}

function elementName(node) {
  const name = node.openingElement.name;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return name.property.name;
  return '';
}

function isHidden(node) {
  const value = staticValue(attribute(node, 'aria-hidden'));
  return value === true || value === 'true';
}

function isInteractive(node) {
  if (INTERACTIVE_ELEMENTS.has(elementName(node))) return true;
  const role = staticValue(attribute(node, 'role'));
  return typeof role === 'string' && INTERACTIVE_ROLES.has(role);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a click-ui Icon inside an interactive element unless it is hidden from assistive technology',
      category: 'Accessibility',
      recommended: true,
    },
    messages: {
      bareIcon:
        'click-ui Icon announces its name ("{{icon}}") inside this {{parent}}; use DecorativeIcon or wrap it in aria-hidden.',
    },
    schema: [],
  },

  create(context) {
    const localNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== CLICK_UI_SOURCE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Icon') {
            localNames.add(specifier.local.name);
          }
        }
      },
      JSXElement(node) {
        const { name } = node.openingElement;
        if (name.type !== 'JSXIdentifier' || !localNames.has(name.name)) return;
        if (isHidden(node)) return;
        let parent = node.parent;
        while (parent) {
          if (parent.type === 'JSXElement') {
            if (isHidden(parent)) return;
            if (isInteractive(parent)) {
              const icon = staticValue(attribute(node, 'name'));
              context.report({
                node,
                messageId: 'bareIcon',
                data: {
                  icon: typeof icon === 'string' ? icon : 'icon',
                  parent: elementName(parent),
                },
              });
              return;
            }
          }
          parent = parent.parent;
        }
      },
    };
  },
};
