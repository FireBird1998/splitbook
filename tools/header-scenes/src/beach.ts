/**
 * Beach, traced from the VoxelHeaders board so it is the board's island exactly (#1203).
 * The drawing lives in `traced/beach.json`; redraw it there, or replace this with a voxel model.
 */
import { traced } from './traced.ts';

const source = traced('beach');
export const beachScene = () => ({ layers: source.layers });
export const beachCss = source.css;
