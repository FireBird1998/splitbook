/** Shared model details for the Beach and Sakura redraws; no imported board geometry. */
import {
  Model,
  S,
  hash3,
  cubePoly,
  vx,
  layerOf,
  svgWrap,
  cloudSvg,
  glowDefs,
  diamond,
} from './kit.ts';
import type { Project } from './engine.ts';

export function waterEffects(
  m: Model,
  s: Project,
  falls: [number, number, number][],
  seed: number,
): string {
  let effects = '';
  for (const v of m.v.values()) {
    if (
      !['water', 'sea'].includes(v.m) ||
      m.has(v.x, v.y, v.z + 1) ||
      hash3(v.x, v.y, 0, seed) > (v.m === 'sea' ? 0.04 : 0.13)
    )
      continue;
    effects += `<polygon class="shim" points="${diamond(s, v.x, v.y, v.z)}" fill="#e3f2f4" style="animation-delay: -${(hash3(v.x, v.y, 1, seed) * 5).toFixed(1)}s"></polygon>`;
  }
  for (const [x, y, z] of falls) {
    for (let k = 0; k < 6; k++) {
      const [px, py] = s(x + 0.5, y + 0.5, z - k * 1.6);
      effects += `<g class="drop" style="animation-delay: -${(k * 0.23).toFixed(2)}s">${cubePoly(px, py, 1.5, '#eff9fa')}</g>`;
    }
    const [px, py] = s(x + 0.5, y + 0.5, z - 10);
    effects += `<g class="mist" style="animation-delay: -0.9s">${cubePoly(px, py, 2.3, '#ffffff')}</g>`;
  }
  return effects;
}

/** A vertical water face on the visible +y side of a hill, or the island's lip. */
export function waterfall(m: Model, x: number, y: number, top: number, bottom: number, width = 2) {
  for (let xx = x; xx < x + width; xx++)
    for (let z = bottom; z <= top; z++) m.set(xx, y, z, 'fall');
}

export function lamp(m: Model, x: number, y: number, z = 1) {
  m.set(x, y, z, 'stone');
  m.set(x, y, z + 1, 'lamp', { lit: true });
  m.set(x, y, z + 2, 'stone');
}

export function glowLayer(
  main: ReturnType<typeof layerOf>,
  origin: [number, number],
  halos: [number, number][],
  id: string,
) {
  return svgWrap(
    `<g transform="translate(${origin.join(' ')})"><g class="float">${vx(main.r.wins, 'wins')}${halos.map(([x, y], i) => `<circle class="halo${i % 2 ? ' halo2' : ''}" cx="${x}" cy="${y}" r="${i ? 18 : 28}" fill="url(#${id}-glow)"></circle>`).join('')}${vx(main.r.lit, 'lit')}</g></g>`,
    'vq-art vq-glow',
  );
}

/** Small models use the same palette, occlusion and motion partition as the main island. */
export function surroundingLayers(
  id: string,
  islet: (seed: number, radius: number, u: number) => string,
) {
  const far = svgWrap(
    `<g transform="translate(640 62)"><g class="float3">${islet(34, 8, 2)}</g></g><g transform="translate(134 100)"><g class="float2">${islet(36, 5, 2)}</g></g><g transform="translate(594 180)"><g class="float3">${islet(39, 4, 2)}</g></g>`,
  );
  const clouds = svgWrap(
    `${glowDefs(id)}<g class="cl"><g transform="translate(90 40)">${cloudSvg(9, 5, 4)}</g></g><g class="cl c2"><g transform="translate(520 150)">${cloudSvg(8, 4, 5)}</g></g><g class="cl c3"><g transform="translate(330 26)">${cloudSvg(7, 4, 6)}</g></g>`,
  );
  const front = svgWrap(
    `<g transform="translate(44 214)"><g class="float2">${islet(41, 5, 5)}</g></g><g class="wisp"><g transform="translate(250 214)">${cloudSvg(10, 5, 21, 3, 2)}</g></g><g class="wisp wisp2"><g transform="translate(520 224)">${cloudSvg(8, 4, 22, 3, 2)}</g></g>`,
  );
  return { far, clouds, front };
}

export const project = S(4);
