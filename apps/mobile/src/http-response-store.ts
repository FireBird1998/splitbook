import { Directory, Paths } from 'expo-file-system';

/** React Native/Expo's Android HTTP cache only; app-owned saved copies live elsewhere. */
export const httpResponseStore = {
  async clear() {
    const store = new Directory(Paths.cache, 'http-cache');
    if (store.exists) store.delete();
  },
};
