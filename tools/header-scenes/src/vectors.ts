/** Parse the generator's small SVG vocabulary into portable, DOM-free vector data. */
import type { SceneMotion, SceneVector, VectorTag } from '@splitbook/shared/header-scene-art';

const TAGS = new Set([
  'svg',
  'g',
  'path',
  'polygon',
  'circle',
  'ellipse',
  'rect',
  'defs',
  'radialGradient',
  'stop',
]);
function motion(classes: string[]): SceneMotion | undefined {
  if (classes.includes('boat')) return 'boat';
  if (classes.some((c) => /^(fox|fbob|bx-crab)$/.test(c))) return 'animals';
  if (classes.some((c) => /^(pt|pt2)$/.test(c))) return 'petals';
  if (classes.some((c) => /^(birds|bx-gull)$/.test(c))) return 'birds';
  if (classes.some((c) => /^(walker|bx-walk|bx-bob)$/.test(c))) return 'people';
  if (classes.some((c) => /^sway/.test(c))) return 'sway';
  if (classes.some((c) => /^(shim2?|flow|drop|mist|koi2?|bx-drop|bx-rip)$/.test(c))) return 'water';
  if (classes.some((c) => /^(ecw[12]|ecbike|mvhike|wbob)$/.test(c))) return 'people';
  if (classes.some((c) => /^ecspin/.test(c))) return 'turbines';
  if (classes.includes('mvsmk')) return 'smoke';
  if (classes.some((c) => /^mvsnow/.test(c))) return 'snow';
  if (classes.includes('wins')) return 'windows';
  if (classes.includes('lit') || classes.includes('lbob')) return 'lanterns';
  if (classes.some((c) => /^(halo2?|door-glow)$/.test(c))) return 'halo';
  if (classes.some((c) => /^(cl|cf|wisp)$/.test(c))) return 'clouds';
  if (classes.some((c) => /^float/.test(c))) return 'float';
}
const camelCase = (key: string) =>
  key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
const kebabCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function vectorTree(svg: string): SceneVector {
  const stack: SceneVector[] = [];
  let root: SceneVector | undefined;
  let end = 0;
  for (const match of svg.matchAll(/<\/?([A-Za-z]+)\b([^>]*)>/g)) {
    if (svg.slice(end, match.index).trim()) throw new Error('Vector text is not supported');
    end = match.index + match[0].length;
    const [, tag, attributes] = match;
    if (!TAGS.has(tag)) throw new Error(`Unsupported vector tag: ${tag}`);
    if (match[0].startsWith('</')) {
      if (stack.pop()?.tag !== tag) throw new Error('Unbalanced vector tags');
      continue;
    }
    const node: SceneVector = { tag: tag as VectorTag, props: {} };
    let attributeEnd = 0;
    for (const attr of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (attributes.slice(attributeEnd, attr.index).trim())
        throw new Error('Unsupported vector attribute');
      attributeEnd = attr.index + attr[0].length;
      const [, key, value] = attr;
      if (/^on/i.test(key)) throw new Error('Vector event handlers are not supported');
      if (key === 'class') {
        node.classes = value.split(/\s+/).filter(Boolean);
        const kind = motion(node.classes);
        if (kind) node.motion = kind;
      } else if (key === 'style') {
        const timing =
          /^(?:animation-duration:\s*([\d.]+)s;\s*)?animation-delay:\s*(-?[\d.]+)s$/.exec(value);
        if (!timing) throw new Error('Unsupported vector style');
        if (timing[1]) node.durationSeconds = Number(timing[1]);
        node.delaySeconds = Number(timing[2]);
      } else if (key !== 'aria-hidden') {
        node.props[camelCase(key)] = value;
      }
    }
    if (attributes.slice(attributeEnd).replace(/\/$/, '').trim())
      throw new Error('Unsupported vector attribute');
    if (stack.length) (stack.at(-1)!.children ??= []).push(node);
    else if (root) throw new Error('Multiple vector roots');
    else root = node;
    if (!match[0].endsWith('/>')) stack.push(node);
  }
  if (!root || root.tag !== 'svg' || stack.length || svg.slice(end).trim())
    throw new Error('Incomplete vector');
  return root;
}
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const svgCase = new Set(['viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform']);
export function vectorSvg(node: SceneVector): string {
  const props = Object.entries(node.props).map(
    ([key, value]) => `${svgCase.has(key) ? key : kebabCase(key)}="${escape(value)}"`,
  );
  if (node.classes?.length) props.push(`class="${node.classes.join(' ')}"`);
  if (node.delaySeconds !== undefined)
    props.push(
      `style="${node.durationSeconds === undefined ? '' : `animation-duration: ${node.durationSeconds}s; `}animation-delay: ${node.delaySeconds}s"`,
    );
  return `<${node.tag}${props.length ? ' ' + props.join(' ') : ''}>${(node.children ?? []).map(vectorSvg).join('')}</${node.tag}>`;
}
