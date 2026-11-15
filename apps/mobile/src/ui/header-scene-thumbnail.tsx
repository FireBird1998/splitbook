import { Image } from 'react-native';
import type { GroupHeader } from '@splitbook/shared/group-header';
import { sceneThumbnails } from './header-scene-sprites/thumbnails';
import { THUMBNAIL_PICTURE_HEIGHT } from './header-scene-card';
export { THUMBNAIL_PICTURE_HEIGHT } from './header-scene-card';

/**
 * Where each scene's main island sits, in scene units (the scene is 240 units tall, centred on
 * x 300): the box its thumbnail picture was drawn from. A test checks them against the scenes.
 */
export const thumbnailIslands: Record<
  GroupHeader['scene'],
  { x: number; y: number; w: number; h: number }
> = {
  beach: { x: 146, y: 40.67, w: 308, h: 173 },
  sakura: { x: 146, y: 26.67, w: 296, h: 189 },
  'eco-city': { x: 155.33, y: 13.33, w: 289.33, h: 205.33 },
  'mountain-village': { x: 151.33, y: 5.33, w: 301.33, h: 209.33 },
};

/**
 * The scene's own main island, where the board's scene card draws it (#1267): the scene's full
 * height fills the card's picture, centred on the island, on the sky the card draws behind it.
 */
export default function HeaderSceneThumbnail({ scene }: { scene: GroupHeader['scene'] }) {
  const island = thumbnailIslands[scene];
  const unit = THUMBNAIL_PICTURE_HEIGHT / 240;
  return (
    <Image
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      fadeDuration={0}
      // Decode at the card's size, not the full island picture the scene uses.
      resizeMethod="resize"
      source={sceneThumbnails[scene]}
      resizeMode="contain"
      style={{
        position: 'absolute',
        top: island.y * unit,
        width: island.w * unit,
        height: island.h * unit,
        left: '50%',
        marginLeft: (island.x - 300) * unit,
      }}
    />
  );
}
