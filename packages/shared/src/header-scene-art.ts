/** Portable generated vector data. Web SVG and react-native-svg share these primitives. */
export type SceneLayer = 'far' | 'clouds' | 'main' | 'front' | 'glow';
export type SceneMotion =
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
  /** SVG/react-native-svg property names, e.g. fillOpacity and stopColor. */
  props: Record<string, string>;
  classes?: string[];
  motion?: SceneMotion;
  delaySeconds?: number;
  children?: SceneVector[];
}
export interface HeaderSceneArt {
  id: 'eco-city' | 'mountain-village';
  name: string;
  description: string;
  viewBox: [number, number, number, number];
  layers: Record<SceneLayer, SceneVector>;
  /** The scene-specific web animation rules. Shared rules are in header-scenes/styles. */
  css: string;
}
