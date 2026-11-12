import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { specListIssues, validateSpecs, specEndpoint, problemsOf } from '../validation';
import { getKeyedCollection } from '@/utils';

const known = new Set([
  'openAI',
  'anthropic',
  'agents',
  'assistants',
  'azureAssistants',
  'Azure Foundry',
]);

function spec(name: string, extra: t.ConfigRecord = {}): t.ConfigRecord {
  return {
    name,
    label: name.toUpperCase(),
    preset: { endpoint: 'openAI', model: 'gpt-4o' },
    ...extra,
  };
}

function codes(problems: t.SpecProblem[]): string[] {
  return problems.map((problem) => `${problem.index}:${problem.field}:${problem.code}`);
}

describe('validateSpecs', () => {
  it('accepts a complete list', () => {
    expect(validateSpecs([spec('a'), spec('b')], { knownEndpoints: known })).toEqual([]);
  });

  it('requires a name, label, endpoint and model on every spec', () => {
    const problems = validateSpecs([{ preset: {} }, { name: ' ', label: 'X' }], {
      knownEndpoints: known,
    });
    expect(codes(problems)).toEqual([
      '0:name:required',
      '0:label:required',
      '0:preset.endpoint:required',
      '0:preset.model:required',
      '1:name:required',
      '1:preset.endpoint:required',
      '1:preset.model:required',
    ]);
  });

  it('asks an agent spec for its agent, not a model, and infers the agents endpoint', () => {
    const agent = { name: 'a', label: 'A', preset: { agent_id: 'agent_123' } };
    expect(specEndpoint(agent)).toBe('agents');
    expect(validateSpecs([agent], { knownEndpoints: known })).toEqual([]);
    const missing = { name: 'b', label: 'B', preset: { endpoint: 'agents' } };
    expect(codes(validateSpecs([missing], { knownEndpoints: known }))).toEqual([
      '0:preset.agent_id:required',
    ]);
  });

  it('asks an assistants spec for its assistant, not a model (LibreChat makes model optional)', () => {
    const assistant = {
      name: 'asst-spec',
      label: 'Support assistant',
      preset: { endpoint: 'assistants', assistant_id: 'asst_abc123' },
    };
    expect(validateSpecs([assistant], { knownEndpoints: known })).toEqual([]);
    const missing = { name: 'b', label: 'B', preset: { endpoint: 'azureAssistants' } };
    expect(codes(validateSpecs([missing], { knownEndpoints: known }))).toEqual([
      '0:preset.assistant_id:required',
    ]);
  });

  it('flags every spec after the first that repeats a name, a default or a soft default', () => {
    const items = [
      spec('a', { default: true, softDefault: true }),
      spec('a', { default: true }),
      spec('c', { softDefault: true }),
    ];
    const problems = validateSpecs(items, { knownEndpoints: known });
    expect(codes(problems)).toEqual([
      '1:name:spec_duplicate_name',
      '1:default:spec_multiple_default',
      '2:softDefault:spec_multiple_soft_default',
    ]);
    expect(problems[0].params).toEqual({ name: 'A', position: 1 });
  });

  it('warns, without blocking, about an endpoint the configuration does not define', () => {
    const items = [spec('a', { preset: { endpoint: 'Missing', model: 'm' } })];
    const problems = validateSpecs(items, { knownEndpoints: known });
    expect(problems).toEqual([
      {
        index: 0,
        field: 'preset.endpoint',
        code: 'spec_unknown_endpoint',
        level: 'warning',
        params: { endpoint: 'Missing' },
      },
    ]);
    expect(validateSpecs(items, { knownEndpoints: new Set() })).toEqual([]);
  });

  it('lists a spec’s errors before its warnings', () => {
    const items = [{ name: 'a', preset: { endpoint: 'Missing', model: 'm' } }];
    const problems = problemsOf(validateSpecs(items, { knownEndpoints: known }), 0);
    expect(problems.map((problem) => problem.level)).toEqual(['error', 'warning']);
  });
});

describe('specListIssues', () => {
  const collection = getKeyedCollection('modelSpecs.list')!;

  function changeSet(items: t.ConfigValue[]): t.ConfigChangeSet {
    return {
      ops: [],
      issues: [],
      payload: { touched: [], saves: [], resets: [], skipped: [] },
      collections: [{ collection, items, edit: { baseline: [], origins: [] } }],
    };
  }

  it('blocks Save on spec errors at their pending position, named by a unique spec name', () => {
    const issues = specListIssues(
      changeSet([spec('a'), spec('b', { label: '', default: true }), spec('c', { default: true })]),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        path: 'modelSpecs.list.1.label',
        code: 'required',
        entryIdentity: 'b',
        entryPath: 'label',
      }),
      expect.objectContaining({
        path: 'modelSpecs.list.2.default',
        code: 'spec_multiple_default',
        params: { name: 'b', position: 2 },
      }),
    ]);
  });

  it('blocks a blank name and names that differ only by surrounding spaces', () => {
    const issues = specListIssues(
      changeSet([spec('a'), spec('  ', { label: 'Blank' }), spec('b'), spec(' b ')]),
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['modelSpecs.list.1.name', 'required'],
      ['modelSpecs.list.3.name', 'spec_duplicate_name'],
    ]);
  });

  it('leaves names to the pipeline and ignores warnings and untouched lists', () => {
    expect(
      specListIssues(changeSet([{ label: 'X', preset: { endpoint: 'x', model: 'm' } }])),
    ).toEqual([]);
    expect(specListIssues(changeSet([spec('a'), spec('a')]))).toEqual([]);
    expect(specListIssues({ ...changeSet([]), collections: [] })).toEqual([]);
  });

  it('does not block an unrelated edit on a problem an untouched spec already had', () => {
    const legacy = { name: 'legacy', label: 'Legacy', preset: { endpoint: 'openAI' } };
    const second = spec('second');
    const renamed = { ...second, label: 'Second Spec renamed' };
    const origins = [
      { identity: 'legacy', baseline: legacy },
      { identity: 'second', baseline: second },
    ];
    const set = changeSet([legacy, renamed]);
    set.collections[0].edit = { baseline: [legacy, second], origins };
    expect(specListIssues(set)).toEqual([]);
    const touched = changeSet([{ ...legacy, label: 'Legacy 2' }, renamed]);
    touched.collections[0].edit = { baseline: [legacy, second], origins };
    expect(specListIssues(touched)).toEqual([
      expect.objectContaining({ path: 'modelSpecs.list.0.preset.model', code: 'required' }),
    ]);
  });
});
