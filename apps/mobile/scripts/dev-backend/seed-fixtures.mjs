import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolatedEnv, repository, groups, identities, databaseName } from './environment.mjs';
import { withIsolatedDatabase } from './database.mjs';

async function main() {
  Object.assign(process.env, isolatedEnv());
  await withIsolatedDatabase(async () => undefined, { initialize: true });
  const seedModule = await import(
    pathToFileURL(resolve(repository, 'apps/web/src/lib/demo/seed.ts')).href
  );
  try {
    const result = await seedModule.seedDemoData();
    const { default: Group } = await import(
      pathToFileURL(resolve(repository, 'apps/web/src/lib/models/Group.ts')).href
    );
    const { buildDefaultGroupTags } = await import(
      pathToFileURL(resolve(repository, 'packages/shared/src/default-tags.ts')).href
    );
    for (const group of [
      {
        id: groups.household,
        name: 'Maple House',
        theme: 'home',
        people: Object.values(identities),
      },
      {
        id: groups.private,
        name: 'Alex private test Group',
        theme: 'other',
        people: [identities.alex],
      },
    ]) {
      if (await Group.exists({ _id: group.id })) continue;
      await Group.create({
        _id: group.id,
        name: group.name,
        description: 'Fictional isolated data for native development only.',
        category: group.theme,
        defaultCurrency: 'INR',
        createdBy: identities.alex,
        members: group.people.map((user) => ({
          user,
          role: user === identities.alex ? 'admin' : 'member',
          joinedAt: new Date(),
        })),
        tags: buildDefaultGroupTags(group.theme),
      });
    }
    const { supportsGroupTransactions } = await import(
      pathToFileURL(resolve(repository, 'apps/web/src/lib/group-mutation.ts')).href
    );
    if (await supportsGroupTransactions()) {
      // Fixed, fictional assistant attribution for the public HTTP To review verifier.
      // The database ownership guard above runs before importing or writing app models.
      const { expenseDraftService } = await import(
        pathToFileURL(resolve(repository, 'apps/web/src/lib/services/expense-draft.service.ts'))
          .href
      );
      const privateGroup = await Group.findById(groups.private).lean();
      if (!privateGroup?.tags[0])
        throw new Error('Fictional Claude fixture needs its private Group');
      await expenseDraftService.create(
        { id: identities.alex, assistant: { name: 'Claude' } },
        groups.private,
        {
          drafts: [
            {
              description: 'Fictional Claude prepared lunch',
              amount: 19.25,
              currency: 'INR',
              category: 'other',
              date: '2026-01-15',
              tagId: String(privateGroup.tags[0]._id),
              paidBy: [{ user: identities.alex, amount: 19.25 }],
              splitMethod: 'equal',
              splitBetween: [{ user: identities.alex }],
            },
          ],
        },
        'native-to-review-claude-fixture-v1',
      );
    } else {
      console.log('Skipping the fictional Claude Draft: MongoDB does not support transactions.');
    }
    console.log(
      JSON.stringify(
        { database: databaseName, fictional: true, seed: result, personas: identities, groups },
        null,
        2,
      ),
    );
  } finally {
    await seedModule.disconnectDemoDb();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
