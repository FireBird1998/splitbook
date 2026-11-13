/**
 * Sakura, traced from the VoxelSakura board so it is the board's island exactly (#1203).
 * The drawing lives in `traced/sakura.json`; redraw it there, or replace this with a voxel model.
 */
import { traced } from './traced.ts';

const source = traced('sakura');
export const sakuraScene = () => ({ layers: source.layers });
export const sakuraCss = source.css;
