import { withIsolatedDatabase } from './database.mjs';
import { identities, groups, databaseName } from './environment.mjs';

async function main() {
  const [command, persona, groupName] = process.argv.slice(2);
  if (command !== 'describe' && !Object.hasOwn(identities, persona)) {
    throw new Error('Use a fixed fictional persona: alex, sam, priya');
  }
  const result = await withIsolatedDatabase(async (database, Id) => {
    if (command === 'describe') {
      return {
        database: databaseName,
        groups: await database
          .collection('groups')
          .find({}, { projection: { name: 1, category: 1, 'members.user': 1 } })
          .toArray(),
      };
    }
    const user = new Id(identities[persona]);
    if (command === 'expire-sessions') {
      const changed = await database
        .collection('sessions')
        .updateMany(
          { userId: { $in: [user, identities[persona]] } },
          { $set: { expiresAt: new Date(0), updatedAt: new Date() } },
        );
      return { action: command, persona, modifiedSessions: changed.modifiedCount };
    }
    if (!['trip', 'household'].includes(groupName)) {
      throw new Error('Membership controls are restricted to the two fictional shared Groups');
    }
    if (persona === 'alex') throw new Error('Do not remove the fictional admin');
    const id = new Id(groups[groupName]);
    if (command === 'revoke-member') {
      const changed = await database
        .collection('groups')
        .updateOne({ _id: id }, { $pull: { members: { user } } });
      return { action: command, persona, group: groupName, modifiedGroups: changed.modifiedCount };
    }
    if (command === 'restore-member') {
      const changed = await database
        .collection('groups')
        .updateOne(
          { _id: id, 'members.user': { $ne: user } },
          { $push: { members: { user, role: 'member', joinedAt: new Date() } } },
        );
      return { action: command, persona, group: groupName, modifiedGroups: changed.modifiedCount };
    }
    throw new Error('Supported commands: describe, expire-sessions, revoke-member, restore-member');
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
