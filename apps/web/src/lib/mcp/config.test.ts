import { describe, expect, it, vi } from 'vitest';
import { mcpAuthPlugins } from './auth-plugin';
import { mcpIdleSeconds, mcpResource } from './config';

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

describe('MCP inactivity deployment boundary', () => {
  it('keeps production at 90 days even when a short test timeout is present', () => {
    expect(mcpIdleSeconds({})).toBe(7_776_000);
    expect(mcpIdleSeconds({ NODE_ENV: 'production', MCP_IDLE_TIMEOUT_SECONDS: '120' })).toBe(
      7_776_000,
    );
  });
  it('keeps staging at 90 days when no timeout is supplied', () => {
    expect(mcpIdleSeconds({ MCP_DEPLOYMENT: 'staging' })).toBe(7_776_000);
  });
  it('ignores copied staging overrides on the production mobile deployment', () => {
    for (const timeout of ['120', 'malformed']) {
      expect(
        mcpIdleSeconds({
          MOBILE_APP_ENV: 'production',
          MCP_DEPLOYMENT: 'staging',
          MCP_IDLE_TIMEOUT_SECONDS: timeout,
        }),
      ).toBe(7_776_000);
    }
  });
  it('fails closed and logs malformed staging configuration when auth initializes', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        mcpAuthPlugins({
          MCP_ENABLED: 'true',
          NEXT_PUBLIC_APP_URL: 'https://staging.example.test',
          MCP_DEPLOYMENT: 'staging',
          MCP_IDLE_TIMEOUT_SECONDS: 'malformed',
        }),
      ).toThrow('MCP_IDLE_TIMEOUT_SECONDS');
      expect(log).toHaveBeenCalledWith(
        'Invalid MCP inactivity configuration: MCP_IDLE_TIMEOUT_SECONDS must be an integer from 120 to 7776000. MCP initialization refused.',
      );
    } finally {
      log.mockRestore();
    }
  });
  it('allows an explicitly marked staging deployment to shorten inactivity', () => {
    expect(
      mcpIdleSeconds({
        NODE_ENV: 'production',
        MCP_DEPLOYMENT: 'staging',
        MCP_IDLE_TIMEOUT_SECONDS: '120',
      }),
    ).toBe(120);
  });
  it.each(['0', '-1', '60', '119', 'abc', '1.5', '7776001'])(
    'rejects invalid staging inactivity timeout %s',
    (timeout) => {
      expect(() =>
        mcpIdleSeconds({ MCP_DEPLOYMENT: 'staging', MCP_IDLE_TIMEOUT_SECONDS: timeout }),
      ).toThrow('MCP_IDLE_TIMEOUT_SECONDS');
    },
  );
});
