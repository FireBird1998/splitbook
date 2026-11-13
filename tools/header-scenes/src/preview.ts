/** Review-only composition: no Group card or product controls. Uses generated vector layers. */
import type { HeaderSceneArt } from '@splitbook/shared/header-scene-art';
import { vectorSvg } from './vectors.ts';

const stars = [
  [6, 14],
  [14, 30],
  [22, 10],
  [33, 22],
  [47, 8],
  [58, 26],
  [66, 12],
  [78, 20],
  [88, 9],
  [94, 28],
]
  .map(([left, top]) => `<i style="left:${left}%;top:${top}%"></i>`)
  .join('');
export function previewPage(scene: HeaderSceneArt, css: string, time: 'day' | 'night'): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${scene.name} · ${time}</title><style>
body{margin:0;background:#f4f5f9}.vq{position:relative;width:1100px;height:240px;overflow:hidden}
${css}${scene.css}
/* Freeze at one repeatable frame, including the board's negative start delays. */
.vq *{animation-play-state:paused!important;transition:none!important}
</style><section class="vq t-${time}" role="img" aria-label="${scene.description}"><div class="vq-sky"><span class="vq-stars">${stars}</span><span class="vq-sun"></span></div><div class="vq-world">
${vectorSvg(scene.layers.far)}${vectorSvg(scene.layers.clouds)}${vectorSvg(scene.layers.main)}${vectorSvg(scene.layers.front)}<span class="vq-tint"></span>${vectorSvg(scene.layers.glow)}
</div></section></html>`;
}
