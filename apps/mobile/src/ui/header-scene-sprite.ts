import type { ImageSourcePropType } from 'react-native';
import type { GroupHeader } from '@splitbook/shared/group-header';

/** One picture of a Header scene, placed in scene units (the scene is 240 units tall). */
export interface SceneSprite {
  layer: 'far' | 'clouds' | 'main' | 'front' | 'glow';
  /** A body floats, a cloud drifts, the shadow breathes under the main island. */
  kind: 'body' | 'cloud' | 'shadow';
  /** Float period for a body or shadow; one full web crossing for a cloud. */
  seconds: number;
  x: number;
  y: number;
  w: number;
  h: number;
  image: ImageSourcePropType;
}
export interface HeaderSceneSprites {
  id: GroupHeader['scene'];
  description: string;
  /** Hash of the drawing input, checked by tools/header-scenes. */
  source: string;
  sprites: SceneSprite[];
}
