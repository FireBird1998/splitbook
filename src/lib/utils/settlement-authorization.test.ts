import { describe, expect, it } from 'vitest';
import { canRecordSettlement } from './settlement-authorization';

describe('canRecordSettlement', () => {
  it('allows the payer to record the settlement', () => {
    expect(canRecordSettlement('user-a', 'user-a', 'user-b')).toBe(true);
  });

  it('allows the recipient to record the settlement', () => {
    expect(canRecordSettlement('user-b', 'user-a', 'user-b')).toBe(true);
  });

  it('denies any third party, including other group members', () => {
    expect(canRecordSettlement('user-c', 'user-a', 'user-b')).toBe(false);
  });

  it('requires exact id matches', () => {
    expect(canRecordSettlement('user-a ', 'user-a', 'user-b')).toBe(false);
    expect(canRecordSettlement('USER-A', 'user-a', 'user-b')).toBe(false);
    expect(canRecordSettlement('', 'user-a', 'user-b')).toBe(false);
  });
});
