import type { HeaderSceneArt } from '@splitbook/shared/header-scene-art';
import type { GroupHeader } from '@splitbook/shared/group-header';

/** The same import works for every generated scene, including scenes added to the tool later. */
export async function loadHeaderScene(id: GroupHeader['scene']) {
  const [art, styles] = await Promise.all([
    import(`@splitbook/shared/header-scenes/${id}`) as Promise<{ default: HeaderSceneArt }>,
    import('@splitbook/shared/header-scenes/styles'),
  ]);
  // Generated geometry supplies defaults; MUI sx owns responsive framing above this sublayer.
  return {
    art: art.default,
    css: `@layer mui.headerScenes {${styles.headerSceneCss}${art.default.css}}`,
  };
}
