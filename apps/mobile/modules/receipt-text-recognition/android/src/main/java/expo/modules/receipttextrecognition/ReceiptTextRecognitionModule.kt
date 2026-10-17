package expo.modules.receipttextrecognition

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Input envelope, matching payable-receipt-ocr's per-receipt limits where they apply.
private const val MAX_SOURCE_BYTES = 25L * 1024 * 1024
private const val MAX_SOURCE_PIXELS = 100_000_000L
private const val MAX_RECOGNITION_PIXELS = 12_000_000L
private const val STALE_COPY_MILLIS = 60L * 60 * 1000

// Messages never include paths, pixels or recognized text.
private class ReceiptImageException(code: String) :
  CodedException(code, "The receipt image could not be read on this device.", null)

/**
 * Recognizes Latin text in a receipt image on the device with the bundled ML Kit model.
 *
 * Accepts only the app-owned copy that expo-image-picker writes under cache/ImagePicker, and
 * deletes that copy afterwards; a person's original image is never read here or deleted. No
 * network requests are made and nothing is logged.
 */
class ReceiptTextRecognitionModule : Module() {
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  override fun definition() = ModuleDefinition {
    Name("ReceiptTextRecognition")

    AsyncFunction("recognizeAsync") Coroutine { uri: String ->
      val copy = pickerCopy(uri)
      try {
        val bitmap = withContext(Dispatchers.IO) { decode(copy) }
        try {
          val text = recognize(bitmap)
          mapOf("width" to bitmap.width, "height" to bitmap.height, "lines" to lines(text))
        } finally {
          bitmap.recycle()
        }
      } finally {
        withContext(Dispatchers.IO) {
          copy.delete()
          sweepStaleCopies(copy.parentFile)
        }
      }
    }

    OnDestroy { recognizer.close() }
  }

  private fun pickerCopy(uri: String): File {
    val cacheDir = appContext.reactContext?.cacheDir ?: throw ReceiptImageException("ERR_RECEIPT_SOURCE")
    val root = File(cacheDir, "ImagePicker").canonicalFile
    val parsed = Uri.parse(uri)
    val path = parsed.path
    if (parsed.scheme != "file" || path == null) throw ReceiptImageException("ERR_RECEIPT_SOURCE")
    val file = File(path).canonicalFile
    if (file.parentFile != root || !file.isFile) throw ReceiptImageException("ERR_RECEIPT_SOURCE")
    return file
  }

  private fun decode(file: File): Bitmap {
    if (file.length() == 0L || file.length() > MAX_SOURCE_BYTES) throw ReceiptImageException("ERR_RECEIPT_TOO_LARGE")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val width = bounds.outWidth.toLong()
    val height = bounds.outHeight.toLong()
    if (width <= 0 || height <= 0) throw ReceiptImageException("ERR_RECEIPT_DECODE")
    if (width * height > MAX_SOURCE_PIXELS) throw ReceiptImageException("ERR_RECEIPT_TOO_LARGE")
    var sample = 1
    while ((width / sample) * (height / sample) > MAX_RECOGNITION_PIXELS) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw ReceiptImageException("ERR_RECEIPT_DECODE")
    val rotation = ExifInterface(file.path).rotationDegrees
    if (rotation == 0) return decoded
    val rotated = Bitmap.createBitmap(
      decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(rotation.toFloat()) }, true,
    )
    if (rotated !== decoded) decoded.recycle()
    return rotated
  }

  private suspend fun recognize(bitmap: Bitmap): Text = suspendCancellableCoroutine { continuation ->
    // ML Kit runs recognition on its own background executor.
    recognizer.process(InputImage.fromBitmap(bitmap, 0))
      .addOnSuccessListener { continuation.resume(it) }
      .addOnFailureListener { continuation.resumeWithException(ReceiptImageException("ERR_RECEIPT_RECOGNITION")) }
  }

  private fun lines(text: Text) = text.textBlocks.flatMap { block ->
    block.lines.map { line ->
      mapOf(
        "text" to line.text,
        "frame" to line.boundingBox?.let {
          mapOf("left" to it.left, "top" to it.top, "right" to it.right, "bottom" to it.bottom)
        },
      )
    }
  }

  /** Copies left behind by an interrupted scan are app-owned; remove them once they are stale. */
  private fun sweepStaleCopies(directory: File?) {
    val cutoff = System.currentTimeMillis() - STALE_COPY_MILLIS
    directory?.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
  }
}
