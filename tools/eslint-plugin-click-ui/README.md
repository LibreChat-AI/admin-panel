# ESLint Plugin for Click UI

Comprehensive ESLint plugin for the Click UI Design System that enforces best practices and catches common mistakes when using `@clickhouse/click-ui`. Based on comprehensive analysis of the official Click UI documentation at clickhouse.design/click-ui.

## Installation

```bash
npm install --save-dev eslint-plugin-click-ui
# or
yarn add -D eslint-plugin-click-ui
```

## Usage

Add `click-ui` to the plugins section of your `.eslintrc` configuration file:

```json
{
  "plugins": ["click-ui"],
  "extends": ["plugin:click-ui/recommended"]
}
```

### Configuration Options

The plugin provides two preset configurations:

#### Recommended (Default)
Balanced configuration with errors for critical issues and warnings for suggestions:

```json
{
  "extends": ["plugin:click-ui/recommended"]
}
```

#### Strict
All rules as errors for maximum enforcement:

```json
{
  "extends": ["plugin:click-ui/strict"]
}
```

### Custom Configuration

You can also configure individual rules:

```json
{
  "plugins": ["click-ui"],
  "rules": {
    "click-ui/button-requires-label": "error",
    "click-ui/icon-name-format": "warn",
    "click-ui/valid-icon-name": "off"
  }
}
```

## Rules

### Setup Rules

#### `require-provider` (error)
Ensures `ClickUIProvider` wraps your application.

```tsx
// ❌ Bad
function App() {
  return <Button label="Click me" />;
}

// ✅ Good
import { ClickUIProvider } from '@clickhouse/click-ui';

function App() {
  return (
    <ClickUIProvider theme="dark">
      <Button label="Click me" />
    </ClickUIProvider>
  );
}
```

#### `require-css-import` (error)
Ensures the CSS file is imported.

```tsx
// ❌ Bad
import { Button } from '@clickhouse/click-ui';

// ✅ Good
import '@clickhouse/click-ui/cui.css';
import { Button } from '@clickhouse/click-ui';
```

---

### Component Usage Rules

#### `button-requires-label` (error)
Button component requires `label` prop instead of children.

```tsx
// ❌ Bad
<Button>Click me</Button>

// ✅ Good
<Button label="Click me" />
<Button label="Save" iconLeft="check" />
```

**Auto-fixable**: This rule can automatically fix simple cases.

#### `container-requires-orientation` (error)
Container component requires `orientation` prop.

```tsx
// ❌ Bad
<Container>
  <div>Content</div>
</Container>

// ✅ Good
<Container orientation="vertical">
  <div>Content</div>
</Container>
<Container orientation="horizontal" gap="md">
  <div>Left</div>
  <div>Right</div>
</Container>
```

#### `table-structure` (error)
Table component requires correct props structure.

```tsx
// ❌ Bad
<Table data={data} columns={columns} />

// ✅ Good
<Table
  headers={[
    { label: 'Name', isSortable: true },
    { label: 'Email' }
  ]}
  rows={[
    { id: 1, items: [{ label: 'John' }, { label: 'john@example.com' }] }
  ]}
/>
```

#### `dialog-controlled-state` (error)
Dialog must use controlled state.

```tsx
// ❌ Bad
<Dialog defaultOpen={true}>
  <Dialog.Content>...</Dialog.Content>
</Dialog>

// ✅ Good
const [open, setOpen] = useState(false);

<Dialog open={open} onOpenChange={setOpen}>
  <Dialog.Content>...</Dialog.Content>
</Dialog>
```

#### `form-controlled-components` (error)
Form components must be controlled.

```tsx
// ❌ Bad
<TextField label="Name" />

// ✅ Good
const [name, setName] = useState('');
<TextField 
  label="Name" 
  value={name} 
  onChange={(e) => setName(e.target.value)} 
/>
```

Applies to: `TextField`, `TextArea`, `NumberField`, `PasswordField`, `SearchField`

#### `select-requires-options` (error)
Select component requires all necessary props.

