import { Image } from 'react-native';
import type { GroupHeader } from '@splitbook/shared/group-header';
import { sceneThumbnails } from '@splitbook/shared/header-scenes/thumbnails';
/** Generated raster data is evaluated only when the settings choices are mounted. */
export default function HeaderSceneThumbnail({ scene }: { scene: GroupHeader['scene'] }) {
  return (
    <Image
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      source={{ uri: sceneThumbnails[scene] }}
      resizeMode="contain"
      style={{ width: '100%', height: 64, borderRadius: 8 }}
    />
  );
}
