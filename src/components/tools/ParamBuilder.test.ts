import { describe, expect, it } from 'vitest';
import { parseManifest, serialize } from './ParamBuilder';

/* ParamBuilder 双向序列化契约：parse ⇄ serialize 必须保真，且输出符合
 * manifest v1（accept=带点扩展名数组、choices_from={tool,...} 对象）。 */

const P = (properties: unknown) => JSON.stringify({ type: 'object', properties });
const F = (fields: unknown) => JSON.stringify({ fields });

describe('ParamBuilder serialize/parse round-trip', () => {
  it('preserves contract-shaped choices_from object and accept array', () => {
    const hint = {
      widget: 'file',
      label: '输入数据',
      accept: ['.gdb', '.shp'],
      choices_from: { tool: 'spatial.registry_layers', value_field: 'id', label_field: 'name' },
    };
    const { rows } = parseManifest(P({ src: { type: 'string' } }), F({ src: hint }));
    expect(rows).toHaveLength(1);
    expect(rows[0].choicesFrom).toBe('spatial.registry_layers');
    expect(rows[0].choicesFromOpts).toEqual({ value_field: 'id', label_field: 'name' });
    expect(rows[0].accept).toBe('.gdb, .shp');

    const out = JSON.parse(serialize(rows).formJson);
    expect(out.fields.src.choices_from).toEqual({
      tool: 'spatial.registry_layers',
      value_field: 'id',
      label_field: 'name',
    });
    expect(out.fields.src.accept).toEqual(['.gdb', '.shp']);
  });

  it('rescues legacy string choices_from into a contract-valid object', () => {
    const { rows } = parseManifest(
      P({ src: { type: 'string' } }),
      F({ src: { choices_from: 'spatial.registry_layers' } }),
    );
    const out = JSON.parse(serialize(rows).formJson);
    expect(out.fields.src.choices_from).toEqual({ tool: 'spatial.registry_layers' });
  });

  it('normalizes accept text input to dot-extension array (both separators)', () => {
    const { rows } = parseManifest(P({ f: { type: 'string' } }), F({ f: { widget: 'file' } }));
    const patched = rows.map((r) => ({ ...r, accept: 'gdb, .shp，csv' }));
    const out = JSON.parse(serialize(patched).formJson);
    expect(out.fields.f.accept).toEqual(['.gdb', '.shp', '.csv']);
  });

  it('drops empty accept/choices_from instead of writing contract-invalid empties', () => {
    const { rows } = parseManifest(P({ f: { type: 'string' } }), F({ f: {} }));
    const out = JSON.parse(serialize(rows).formJson);
    expect(out.fields.f).not.toHaveProperty('accept');
    expect(out.fields.f).not.toHaveProperty('choices_from');
  });

  it('keeps upload-only form fields (no properties entry) through round-trip', () => {
    const { rows } = parseManifest(
      JSON.stringify({ type: 'object', properties: {}, required: ['att'] }),
      JSON.stringify({ order: ['att'], fields: { att: { widget: 'upload' } } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].required).toBe(true);
    const out = serialize(rows);
    expect(JSON.parse(out.parametersJson).properties).toEqual({});
    expect(JSON.parse(out.formJson).fields.att.widget).toBe('upload');
  });
});
