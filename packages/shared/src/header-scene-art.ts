/** Portable generated vector data: the web draws it as SVG, and Android's pictures are drawn from it. */
export type SceneLayer = 'far' | 'clouds' | 'main' | 'front' | 'glow';
export type SceneMotion =
  | 'animals'
  | 'petals'
  | 'boat'
  | 'birds'
  | 'sway'
  | 'water'
  | 'people'
  | 'turbines'
  | 'smoke'
  | 'snow'
  | 'clouds'
  | 'float'
  | 'windows'
  | 'lanterns'
  | 'halo';
export type VectorTag =
  | 'svg'
  | 'g'
  | 'path'
  | 'polygon'
  | 'circle'
  | 'ellipse'
  | 'rect'
  | 'defs'
  | 'radialGradient'
  | 'stop';
export interface SceneVector {
  tag: VectorTag;
  /** SVG property names in camel case, e.g. fillOpacity and stopColor. */
  props: Record<string, string>;
  classes?: string[];
  motion?: SceneMotion;
  delaySeconds?: number;
  /** Set where one element runs its motion at its own pace. */
  durationSeconds?: number;
  children?: SceneVector[];
}
export interface HeaderSceneArt {
  id: 'beach' | 'sakura' | 'eco-city' | 'mountain-village';
  name: string;
  description: string;
  viewBox: [number, number, number, number];
  layers: Record<SceneLayer, SceneVector>;
  /** The scene-specific web animation rules. Shared rules are in header-scenes/styles. */
  css: string;
}
