import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ContentFiltersRenderer } from '../Filters';
import { renderSection } from './harness';
import '@/locales/i18n';

describe('ContentFiltersRenderer', () => {
  it('says nothing is filtered when librechat.yaml sets no filters, and where filters can apply', () => {
    renderSection(ContentFiltersRenderer, { section: 'filters' });
    expect(screen.getByText(/sets no content filters/)).toBeInTheDocument();
    expect(screen.getByText(/^Filters can be set for: Messages, Prompts/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('summarizes each filtered surface: action, fields scanned and patterns', () => {
    renderSection(ContentFiltersRenderer, {
      section: 'filters',
      yaml: {
        filters: {
          messages: {
            pii: {
              action: 'block',
              fields: ['text', 'quote'],
              starterPatterns: ['sk_prefix'],
              customPatterns: [{ id: 'ssn', label: 'US SSN', regex: '\\d{3}-\\d{2}-\\d{4}' }],
            },
            unattributedAssistantContent: 'inspect',
          },
          memories: { pii: { action: 'audit' } },
        },
      },
    });
    const list = screen.getByRole('list', { name: 'Filtered content' });
    const [messages, memories] = within(list).getAllByRole('listitem');
    expect(within(messages).getByText('Block')).toBeInTheDocument();
    expect(within(messages).getByText('Text, Quote')).toBeInTheDocument();
    expect(within(messages).getByText('sk- prefix; custom: US SSN')).toBeInTheDocument();
    expect(within(messages).getByText('Inspect')).toBeInTheDocument();
    expect(within(memories).getByText('Audit')).toBeInTheDocument();
    expect(within(memories).getByText('All fields')).toBeInTheDocument();
    expect(within(memories).getByText('All built-in patterns')).toBeInTheDocument();
    expect(screen.getByText(/^Not filtered: Prompts/)).not.toHaveTextContent('Memories');
  });

  it('names the Redact action, and an action a newer LibreChat adds by its own name', () => {
    renderSection(ContentFiltersRenderer, {
      section: 'filters',
      yaml: {
        filters: {
          messages: { pii: { action: 'redact', maxMatches: 64 } },
          memories: { pii: { action: 'quarantine' } },
        },
      },
    });
    const list = screen.getByRole('list', { name: 'Filtered content' });
    const [messages, memories] = within(list).getAllByRole('listitem');
    expect(within(messages).getByText('Redact')).toBeInTheDocument();
    expect(within(messages).queryByText('Block')).not.toBeInTheDocument();
    expect(within(memories).getByText('quarantine')).toBeInTheDocument();
    expect(screen.getByText(/Redact replaces each match with a placeholder/)).toBeInTheDocument();
  });

  it('reads an explicit empty starter list as no built-in patterns', () => {
    renderSection(ContentFiltersRenderer, {
      section: 'filters',
      yaml: { filters: { prompts: { pii: { starterPatterns: [] } } } },
    });
    expect(screen.getByText('No built-in patterns')).toBeInTheDocument();
    expect(screen.getByText('Block')).toBeInTheDocument();
  });
});
