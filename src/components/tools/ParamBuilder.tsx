import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button, Checkbox, Dropdown, RadioGroup, Select } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/**
 * 参数构建器（2.21.1）：工具参数（JSON Schema）与前端表单提示（form hints）
 * 的可视化双向编辑器。数据流：
 *
 *   ParamRow[] ⇄ serialize() ⇄ parametersJson + formJson（字符串，双向）
 *
 * - 可视化编辑即时序列化回 JSON（保存通道零改动）
 * - 外部 JSON 变化（打开对话框/JSON 模式手改）且与上次序列化输出不同时
 *   反向 parse
 * - round-trip 保真：properties/hints 的未知键原样保留（raw/rawHint）
 * - JSON 语法错误时锁定可视化（错误条 + 保持 JSON 模式）
 */

type ParamType = 'string' | 'number' | 'integer' | 'boolean' | 'array';
type ParamWidget =
  | ''
  | 'textarea'
  | 'multiselect'
  | 'date'
  | 'datetime'
  | 'file'
  | 'directory'
  | 'upload'
  | 'hidden';

interface ParamRow {
  name: string;
  type: ParamType;
  required: boolean;
  def: unknown;
  label: string;
  help: string;
  placeholder: string;
  widget: ParamWidget;
  enumValues: string[];
  choices: string[];
  /** choices_from.tool（UI 文本框只暴露 tool 名）；可选字段随 parse 保全。 */
  choicesFrom: string;
  choicesFromOpts: { value_field?: string; label_field?: string };
  /** 逗号分隔文本（UI）；序列化为契约要求的带点扩展名数组。 */
  accept: string;
  /** properties 上未被构建器覆盖的原始键（round-trip 保真）。 */
  raw: Record<string, unknown>;
  /** form.fields 上未被构建器覆盖的原始键。 */
  rawHint: Record<string, unknown>;
}

interface Manifest {
  parameters: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  form: {
    order?: string[];
    fields: Record<string, Record<string, unknown>>;
  };
}

const NAME_RE = /^[\w.-]+$/;
function inferWidget(hint: Record<string, unknown>): ParamWidget {
  return typeof hint.widget === 'string' ? (hint.widget as ParamWidget) : '';
}

/** choices_from 解析：契约形态是 {tool,...} 对象（value_field/label_field 随行
 * 保全）；旧版构建器曾产出纯字符串——一律救援为 tool 名，round-trip 后升格为
 * 合法对象。opts 由调用方传入并被就地填充。 */
function choicesFromOf(
  hint: Record<string, unknown>,
  opts: { value_field?: string; label_field?: string },
): string {
  const cf = hint.choices_from;
  if (typeof cf === 'string') {
    return cf;
  }
  if (cf && typeof cf === 'object') {
    const rec = cf as Record<string, unknown>;
    if (typeof rec.value_field === 'string') {
      opts.value_field = rec.value_field;
    }
    if (typeof rec.label_field === 'string') {
      opts.label_field = rec.label_field;
    }
    return typeof rec.tool === 'string' ? rec.tool : '';
  }
  return '';
}

export function parseManifest(pJson: string, fJson: string): { rows: ParamRow[]; error: string | null } {
  try {
    const p = JSON.parse(pJson || '{}') as Manifest['parameters'];
    const f = (JSON.parse(fJson || '{}') || {}) as Partial<Manifest['form']>;
    const props = p.properties ?? {};
    const hints = f.fields ?? {};
    const declared = Array.isArray(f.order) ? f.order : [];
    const names = [...declared, ...Object.keys(props).filter((n) => !declared.includes(n))];
    const required = new Set(p.required ?? []);
    const rows: ParamRow[] = names
      .filter((n) => props[n] || hints[n]?.widget === 'upload')
      .map((name) => {
        const prop = { ...((props[name] as Record<string, unknown> | undefined) ?? {}) };
        const hint = { ...((hints[name] as Record<string, unknown> | undefined) ?? {}) };
        const choicesFromOpts: { value_field?: string; label_field?: string } = {};
        const type = (
          typeof prop.type === 'string' && prop.type !== 'object' ? prop.type : 'string'
        ) as ParamType;
        return {
          name,
          type,
          required: required.has(name),
          def: prop.default,
          label: typeof hint.label === 'string' ? hint.label : '',
          help: typeof hint.help === 'string' ? hint.help : '',
          placeholder: typeof hint.placeholder === 'string' ? hint.placeholder : '',
          widget: inferWidget(hint),
          enumValues: Array.isArray(prop.enum) ? (prop.enum as string[]).map(String) : [],
          choices: Array.isArray(hint.choices) ? (hint.choices as string[]).map(String) : [],
          choicesFrom: choicesFromOf(hint, choicesFromOpts),
          accept: Array.isArray(hint.accept)
            ? (hint.accept as unknown[]).map(String).join(', ')
            : '',
          choicesFromOpts,
          raw: prop,
          rawHint: hint,
        };
      });
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: String((e as Error).message).slice(0, 160) };
  }
}

