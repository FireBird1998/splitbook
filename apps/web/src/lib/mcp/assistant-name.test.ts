import { describe, expect, it } from 'vitest';
import { assistantDisplay } from './assistant-name';

/* How the approval page names an assistant (#614): by the name its metadata document publishes,
 * else by its address's host, with that address in small text beside it. A registered client has
 * no metadata document, so it has no address to show. */
describe('an assistant as the approval page names it', () => {
  it('uses the published name, with the address host beside it', () => {
    expect(assistantDisplay('https://chatgpt.com/oauth/client.json', 'ChatGPT')).toEqual({
      name: 'ChatGPT',
      address: 'chatgpt.com',
    });
  });

  it('falls back to the address host when no name is published', () => {
    expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', '')).toEqual({
      name: 'claude.ai',
      address: 'claude.ai',
    });
    expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', null)).toEqual({
      name: 'claude.ai',
      address: 'claude.ai',
    });
  });

  it('cleans a published name as Draft attribution does', () => {
    expect(
      assistantDisplay('https://assistant.example.test/client.json', '  Fictional\u0007   Helper ')
        .name,
    ).toBe('Fictional Helper');
  });

  it('names a registered client by its name, never by its client id', () => {
    expect(assistantDisplay('a1b2c3d4e5', 'Synthetic MCP Client')).toEqual({
      name: 'Synthetic MCP Client',
      address: null,
    });
    expect(assistantDisplay('a1b2c3d4e5', '')).toEqual({ name: 'Assistant', address: null });
  });
});
