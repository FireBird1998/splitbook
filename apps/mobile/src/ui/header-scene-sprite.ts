import type { ImageSourcePropType } from 'react-native';
import type { GroupHeader } from '@splitbook/shared/group-header';

/** One animated property over one cycle of a part's movement: its value at each point from 0 to 1. */
export interface SceneCurve {
  at: number[];
  to: number[];
}
/** One of the web's CSS animations on a part, baked into straight stops by tools/header-scenes. */
export interface SceneTrack {
  seconds: number;
  /** Runs only when the scene shows this time of day. */
  time?: 'night';
  /** Scene units. */
  x?: SceneCurve;
  y?: SceneCurve;
  scale?: SceneCurve;
  /** Degrees. */
  rotate?: SceneCurve;
  opacity?: SceneCurve;
  centred?: boolean;
}
/** One picture of a Header scene, placed in scene units (the scene is 240 units tall). */
export interface SceneSprite {
  layer: 'far' | 'clouds' | 'main' | 'front' | 'glow';
  /**
   * A body floats, a cloud drifts, the shadow breathes under the main island. A part is one moving
   * thing on an island (water, an animal, a walker); a cover is the art in front of the part before it.
   */
  kind: 'body' | 'cloud' | 'shadow' | 'part' | 'cover';
  /** Float period for a body, part, cover or shadow; one full web crossing for a cloud. */
  seconds: number;
  x: number;
  y: number;
  w: number;
  h: number;
  image: ImageSourcePropType;
  /** A part's own movement, outermost first. */
  tracks?: SceneTrack[];
  /** A part's opacity when nothing runs; 0 means it is only seen while it moves. */
  rest?: number;
  /** Outside every floating island: it does not rise with them. */
  still?: boolean;
  /** A turning part drawn unslanted: the fixed turn and stretch that slant it, and its first turn. */
  slant?: { turn: number; scaleX: number; scaleY: number; start: number };
}
export interface HeaderSceneSprites {
  id: GroupHeader['scene'];
  description: string;
  /** Hash of the drawing input, checked by tools/header-scenes. */
  source: string;
  sprites: SceneSprite[];
}
