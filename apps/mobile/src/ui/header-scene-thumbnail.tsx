import { Image, View } from 'react-native';
import type { GroupHeader } from '@splitbook/shared/group-header';
import { sceneThumbnails } from './header-scene-sprites/thumbnails';
/** The scene's own main island, as large as the tile allows, on the day sky. */
export default function HeaderSceneThumbnail({ scene }: { scene: GroupHeader['scene'] }) {
  return (
    <View
      style={{
        height: 64,
        borderRadius: 8,
        paddingHorizontal: 3,
        paddingVertical: 4,
        backgroundColor: '#d6e7ef',
      }}
    >
      <Image
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        fadeDuration={0}
        source={sceneThumbnails[scene]}
        resizeMode="contain"
        style={{ flex: 1, width: '100%' }}
      />
    </View>
  );
}
