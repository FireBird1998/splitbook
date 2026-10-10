import { describe, expect, it } from 'vitest';
import { createMobileController } from '../data/mobile-controller';
import { monitorFlows } from './flow-monitor';

function publisher() {
  const original = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4000',
      authOrigin: 'http://localhost:4000',
      developmentPersonaEnabled: true,
    },
    {
      fetch: async () => Response.json({}),
      credentials: { load: async () => null, save: async () => {}, clear: async () => {} },
    },
  );
  let snapshot = original.getSnapshot();
  const listeners = new Set<() => void>();
  const controller = {
    ...original,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    controller,
    publish(next: typeof snapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('the public flow monitor', () => {
  it('fails on an undeclared publication even without a request', () => {
    const { controller, publish } = publisher();
    const check = monitorFlows(controller);
    publish({
      ...controller.getSnapshot(),
      expense: { ...controller.getSnapshot().expense, status: 'saved' },
    });
    expect(() => check.assertValid()).toThrow('expense: undeclared idle → saved');
    check.stop();
  });
  it('rejects a declared saving transition without an explicit command', () => {
    const { controller, publish } = publisher();
    const check = monitorFlows(controller);
    publish({
      ...controller.getSnapshot(),
      creation: { ...controller.getSnapshot().creation, status: 'saving' },
    });
    expect(() => check.assertValid()).toThrow('creation: saving without an explicit save command');
    check.stop();
  });
  it('rejects leaving without leaveGroup', () => {
    const { controller, publish } = publisher();
    publish({
      ...controller.getSnapshot(),
      leave: { ...controller.getSnapshot().leave, status: 'confirm' },
    });
    const check = monitorFlows(controller);
    publish({
      ...controller.getSnapshot(),
      leave: { ...controller.getSnapshot().leave, status: 'leaving' },
    });
    expect(() => check.assertValid()).toThrow('leave: leaving without leaveGroup');
    check.stop();
  });
  it('keeps authorization active until the explicit command settles', async () => {
    const { controller, publish } = publisher();
    controller.createGroup = async () => {
      await Promise.resolve();
      publish({
        ...controller.getSnapshot(),
        creation: { ...controller.getSnapshot().creation, status: 'saving' },
      });
    };
    const check = monitorFlows(controller);
    await controller.createGroup();
    expect(() => check.assertValid()).not.toThrow();
    publish({
      ...controller.getSnapshot(),
      creation: { ...controller.getSnapshot().creation, status: 'editing' },
    });
    publish({
      ...controller.getSnapshot(),
      creation: { ...controller.getSnapshot().creation, status: 'saving' },
    });
    expect(() => check.assertValid()).toThrow('saving without an explicit save command');
    check.stop();
  });
});
