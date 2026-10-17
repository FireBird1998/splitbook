import { describe, expect, it } from 'vitest';
import { parseGroup } from './dto';

// Fictional people only.
const alex = { _id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { _id: 'a00000000000000000000002', name: 'Sam' };
const at = '2026-10-18T10:00:00.000Z';

describe('a Group read on Android (#517)', () => {
  it('reads co-members sent by id and name only, as a member gets them', () => {
    const group = parseGroup({
      status: 200,
      data: {
        _id: 'b00000000000000000000001',
        name: 'Maple House',
        createdBy: alex._id,
        defaultCurrency: 'INR',
        members: [
          { user: alex, role: 'admin', joinedAt: at },
          { user: sam, role: 'member', joinedAt: at },
        ],
        createdAt: at,
        updatedAt: at,
      },
    });
    expect(group.members.map(({ user }) => user)).toEqual([
      { id: alex._id, name: 'Alex', email: 'alex@example.test', image: null },
      { id: sam._id, name: 'Sam', email: null, image: null },
    ]);
  });
});
