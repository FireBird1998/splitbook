import { describe, expect, it } from 'vitest';
import { mcpResource } from './config';

describe('MCP deployment boundary', () => {
  it('stays unavailable until explicitly enabled', () => {
    expect(mcpResource({})).toBeNull();
  });
  it('supports separate staging and production MCP hostnames', () => {
    expect(
      mcpResource({
        MCP_ENABLED: 'true',
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://staging.splitbook.in',
        MCP_RESOURCE_URL: 'https://mcp.staging.splitbook.in/api/mcp',
      }),
    ).toBe('https://mcp.staging.splitbook.in/api/mcp');
    expect(
      mcpResource({
        MCP_ENABLED: 'true',
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://splitbook.in',
        MCP_RESOURCE_URL: 'https://mcp.splitbook.in/api/mcp',
      }),
    ).toBe('https://mcp.splitbook.in/api/mcp');
  });
  it.each([
    'http://mcp.splitbook.in/api/mcp',
    'https://mcp.splitbook.in/other',
    'https://mcp.splitbook.in/api/mcp?key=unsafe',
    'https://user@splitbook.in/api/mcp',
  ])('rejects an unsafe resource %s', (resource) => {
    expect(() =>
      mcpResource({
        MCP_ENABLED: 'true',
        NEXT_PUBLIC_APP_URL: 'https://splitbook.in',
        MCP_RESOURCE_URL: resource,
      }),
    ).toThrow();
  });
});
