import '@/locales/i18n';
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react';
import { otherServices, selectedServices, webSearchTocItems } from '../services';
import { WebSearchRenderer } from '../WebSearch';
import { renderSection } from './harness';

const YAML = {
  webSearch: {
    searchProvider: 'tavily',
    scraperProvider: 'tavily',
    tavilyApiKey: '${TAVILY_API_KEY}',
    rerankerType: 'cohere',
  },
};

const heading = (name: RegExp) => screen.getByRole('heading', { name });

describe('selectedServices', () => {
  it('shows a service selected for two roles once, with both roles and every setting it reads', () => {
    const views = selectedServices({
      providers: 'tavily',
      scrapers: 'tavily',
      rerankers: 'none',
    });
    expect(views).toHaveLength(1);
    expect(views[0].roles).toEqual(['providers', 'scrapers']);
    expect(views[0].credentials.map((credential) => credential.key)).toEqual([
      'tavilyApiKey',
      'tavilySearchUrl',
      'tavilyExtractUrl',
    ]);
    expect(views[0].optionKeys).toEqual(['tavilySearchOptions', 'tavilyScraperOptions']);
  });

  it("adds the settings of a used service's other roles to its view, without the role", () => {
    const [tavily] = selectedServices({ providers: 'tavily' });
    expect(tavily.roles).toEqual(['providers']);
    expect(tavily.credentials.map((credential) => credential.key)).toEqual([
      'tavilyApiKey',
      'tavilySearchUrl',
      'tavilyExtractUrl',
    ]);
    expect(tavily.optionKeys).toEqual(['tavilySearchOptions', 'tavilyScraperOptions']);
    expect(otherServices([tavily]).map((view) => view.value)).not.toContain('tavily');
  });

  it('lists every other service once for "Show other services"', () => {
    const others = otherServices(selectedServices({ providers: 'serper' }));
    expect(others.map((view) => view.value)).toEqual([
      'searxng',
      'tavily',
      'keenable',
      'firecrawl',
      'jina',
      'cohere',
    ]);
  });
});

