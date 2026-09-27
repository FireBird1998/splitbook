import { describe, expect, it } from 'vitest';
import { createAppearanceController } from './appearance';

describe('native appearance preference', () => {
  it('does not replace a new choice when an older preference read completes', async () => {
    let finishRead!: (value: string) => void;
    const reading = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    const controller = createAppearanceController({ load: () => reading, save: async () => {} });
    const restoring = controller.restore();
    await controller.select('light');
    finishRead('dark');
    await restoring;
    expect(controller.getSnapshot()).toMatchObject({ mode: 'light', status: 'ready' });
  });
  it('preserves the latest choice when an earlier device write is slow', async () => {
    let finishFirst!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let saved: string | null = 'system';
    const storage = {
      load: async () => saved,
      save: async (value: string) => {
        if (value === 'dark') await delayed;
        saved = value;
      },
    };
    const controller = createAppearanceController(storage);
    await controller.restore();
    const first = controller.select('dark');
    const second = controller.select('light');
    finishFirst();
    await Promise.all([first, second]);
    expect(controller.getSnapshot()).toMatchObject({ mode: 'light', status: 'ready' });
    const restarted = createAppearanceController(storage);
    await restarted.restore();
    expect(restarted.getSnapshot().mode).toBe('light');
  });
  it('uses system appearance while a storage read is unavailable and supports retry', async () => {
    let fail = true;
    const controller = createAppearanceController({
      load: async () => {
        if (fail) throw new Error('Storage unavailable');
        return 'light';
      },
      save: async () => {},
    });
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ mode: 'system', status: 'error' });
    fail = false;
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ mode: 'light', status: 'ready' });
  });
  it('keeps a chosen appearance after restarting the preference controller', async () => {
    let saved: string | null = null;
    const storage = {
      load: async () => saved,
      save: async (value: string) => {
        saved = value;
      },
    };
    const first = createAppearanceController(storage);
    await first.restore();
    expect(first.getSnapshot().mode).toBe('system');
    await first.select('dark');
    const restarted = createAppearanceController(storage);
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({ mode: 'dark', status: 'ready' });
  });

  it('returns to the saved preference with a retryable message when a change cannot be saved', async () => {
    let fail = true;
    const controller = createAppearanceController({
      load: async () => 'dark',
      save: async () => {
        if (fail) throw new Error('Device storage unavailable');
      },
    });
    await controller.restore();
    await controller.select('light');
    expect(controller.getSnapshot()).toMatchObject({ mode: 'dark', status: 'error' });
    expect(controller.getSnapshot().message).toBeTruthy();
    fail = false;
    await controller.select('light');
    expect(controller.getSnapshot()).toMatchObject({
      mode: 'light',
      status: 'ready',
      message: null,
    });
  });
});