export function serialize(rows: ParamRow[]): { parametersJson: string; formJson: string } {
  const properties: Record<string, Record<string, unknown>> = {};
  const fields: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];
  const required: string[] = [];
  for (const r of rows) {
    order.push(r.name);
    if (r.required) {
      required.push(r.name);
    }
    if (r.widget !== 'upload') {
      const prop: Record<string, unknown> = { ...r.raw, type: r.type };
      if (r.enumValues.length > 0 && r.type === 'string') {
        prop.enum = r.enumValues;
      } else {
        delete prop.enum;
      }
      if (r.def !== undefined && r.def !== '') {
        prop.default = r.def;
      } else {
        delete prop.default;
      }
      properties[r.name] = prop;
    }
    const hint: Record<string, unknown> = { ...r.rawHint };
    if (r.widget) {
      hint.widget = r.widget;
    } else {
      delete hint.widget;
    }
    const setText = (key: string, value: string) => {
      if (value) {
        hint[key] = value;
      } else {
        delete hint[key];
      }
    };
    setText('label', r.label);
    setText('help', r.help);
    setText('placeholder', r.placeholder);
    /* accept：契约要求数组且每项带前导点（tool-manifest.schema.json ^\.[A-Za-z0-9_-]+$） */
    const exts = r.accept
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('.') ? s : `.${s}`));
    if (exts.length > 0) {
      hint.accept = exts;
    } else {
      delete hint.accept;
    }
    /* choices_from：契约要求对象（additionalProperties=false，缺省字段不写） */
    const tool = r.choicesFrom.trim();
    if (tool) {
      hint.choices_from = { tool, ...r.choicesFromOpts };
    } else {
      delete hint.choices_from;
    }
    if (r.choices.length > 0) {
      hint.choices = r.choices;
    } else {
      delete hint.choices;
    }
    fields[r.name] = hint;
  }
  const manifest: Manifest = {
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    form: { fields, ...(order.length ? { order } : {}) },
  };
  return {
    parametersJson: JSON.stringify(manifest.parameters, null, 2),
    formJson: JSON.stringify(manifest.form, null, 2),
  };
}

/** 默认值按类型强转（数字/整数转数值，空串为未设置）。 */
function coerceDefault(raw: string, type: ParamType): unknown {
  if (type === 'number' || type === 'integer') {
    return raw === '' ? undefined : Number(raw);
  }
  return raw;
}

/** 卡片折叠态类型徽章文案（locale key）。 */
const TYPE_LABEL: Record<ParamType, string> = {
  string: 'com_param_type_string',
  number: 'com_param_type_number',
  integer: 'com_param_type_integer',
  boolean: 'com_param_type_boolean',
  array: 'com_param_type_array',
};

interface AddPreset {
  key: string;
  label: string;
  make: () => Pick<ParamRow, 'type' | 'widget'> & Partial<ParamRow>;
}

