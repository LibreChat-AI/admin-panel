/**
 * Test suite for Click UI ESLint rules
 * 
 * To run tests, you'll need to install:
 * npm install --save-dev @typescript-eslint/rule-tester
 * 
 * Then run: npm test
 */

const { RuleTester } = require('eslint');
const buttonRequiresLabel = require('../rules/button-requires-label');
const iconNameFormat = require('../rules/icon-name-format');
const logoNameFormat = require('../rules/logo-name-format');
const requireButtonHtmlType = require('../rules/require-button-html-type');

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
});

describe('Click UI ESLint Rules', () => {
  describe('button-requires-label', () => {
    ruleTester.run('button-requires-label', buttonRequiresLabel, {
      valid: [
        {
          code: '<Button label="Click me" />',
        },
        {
          code: '<Button label="Save" iconLeft="check" />',
        },
      ],
      invalid: [
        {
          code: '<Button>Click me</Button>',
          errors: [{ messageId: 'missingLabel' }],
        },
        {
          code: '<Button label="Save">Extra content</Button>',
          errors: [{ messageId: 'hasChildren' }],
        },
      ],
    });
  });

  describe('icon-name-format', () => {
    ruleTester.run('icon-name-format', iconNameFormat, {
      valid: [
        {
          code: '<Icon name="check-in-circle" />',
        },
        {
          code: '<Icon name="arrow-down" size="md" />',
        },
      ],
      invalid: [
        {
          code: '<Icon name="check_in_circle" />',
          errors: [{ messageId: 'wrongFormat' }],
        },
        {
          code: '<Icon name="checkInCircle" />',
          errors: [{ messageId: 'wrongFormat' }],
        },
      ],
    });
  });

  describe('logo-name-format', () => {
    ruleTester.run('logo-name-format', logoNameFormat, {
      valid: [
        {
          code: '<Logo name="digital_ocean" />',
        },
        {
          code: '<Logo name="aws_s3" />',
        },
      ],
      invalid: [
        {
          code: '<Logo name="digital-ocean" />',
          errors: [{ messageId: 'wrongFormat' }],
        },
        {
          code: '<Logo name="digitalOcean" />',
          errors: [{ messageId: 'wrongFormat' }],
        },
      ],
    });
  });
  describe('require-button-html-type', () => {
    ruleTester.run('require-button-html-type', requireButtonHtmlType, {
      valid: [
        {
          code: "import { Button } from '@clickhouse/click-ui';\n<Button htmlType=\"button\" label=\"Add\" />",
        },
        {
          code: "import { IconButton } from '@clickhouse/click-ui';\n<IconButton htmlType=\"button\" icon=\"trash\" />",
        },
        {
          code: "import { Button } from './local';\n<Button label=\"Not click-ui\" />",
        },
      ],
      invalid: [
        {
          code: "import { Button } from '@clickhouse/click-ui';\n<Button label=\"Add\" />",
          errors: [{ messageId: 'missingHtmlType' }],
        },
        {
          code: "import { IconButton as IB } from '@clickhouse/click-ui';\n<IB icon=\"trash\" />",
          errors: [{ messageId: 'missingHtmlType' }],
        },
      ],
    });
  });
});

module.exports = {
  ruleTester,
};
