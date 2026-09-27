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
