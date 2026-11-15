import { describe, expect, it } from 'vitest';
import { testPhone } from './test-phone';
import { fakeSplitbook } from './fake-splitbook';
import { monitorFlows } from './flow-monitor';

function publisher() {
  const phone = testPhone(fakeSplitbook(), {
    origin: 'http://localhost:4000',
    monitor: false,
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
      accountLocal: undefined,
    },
  });
  const original = phone.open();
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
  // #1253: a removal is its own flow, sent only by the command that sends it.
  it('checks the member removal flow: declared steps, and removing only through its command', () => {
    const { controller, publish } = publisher();
    const check = monitorFlows(controller);
    const memberRemoval = controller.getSnapshot().memberRemoval;
    publish({
      ...controller.getSnapshot(),
      memberRemoval: { ...memberRemoval, status: 'confirm' },
    });
    publish({
      ...controller.getSnapshot(),
      memberRemoval: { ...memberRemoval, status: 'removing' },
    });
    publish({ ...controller.getSnapshot(), memberRemoval: { ...memberRemoval, status: 'closed' } });
    publish({
      ...controller.getSnapshot(),
      memberRemoval: { ...memberRemoval, status: 'refused' },
    });
    expect(() => check.assertValid()).toThrow(
      [
        'memberRemoval: removing without removeMember',
        'memberRemoval: undeclared closed → refused',
      ].join('\n'),
    );
    check.stop();
  });
  // #1252: a role change is its own flow, started only by the command that sends it.
  it('checks the member role flow: declared steps, and changing only through its command', () => {
    const { controller, publish } = publisher();
    const check = monitorFlows(controller);
    const memberRole = controller.getSnapshot().memberRole;
    publish({ ...controller.getSnapshot(), memberRole: { ...memberRole, status: 'changing' } });
    publish({ ...controller.getSnapshot(), memberRole: { ...memberRole, status: 'failed' } });
    publish({ ...controller.getSnapshot(), memberRole: { ...memberRole, status: 'idle' } });
    publish({ ...controller.getSnapshot(), memberRole: { ...memberRole, status: 'failed' } });
    expect(() => check.assertValid()).toThrow(
      [
        'memberRole: changing without changeMemberRole',
        'memberRole: undeclared idle → failed',
      ].join('\n'),
    );
    check.stop();
  });
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