```tsx
// ❌ Bad
<Select label="Country" />

// ✅ Good
<Select
  label="Country"
  value={country}
  onSelect={setCountry}
  options={[
    { label: 'USA', value: 'us' },
    { label: 'UK', value: 'uk' }
  ]}
/>
```

#### `datepicker-controlled` (error)
DatePicker must use controlled state.

```tsx
// ❌ Bad
<DatePicker />

// ✅ Good
const [date, setDate] = useState<Date>();
<DatePicker date={date} onSelectDate={setDate} />
```

#### `switch-controlled-state` (error)
Switch component must use controlled state with `checked` and `onCheckedChange`.

```tsx
// ❌ Bad
<Switch onClick={handleClick} />
<Switch checked={checked} /> // Missing onCheckedChange

// ✅ Good
const [checked, setChecked] = useState(false);
<Switch checked={checked} onCheckedChange={setChecked} label="Enable" />
```

**Common mistake**: Using `onClick` instead of `onCheckedChange`.

#### `checkbox-radiogroup-controlled` (error)
Checkbox and RadioGroup must use controlled state.

```tsx
// ❌ Bad - Checkbox
<Checkbox label="Accept" />

// ✅ Good - Checkbox
const [accepted, setAccepted] = useState(false);
<Checkbox 
  label="Accept terms" 
  checked={accepted} 
  onCheckedChange={setAccepted} 
/>

// ❌ Bad - RadioGroup
<RadioGroup options={options} />

// ✅ Good - RadioGroup
const [value, setValue] = useState('option1');
<RadioGroup 
  value={value} 
  onValueChange={setValue} 
  options={options} 
/>
```

---

### Icon & Logo Rules

#### `icon-name-format` (error)
Icon names must use hyphens, not underscores or camelCase.

```tsx
// ❌ Bad
<Icon name="check_circle" />
<Icon name="checkCircle" />

// ✅ Good
<Icon name="check-in-circle" />
<Icon name="arrow-down" />
```

**Auto-fixable**: Automatically converts to correct format.

#### `logo-name-format` (error)
Logo names must use underscores, not hyphens or camelCase.

```tsx
// ❌ Bad
<Logo name="digital-ocean" />
<Logo name="digitalOcean" />

// ✅ Good
<Logo name="digital_ocean" />
<Logo name="aws_s3" />
```

**Auto-fixable**: Automatically converts to correct format.

#### `valid-icon-name` (warning)
Validates icon names against the library of 165 available icons.

```tsx
// ⚠️ Warning
<Icon name="nonexistent-icon" />
// Suggests: Did you mean "check-in-circle"?

// ✅ Good
<Icon name="check-in-circle" />
<Icon name="arrow-down" />
```

#### `valid-logo-name` (warning)
Validates logo names against the library of 58 available logos.

```tsx
// ⚠️ Warning
<Logo name="unknown_service" />
// Suggests: Did you mean "aws_s3"?

// ✅ Good
<Logo name="clickhouse" />
<Logo name="digital_ocean" />
```

---

### Type Validation Rules

#### `valid-theme-name` (error)
Validates theme values.

```tsx
// ❌ Bad
<ClickUIProvider theme="blue">

// ✅ Good
<ClickUIProvider theme="dark" />
<ClickUIProvider theme="light" />
<ClickUIProvider theme="classic" />
```

#### `valid-spacing-token` (warning)
Validates spacing token values.

```tsx
// ⚠️ Warning
<Container gap="large" />

// ✅ Good
<Container gap="lg" />
<Container padding="md" />
```

Valid tokens: `none`, `xxs`, `xs`, `sm`, `md`, `lg`, `xl`, `xxl`

#### `valid-icon-size` (warning)
Validates Icon size values.

```tsx
// ⚠️ Warning
<Icon name="check" size="medium" />

// ✅ Good
<Icon name="check" size="md" />
<Icon name="arrow-down" size="lg" />
```

Valid sizes: `xs`, `sm`, `md`, `lg`, `xl`, `xxl`

