import { format, resolveConfig } from 'prettier';

/** Keep recordings readable, stable, and in the repository's JSON format. */
export async function recording(cells: unknown) {
  return format(JSON.stringify(cells), {
    ...(await resolveConfig('entry-readings.json')),
    parser: 'json',
  });
}