export function ParamBuilder({
  parametersJson,
  formJson,
  onChange,
}: {
  parametersJson: string;
  formJson: string;
  onChange: (parametersJson: string, formJson: string) => void;
}) {
  const localize = useLocalize();
  const lastEmitted = useRef<{ p: string; f: string } | null>(null);
  const [rows, setRows] = useState<ParamRow[]>([]);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  /* 外部 JSON → 行（仅在與上次输出不同时 parse：打开对话框 / JSON 模式手改） */
  useEffect(() => {
    const same =
      lastEmitted.current &&
      lastEmitted.current.p === parametersJson &&
      lastEmitted.current.f === formJson;
    if (same) {
      return;
    }
    const { rows: parsed, error } = parseManifest(parametersJson, formJson);
    if (!error) {
      setRows(parsed);
      setJsonError(null);
    } else {
      setJsonError(error);
      setMode('json');
    }
  }, [parametersJson, formJson]);

  const emit = (next: ParamRow[]) => {
    setRows(next);
    const out = serialize(next);
    lastEmitted.current = { p: out.parametersJson, f: out.formJson };
    onChange(out.parametersJson, out.formJson);
  };

  const patchRow = (index: number, patch: Partial<ParamRow>) => {
    emit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const uniqueName = (base: string) => {
    let n = base;
    let i = 2;
    while (rows.some((r) => r.name === n)) {
      n = `${base}${i}`;
      i += 1;
    }
    return n;
  };

  const ADD_PRESETS: AddPreset[] = useMemo(
    () => [
      {
        key: 'string',
        label: localize('com_param_add_string'),
        make: () => ({ type: 'string', widget: '' }),
      },
      {
        key: 'number',
        label: localize('com_param_add_number'),
        make: () => ({ type: 'number', widget: '' }),
      },
      {
        key: 'integer',
        label: localize('com_param_add_integer'),
        make: () => ({ type: 'integer', widget: '' }),
      },
      {
        key: 'boolean',
        label: localize('com_param_add_boolean'),
        make: () => ({ type: 'boolean', widget: '' }),
      },
      {
        key: 'array',
        label: localize('com_param_add_array_multiselect'),
        make: () => ({ type: 'array', widget: 'multiselect', choices: [] }),
      },
      {
        key: 'textarea',
        label: localize('com_param_add_textarea'),
        make: () => ({ type: 'string', widget: 'textarea' }),
      },
      {
        key: 'date',
        label: localize('com_param_add_date'),
        make: () => ({ type: 'string', widget: 'date' }),
      },
      {
        key: 'datetime',
        label: localize('com_param_add_datetime'),
        make: () => ({ type: 'string', widget: 'datetime' }),
      },
      {
        key: 'file',
        label: localize('com_param_add_file'),
        make: () => ({ type: 'string', widget: 'file' }),
      },
      {
        key: 'directory',
        label: localize('com_param_add_directory'),
        make: () => ({ type: 'string', widget: 'directory' }),
      },
      {
        key: 'upload',
        label: localize('com_param_add_upload'),
        make: () => ({ type: 'string', widget: 'upload', required: true }),
      },
      {
        key: 'hidden',
        label: localize('com_param_add_hidden'),
        make: () => ({ type: 'string', widget: 'hidden' }),
      },
    ],
    [],
  );

  const addParam = (preset: AddPreset) => {
    const name = uniqueName('param');
    const row: ParamRow = {
      name,
      def: undefined,
      label: '',
      help: '',
      placeholder: '',
      enumValues: [],
      choicesFrom: '',
      choicesFromOpts: {},
      accept: '',
      raw: {},
      rawHint: {},
      required: false,
      ...preset.make(),
    };
    setExpanded((prev) => new Set(prev).add(rows.length));
    emit([...rows, row]);
  };

  const removeRow = (index: number) => {
    emit(rows.filter((_, i) => i !== index));
  };

  const renameRow = (index: number, name: string) => {
    emit(rows.map((r, i) => (i === index ? { ...r, name } : r)));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || to === from) {
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emit(next);
  };

  /* 拖拽重排（Pointer 捕获，同图层树把手） */
  const dragFrom = useRef<number | null>(null);
  const onDragPointerDown = (e: React.PointerEvent<HTMLElement>, index: number) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = index;
  };
  const onDragPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (dragFrom.current === null) {
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-param-index]');
    if (target) {
      const to = Number((target as HTMLElement).dataset.paramIndex);
      if (!Number.isNaN(to) && to !== dragFrom.current) {
        move(dragFrom.current, to);
        dragFrom.current = to;
      }
    }
  };
  const onDragPointerUp = () => {
    dragFrom.current = null;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 工具条：模式切换 + 添加参数 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border border-(--cui-color-stroke-default) p-0.5 text-xs">
          {(['visual', 'json'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={cn(
                'rounded px-2.5 py-1 transition-colors',
                mode === m
                  ? 'bg-(--cui-color-background-hover) font-medium text-(--cui-color-text-default)'
                  : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
              )}
              onClick={() => setMode(m)}
            >
              {m === 'visual' ? localize('com_param_mode_visual') : localize('com_param_mode_json')}
            </button>
          ))}
        </div>
        <div>
          <Dropdown>
            <Dropdown.Trigger asChild>
              <Button
                variant="secondary"
                size="sm"
                label={localize('com_param_add')}
                disabled={mode !== 'visual' || jsonError !== null}
              />
            </Dropdown.Trigger>
            <Dropdown.Content className="param-add-menu">
              {ADD_PRESETS.map((preset) => (
                <Dropdown.Item key={preset.key} onSelect={() => addParam(preset)}>
                  {preset.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown>
        </div>
      </div>

      {jsonError && (
        <p className="rounded-md border border-(--cui-color-text-danger) px-2 py-1 text-xs text-(--cui-color-text-danger)">
          {localize('com_param_json_error')}: {jsonError}
        </p>
      )}

      {mode === 'json' ? (
        <div className="flex flex-col gap-2">
          <textarea
            id="tool-parameters"
            className="config-input-mono config-input min-h-40 w-full resize-y font-mono text-xs"
            spellCheck={false}
            value={parametersJson}
            onChange={(e) => {
              setMode('json');
              lastEmitted.current = null;
              onChange(e.target.value, formJson);
            }}
          />
          <textarea
            id="tool-form"
            className="config-input-mono config-input min-h-32 w-full resize-y font-mono text-xs"
            spellCheck={false}
            value={formJson}
            onChange={(e) => {
              lastEmitted.current = null;
              onChange(parametersJson, e.target.value);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const open = expanded.has(index);
            const nameBad =
              !NAME_RE.test(row.name) || rows.some((r, i) => i !== index && r.name === row.name);
            return (
              <div
                key={`${row.name}:${index}`}
                data-param-index={index}
                className={cn(
                  'rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-primary) text-sm',
                  nameBad && 'border-(--cui-color-text-danger)',
                )}
              >
                {/* 折叠态行头 */}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span
                    className="cursor-grab touch-none px-0.5 text-(--cui-color-text-muted) select-none active:cursor-grabbing"
                    onPointerDown={(e) =>
                      onDragPointerDown(e as ReactPointerEvent<HTMLElement>, index)
                    }
                    onPointerMove={onDragPointerMove}
                    onPointerUp={onDragPointerUp}
                    aria-hidden="true"
                  >
                    ⠿
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-start font-medium"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(index)) {
                          next.delete(index);
                        } else {
                          next.add(index);
                        }
                        return next;
                      })
                    }
                  >
                    {open ? '▾' : '▸'} {row.name}
                    <span className="ms-2 text-xs font-normal text-(--cui-color-text-muted)">
                      {localize(TYPE_LABEL[row.type])}
                      {row.widget ? ` · ${row.widget}` : ''}
                    </span>
                  </button>
                  <Checkbox
                    className="shrink-0"
                    checked={row.required}
                    onCheckedChange={(v) => patchRow(index, { required: v === true })}
                    label={localize('com_param_required')}
                  />
                  <button
                    type="button"
                    className="rounded p-0.5 text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-danger)"
                    aria-label={localize('com_ui_delete')}
                    onClick={() => removeRow(index)}
                  >
                    ✕
                  </button>
                </div>
                {/* 展开态字段 */}
                {open && (
                  <div className="flex flex-col gap-2 border-t border-(--cui-color-stroke-default) px-3 py-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_name')}
                        </span>
                        <input
                          className={cn(
                            'config-input h-7 px-2',
                            nameBad && 'border-(--cui-color-text-danger)',
                          )}
                          value={row.name}
                          onChange={(e) => renameRow(index, e.target.value)}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_type')}
                        </span>
                        <Select
                          value={row.type}
                          onSelect={(v) => patchRow(index, { type: v as ParamType })}
                          disabled={row.widget === 'upload'}
                        >
                          {(Object.keys(TYPE_LABEL) as ParamType[]).map((t) => (
                            <Select.Item key={t} value={t}>
                              {localize(TYPE_LABEL[t])}
                            </Select.Item>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_label')}
                        </span>
                        <input
                          className="config-input h-7 px-2"
                          value={row.label}
                          onChange={(e) => patchRow(index, { label: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_placeholder')}
                        </span>
                        <input
                          className="config-input h-7 px-2"
                          value={row.placeholder}
                          onChange={(e) => patchRow(index, { placeholder: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_help')}
                        </span>
                        <input
                          className="config-input h-7 px-2"
                          value={row.help}
                          onChange={(e) => patchRow(index, { help: e.target.value })}
                        />
                      </label>
                      {row.type !== 'boolean' && row.type !== 'array' && (
                        <label className="flex flex-col gap-1">
                          <span className="text-(--cui-color-text-muted)">
                            {localize('com_param_field_default')}
                          </span>
                          <input
                            className="config-input h-7 px-2"
                            value={String(row.def ?? '')}
                            onChange={(e) =>
                              patchRow(index, {
                                def: coerceDefault(e.target.value, row.type),
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                    {/* 控件类型（字符串类） */}
                    {row.type === 'string' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_widget')}
                        </span>
                        <Select
                          value={row.widget || ''}
                          onSelect={(v) => patchRow(index, { widget: (v || '') as ParamWidget })}
                        >
                          <Select.Item value="">{localize('com_param_widget_auto')}</Select.Item>
                          <Select.Item value="textarea">
                            {localize('com_param_widget_textarea')}
                          </Select.Item>
                          <Select.Item value="date">
                            {localize('com_param_widget_date')}
                          </Select.Item>
                          <Select.Item value="datetime">
                            {localize('com_param_widget_datetime')}
                          </Select.Item>
                          <Select.Item value="file">
                            {localize('com_param_widget_file')}
                          </Select.Item>
                          <Select.Item value="directory">
                            {localize('com_param_widget_directory')}
                          </Select.Item>
                          <Select.Item value="upload">
                            {localize('com_param_widget_upload')}
                          </Select.Item>
                          <Select.Item value="hidden">
                            {localize('com_param_widget_hidden')}
                          </Select.Item>
                        </Select>
                      </label>
                    )}
                    {row.widget === 'file' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_field_accept')}
                        </span>
                        <input
                          className="config-input h-7 px-2"
                          placeholder=".csv,.xlsx"
                          value={row.accept}
                          onChange={(e) => patchRow(index, { accept: e.target.value })}
                        />
                      </label>
                    )}
                    {/* 枚举（字符串 + 选项列表） */}
                    {row.type === 'string' && row.enumValues.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_enum')}
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          {row.enumValues.map((v, ei) => (
                            <span
                              key={`${v}:${ei}`}
                              className="flex items-center gap-1 rounded border border-(--cui-color-stroke-default) px-1.5 py-0.5"
                            >
                              {v}
                              <button
                                type="button"
                                className="text-(--cui-color-text-muted) hover:text-(--cui-color-text-danger)"
                                onClick={() =>
                                  patchRow(index, {
                                    enumValues: row.enumValues.filter((_, x) => x !== ei),
                                  })
                                }
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 数组：静态选项或动态来源 */}
                    {row.type === 'array' && (
                      <div className="flex flex-col gap-1">
                        <span className="text-(--cui-color-text-muted)">
                          {localize('com_param_choices')}
                        </span>
                        <RadioGroup
                          inline
                          value={row.choicesFrom ? 'from' : 'static'}
                          onValueChange={(v) =>
                            patchRow(index, {
                              choicesFrom: v === 'from' ? row.choicesFrom : '',
                            })
                          }
                        >
                          <RadioGroup.Item
                            value="static"
                            label={localize('com_param_choices_static')}
                          />
                          <RadioGroup.Item
                            value="from"
                            label={localize('com_param_choices_from')}
                          />
                        </RadioGroup>
                        {!row.choicesFrom && (
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-1">
                              {row.choices.map((c, ci) => (
                                <span
                                  key={`${c}:${ci}`}
                                  className="flex items-center gap-1 rounded border border-(--cui-color-stroke-default) px-1.5 py-0.5"
                                >
                                  {c}
                                  <button
                                    type="button"
                                    className="text-(--cui-color-text-muted) hover:text-(--cui-color-text-danger)"
                                    onClick={() =>
                                      patchRow(index, {
                                        choices: row.choices.filter((_, x) => x !== ci),
                                      })
                                    }
                                  >
                                    ✕
                                  </button>
                                </span>
                              ))}
                              <button
                                type="button"
                                className="rounded border border-(--cui-color-stroke-default) px-1.5 py-0.5 hover:bg-(--cui-color-background-hover)"
                                onClick={() => patchRow(index, { choices: [...row.choices, ''] })}
                              >
                                {localize('com_param_enum_add')}
                              </button>
                            </div>
                            <div className="flex flex-col gap-1">
                              {row.choices.map((c, ci) => (
                                <input
                                  key={`edit:${ci}`}
                                  className="config-input h-7 px-2"
                                  value={c}
                                  placeholder={`${localize('com_param_choices')} ${ci + 1}`}
                                  onChange={(e) =>
                                    patchRow(index, {
                                      choices: row.choices.map((x, xi) =>
                                        xi === ci ? e.target.value : x,
                                      ),
                                    })
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {row.choicesFrom !== '' && (
                          <input
                            className="config-input h-7 px-2"
                            value={row.choicesFrom}
                            placeholder={localize('com_param_choices_from_hint')}
                            onChange={(e) => patchRow(index, { choicesFrom: e.target.value })}
                          />
                        )}
                      </div>
                    )}
                    {nameBad && (
                      <p className="text-(--cui-color-text-danger)">
                        {localize('com_param_name_invalid')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-(--cui-color-stroke-default) p-4 text-center text-xs text-(--cui-color-text-muted)">
              {localize('com_param_empty')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
