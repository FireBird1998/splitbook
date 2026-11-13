/** Scenes traced from the owner's design boards: the board's own layers, kept as generator sources. */
import { readFileSync } from 'node:fs';

interface Traced {
  layers: Record<'far' | 'clouds' | 'main' | 'front' | 'glow', string>;
  css: string;
}
export function traced(id: 'beach' | 'sakura'): Traced {
  return JSON.parse(
    readFileSync(new URL(`./traced/${id}.json`, import.meta.url), 'utf8'),
  ) as Traced;
}
