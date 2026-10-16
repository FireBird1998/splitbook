import { launchImageLibraryAsync } from 'expo-image-picker';
import { z } from 'zod';
import { ReceiptTextRecognition } from '../modules/receipt-text-recognition';
import type { ReceiptScanner } from './data/receipt-scan';

const frame = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
});
const recognizedText = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  lines: z.array(z.object({ text: z.string().max(2000), frame: frame.nullable() })).max(5000),
});

/**
 * The device adapter: Android's photo picker chooses one image, which expo-image-picker copies
 * into app cache; the bundled ML Kit module reads that copy and deletes it. Null where the native
 * module is unavailable.
 */
export function createReceiptScanner(): ReceiptScanner | undefined {
  const native = ReceiptTextRecognition;
  if (!native) return undefined;
  return {
    async scan() {
      const picked = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 1,
        exif: false,
        base64: false,
      });
      const image = picked.canceled ? undefined : picked.assets[0];
      if (!image) return null;
      return recognizedText.parse(await native.recognizeAsync(image.uri));
    },
  };
}