describe('WebSearchRenderer', () => {
  it('shows only the selected services, credentials first, with where each comes from', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
    expect(heading(/^Tavily · search, page scraping/)).toBeInTheDocument();
    expect(heading(/^Cohere · reranking/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Serper/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Firecrawl API key')).not.toBeInTheDocument();
    expect(
      screen.getByText('Read from the TAVILY_API_KEY environment variable on the server.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not set here: LibreChat reads the COHERE_API_KEY environment variable on the server.',
      ),
    ).toBeInTheDocument();
  });

  it('says whether the environment variable each credential reads is set on the server (envStatus)', () => {
    const client = new QueryClient();
    client.setQueryData(['envStatus'], {
      TAVILY_API_KEY: { set: true, userProvided: false, sources: ['yaml'] },
      COHERE_API_KEY: { set: false, userProvided: false, sources: ['default'] },
      TAVILY_SEARCH_URL: { set: false, userProvided: false, sources: ['default'] },
    });
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      features: { envStatus: true },
      client,
    });
    expect(
      screen.getByText(
        'Read from the TAVILY_API_KEY environment variable, which is set on the server.',
      ),
    ).toBeInTheDocument();
    const cohere = screen.getByText(
      'Not set here: LibreChat reads the COHERE_API_KEY environment variable, which is not set on the server.',
    );
    expect(cohere.parentElement).toHaveClass('text-(--settings-warn-fg)');
    const searchUrl = screen.getByText(
      'Not set here: LibreChat reads the TAVILY_SEARCH_URL environment variable, which is not set on the server.',
    );
    expect(searchUrl.parentElement).toHaveClass('text-(--settings-muted-fg)');
    expect(
      screen.getByText(
        'Not set here: LibreChat reads the TAVILY_EXTRACT_URL environment variable on the server.',
      ),
    ).toBeInTheDocument();
  });

  it("warns that a reference outside the server's override allowlist leaves a needed key empty", () => {
    const client = new QueryClient();
    client.setQueryData(['envStatus'], {
      TAVILY_API_KEY: { set: true, userProvided: false, sources: ['yaml'] },
      PROFILE_TAVILY: { set: true, userProvided: false, sources: ['override'] },
    });
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      overrides: { webSearch: { tavilyApiKey: '${PROFILE_TAVILY}' } },
      features: { envStatus: true, envAllowlist: true },
      client,
    });
    const line = screen.getByText(
      "Read from the PROFILE_TAVILY environment variable, which is not in the server's allowlist for overrides, so the value is empty.",
    );
    expect(line.parentElement).toHaveClass('text-(--settings-warn-fg)');
  });

  it('names the environment variable only, on a server without env status', () => {
    const client = new QueryClient();
    client.setQueryData(['envStatus'], {
      TAVILY_API_KEY: { set: false, userProvided: false, sources: ['yaml'] },
    });
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML, client });
    expect(
      screen.getByText('Read from the TAVILY_API_KEY environment variable on the server.'),
    ).toBeInTheDocument();
  });

  it('keeps the other services behind "Show other services"', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
    fireEvent.click(screen.getByRole('button', { name: 'Show other services (5)' }));
    expect(heading(/^Serper/)).toBeInTheDocument();
    expect(heading(/^Firecrawl/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide other services' }));
    expect(screen.queryByRole('heading', { name: /^Firecrawl/ })).not.toBeInTheDocument();
  });

  it('keeps a service with only a pending setting under "Set values only"', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: { webSearch: { searchProvider: 'serper' } },
      edited: { 'webSearch.serperApiKey': 'sk-typed' },
      props: { showConfiguredOnly: true },
    });
    expect(heading(/^Serper/)).toBeInTheDocument();
  });

  it('masks a typed key and says it will be stored encrypted', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      features: { webSearchStoredKeys: true },
    });
    const key = screen.getByLabelText('Cohere API key');
    fireEvent.change(key, { target: { value: 'co-secret-1234567890' } });
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.blur(key);
    expect(screen.getByText('Will be stored encrypted when you save.')).toBeInTheDocument();
    expect(screen.queryByText(/environment variable references/)).not.toBeInTheDocument();
  });

  it('stores a Keenable key encrypted once the server keeps it in its secret registry', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: { webSearch: { searchProvider: 'keenable' } },
      features: { webSearchStoredKeys: true },
    });
    const key = screen.getByLabelText('Keenable API key');
    fireEvent.change(key, { target: { value: 'kn-secret-1234567890' } });
    fireEvent.blur(key);
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByText('Will be stored encrypted when you save.')).toBeInTheDocument();
    expect(screen.queryByText(/stored as typed|plain text/i)).not.toBeInTheDocument();
  });

  it('shows a stored key only as its masked preview, with Replace', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      overrides: { webSearch: { cohereApiKeyPreview: '...7890' } },
      features: { webSearchStoredKeys: true },
    });
    expect(screen.getByDisplayValue('...7890')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Replace/ })).toBeInTheDocument();
    expect(
      screen.getByText('Stored encrypted. Only the last characters are shown.'),
    ).toBeInTheDocument();
  });

  describe('on a server that reads web search values only from ${VAR} references', () => {
    const ENV_ONLY = /only from environment variable references such as \$\{COHERE_API_KEY\}/;

    it('warns that a typed key is ignored', () => {
      renderSection(WebSearchRenderer, { section: 'webSearch', yaml: YAML });
      const key = screen.getByLabelText('Cohere API key');
      fireEvent.change(key, { target: { value: 'co-secret-1234567890' } });
      fireEvent.blur(key);
      expect(screen.getByText(ENV_ONLY)).toBeInTheDocument();
      expect(screen.queryByText('Will be stored encrypted when you save.')).not.toBeInTheDocument();
    });

    it('warns that a stored key is ignored', () => {
      renderSection(WebSearchRenderer, {
        section: 'webSearch',
        yaml: YAML,
        overrides: { webSearch: { cohereApiKeyPreview: '...7890' } },
      });
      expect(screen.getByDisplayValue('...7890')).toBeDisabled();
      expect(screen.getByText(ENV_ONLY)).toBeInTheDocument();
    });

    it('does not warn about a ${VAR} reference', () => {
      renderSection(WebSearchRenderer, {
        section: 'webSearch',
        yaml: { webSearch: { ...YAML.webSearch, cohereApiKey: '${COHERE_API_KEY}' } },
      });
      expect(screen.queryByText(ENV_ONLY)).not.toBeInTheDocument();
    });
  });

  it('flags a required credential a selected service is missing', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: { webSearch: { searchProvider: 'serper', serperApiKey: '' } },
    });
    expect(screen.getByText(/Serper needs this\./)).toHaveTextContent('${SERPER_API_KEY}');
  });

  it('explains Automatic when a service is not chosen', () => {
    renderSection(WebSearchRenderer, { section: 'webSearch' });
    expect(screen.getByText(/^Automatic \(search, page scraping, reranking\)/)).toBeInTheDocument();
  });

  it('while the tab filter matches a service that is not selected, shows it', () => {
    renderSection(WebSearchRenderer, {
      section: 'webSearch',
      yaml: YAML,
      filter: ['webSearch.firecrawlApiKey'],
    });
    expect(screen.getByLabelText('Firecrawl API key')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Cohere/ })).not.toBeInTheDocument();
  });
});

describe('webSearchTocItems', () => {
  it('lists the services the section shows, not the ones behind "Show all services"', () => {
    const items = webSearchTocItems(
      {
        webSearch: { searchProvider: 'tavily', scraperProvider: 'tavily', rerankerType: 'cohere' },
      },
      'webSearch',
      (key) => key,
    );
    expect(items.map((item) => item.id)).toEqual([
      'section-webSearch-service-tavily',
      'section-webSearch-service-cohere',
    ]);
  });
});
