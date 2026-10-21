import { describe, expect, it } from 'vitest';
import { assistantDisplay } from './assistant-name';

/* How the approval page names an assistant (#614): by the name its metadata document publishes,
 * else by its address's host, with the address (host and path) in small text beside it. A
 * registered client has no metadata document, so it has no address to show. */
describe('an assistant as the approval page names it', () => {
  it('uses the published name, with the address beside it', () => {
    expect(assistantDisplay('https://chatgpt.com/oauth/client.json', 'ChatGPT')).toEqual({
      name: 'ChatGPT',
      address: 'chatgpt.com/oauth/client.json',
    });
  });

  it('shows the address with its path, so publishers on one host can be told apart', () => {
    expect(
      assistantDisplay('https://raw.githubusercontent.com/fictional/x/main/client.json', 'Helper')
        .address,
    ).toBe('raw.githubusercontent.com/fictional/x/main/client.json');
  });

  it('falls back to the address host when no name is published', () => {
    for (const name of ['', null])
      expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', name)).toEqual({
        name: 'claude.ai',
        address: 'claude.ai/oauth/mcp-client.json',
      });
  });

  it('treats a name with no letter or number as no name', () => {
    for (const name of ['ㅤㅤ', '⠀', 'ᅟᅠﾠ', ' ★ · ★ '])
      expect(assistantDisplay('https://claude.ai/oauth/mcp-client.json', name).name).toBe(
        'claude.ai',
      );
  });

  it('cleans a published name as Draft attribution does', () => {
    expect(
      assistantDisplay('https://assistant.example.test/client.json', '  Fictional\u0007   Helper ')
        .name,
    ).toBe('Fictional Helper');
  });

  it('never lets a published name pose as another address', () => {
    for (const name of [
      'claude.ai',
      'Claude by claude.ai',
      'https://chatgpt.com',
      'ChatGPT (chatgpt.com)',
      'chatgpt.соm',
    ])
      expect(assistantDisplay('https://fictional.example.test/client.json', name).name, name).toBe(
        'fictional.example.test',
      );
    expect(assistantDisplay('https://chatgpt.com/oauth/client.json', 'chatgpt.com').name).toBe(
      'chatgpt.com',
    );
    expect(assistantDisplay('a1b2c3d4e5', 'claude.ai').name).toBe('Assistant');
  });

  it('gives an address only to an https metadata document', () => {
    expect(assistantDisplay('http://assistant.example.test/client.json', 'Helper')).toEqual({
      name: 'Helper',
      address: null,
    });
  });

  it('names a registered client by its name, never by its client id', () => {
    expect(assistantDisplay('a1b2c3d4e5', 'Synthetic MCP Client')).toEqual({
      name: 'Synthetic MCP Client',
      address: null,
    });
    expect(assistantDisplay('a1b2c3d4e5', '')).toEqual({ name: 'Assistant', address: null });
  });
});
