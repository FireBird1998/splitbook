'use client';

import { createElement, useId, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import type { HeaderSceneArt, SceneVector } from '@splitbook/shared/header-scene-art';
import type { GroupHeader } from '@splitbook/shared/group-header';

export interface ScenePictureProps {
  art: HeaderSceneArt;
  time: Exclude<GroupHeader['time'], 'auto'>;
  motion?: boolean;
  followPointer?: boolean;
  /** Thumbnails and settings previews frame just the main island. */
  cropped?: boolean;
}

function vector(node: SceneVector, prefix: string, key: string, cropped: boolean): React.ReactNode {
  const props: Record<string, unknown> = { ...node.props, key };
  for (const [name, value] of Object.entries(node.props)) {
    if (name === 'id') props[name] = prefix + value;
    else if (value.includes('url(#')) props[name] = value.replaceAll('url(#', `url(#${prefix}`);
    else if (name === 'href' && value.startsWith('#')) props[name] = `#${prefix}${value.slice(1)}`;
  }
  if (node.classes) props.className = node.classes.join(' ');
  const style: CSSProperties = {};
  if (node.delaySeconds !== undefined) style.animationDelay = `${node.delaySeconds}s`;
  // Traced scenes can override a group's duration as well as its start delay.
  if ('durationSeconds' in node && typeof node.durationSeconds === 'number')
    style.animationDuration = `${node.durationSeconds}s`;
  if (Object.keys(style).length) props.style = style;
  if (node.tag === 'svg') {
    props['aria-hidden'] = true;
    props.focusable = false;
    if (cropped) {
      props.viewBox = '70 0 460 240';
      props.preserveAspectRatio = 'xMidYMid slice';
    }
  }
  return createElement(
    node.tag,
    props,
    ...(node.children ?? []).map((child, i) => vector(child, prefix, `${key}-${i}`, false)),
  );
}

/** The portable vector vocabulary maps to inline SVG; no art is fetched from an external host. */
export default function ScenePicture({
  art,
  time,
  motion = true,
  followPointer = true,
  cropped = false,
}: ScenePictureProps) {
  const prefix = `scene-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  return (
    <Box
      role="img"
      aria-label={art.description}
      className={`scene-picture vq t-${time}${motion ? '' : ' calm'}`}
      onPointerMove={(event) => {
        if (
          !motion ||
          !followPointer ||
          event.pointerType !== 'mouse' ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
        const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
        event.currentTarget.style.setProperty('--scene-x', `${x * 1.5}deg`);
        event.currentTarget.style.setProperty('--scene-y', `${-y * 1.5}deg`);
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty('--scene-x', '0deg');
        event.currentTarget.style.setProperty('--scene-y', '0deg');
      }}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        // The compact preview keeps the sun or moon beside the island, as on its board.
        '& .vq-sun': cropped ? { left: '84%' } : {},
        '& .vq-world': {
          transform:
            motion && followPointer
              ? 'perspective(900px) rotateX(var(--scene-y, 0deg)) rotateY(var(--scene-x, 0deg))'
              : 'none',
          // A phone-width header keeps the art at the height's scale (210 of 240) and puts the
          // main island, drawn around x = 300 of 1100, in the middle instead of slicing it.
          '@container headerScene (max-width: 720px)': cropped
            ? { left: 0, right: 0 }
            : { left: 'calc(50% - 262.5px)', right: 'auto', width: 962.5 },
        },
        // The time-of-day tint must still cover the whole picture when the art is narrower.
        '@container headerScene (max-width: 720px)': {
          position: 'relative',
          height: 210,
          '& .vq-tint': { left: -500, right: -500 },
        },
        '@media (prefers-reduced-motion: reduce)': {
          '&, & *': { animation: 'none !important', transition: 'none !important' },
          // The compact preview keeps the sun or moon beside the island, as on its board.
          '& .vq-sun': cropped ? { left: '84%' } : {},
          '& .vq-world': { transform: 'none !important' },
        },
      }}
    >
      <Box className="vq-sky" aria-hidden>
        <span className="vq-stars">
          {[
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
          ].map(([left, top]) => (
            <i key={left} style={{ left: `${left}%`, top: `${top}%` }} />
          ))}
        </span>
        <span className="vq-sun" />
      </Box>
      <Box className="vq-world" aria-hidden>
        {(['far', 'clouds', 'main', 'front'] as const).map((layer) =>
          vector(art.layers[layer], prefix, layer, cropped),
        )}
        <span className="vq-tint" />
        {vector(art.layers.glow, prefix, 'glow', cropped)}
      </Box>
    </Box>
  );
}