#### `valid-button-type` (warning)
Validates Button type values.

```tsx
// ⚠️ Warning
<Button label="Click" type="default" />

// ✅ Good
<Button label="Click" type="primary" />
<Button label="Delete" type="danger" />
```

Valid types: `primary`, `secondary`, `empty`, `danger`, `ghost`

#### `require-button-html-type` (error)
Requires an explicit `htmlType` on `Button` and `IconButton`. click-ui renders
`<button type={htmlType}>`, so without it the element defaults to a submit
button and pressing Enter inside a `<form>` clicks it.

```tsx
// ❌ Bad
<Button type="secondary" label="Add" onClick={add} />

// ✅ Good
<Button htmlType="button" type="secondary" label="Add" onClick={add} />
<Button htmlType="submit" type="primary" label="Save" />
```

#### `valid-title-type` (warning)
Validates Title component type values.

```tsx
// ⚠️ Warning
<Title type="heading1">Welcome</Title>

// ✅ Good
<Title type="h1">Welcome</Title>
<Title type="h2">Section Title</Title>
```

Valid types: `h1`, `h2`, `h3`, `h4`, `h5`, `h6`

#### `valid-provider-config` (warning)
Validates ClickUIProvider config prop structure.

```tsx
// ⚠️ Warning
<ClickUIProvider config="invalid" />

// ✅ Good
<ClickUIProvider 
  theme="dark"
  config={{
    tooltip: { delayDuration: 0 }
  }}
/>
```

---

### Best Practice Rules

#### `prefer-named-imports` (warning)
Prefer named imports for tree-shaking.

```tsx
// ⚠️ Warning
import ClickUI from '@clickhouse/click-ui';

// ✅ Good
import { Button, TextField, Dialog } from '@clickhouse/click-ui';
```

---

### Suggestion Rules

#### `avoid-generic-label` (off by default)
Suggests using Label instead of GenericLabel for form controls.

```tsx
// Suggestion
<GenericLabel>Username</GenericLabel>

// Consider
<Label>Username</Label>
```

**Note**: This rule is off by default. Enable it if you want stricter guidance.

---

## Rule Severity Levels

- **error**: Critical issues that will likely cause runtime errors or broken components
- **warning**: Best practice violations that should be addressed but won't break functionality

## Auto-fixable Rules

The following rules support automatic fixing with `eslint --fix`:

- `button-requires-label` - Converts children to label prop
- `icon-name-format` - Converts to hyphen format
- `logo-name-format` - Converts to underscore format

## Integration with IDEs

### VS Code

Install the ESLint extension and the linter will work automatically with your `.eslintrc` configuration.

### WebStorm/IntelliJ

ESLint is built-in and will automatically detect the plugin.

## Common Issues

### False Positives

If you have a valid reason to disable a rule for a specific line:

```tsx
// eslint-disable-next-line click-ui/button-requires-label
<Button>{dynamicContent}</Button>
```

Or for an entire file:

```tsx
/* eslint-disable click-ui/button-requires-label */
```

### Performance

The linter is designed to be fast and shouldn't significantly impact your build times. If you experience issues, you can disable specific rules that check large lists (like `valid-icon-name`).

## Resources

- [Click UI Documentation](https://clickhouse.design/click-ui)
- [Click UI AI Quick Reference](https://clickhouse.design/click-ui/ai-quick-reference)
- [Click UI GitHub](https://github.com/ClickHouse/click-ui)
- [ESLint Documentation](https://eslint.org/docs/latest/)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

Apache-2.0

## Changelog

### 1.1.0
- Added 5 new rules based on comprehensive documentation review
- Switch controlled state validation
- Checkbox and RadioGroup controlled state  
- Title type validation
- Provider config validation
- Generic vs Label guidance
- Total rules: **23** (up from 17)

### 1.0.0
- Initial release
- 17 comprehensive rules covering all major Click UI patterns
- Auto-fix support for common issues
- Icon and logo name validation with 165 icons and 58 logos
- TypeScript-friendly

---

**Made with ❤️ for the ClickHouse community**
