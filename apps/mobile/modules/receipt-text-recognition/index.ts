import { requireOptionalNativeModule } from 'expo';

export interface NativeRecognizedText {
  width: number;
  height: number;
  lines: {
    text: string;
    frame: { left: number; top: number; right: number; bottom: number } | null;
  }[];
}

interface ReceiptTextRecognitionModule {
  /**
   * Recognize Latin text on the device. Accepts only an expo-image-picker cache copy, which it
   * deletes afterwards.
   */
  recognizeAsync(uri: string): Promise<NativeRecognizedText>;
}

/** Null where the module is not built in, such as iOS for now. */
export const ReceiptTextRecognition =
  requireOptionalNativeModule<ReceiptTextRecognitionModule>('ReceiptTextRecognition');
