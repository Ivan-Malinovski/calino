/**
 * Downscale a base64 image to a max dimension and re-encode as JPEG, mirroring
 * the size @capacitor/camera's `Camera.getPhoto({ width: 1600, quality: 80 })`
 * already produces for the camera/gallery-picker flow. Images arriving via
 * the Android share intent come straight from whatever app shared them (often
 * full camera resolution, several MB), so they need the same treatment before
 * being sent to a vision API.
 */
export async function downscaleImageBase64(
  base64: string,
  mimeType: string,
  maxDimension = 1600,
  quality = 0.8
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = `data:${mimeType};base64,${base64}`
  const img = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not decode image'))
  })
  img.src = dataUrl
  await loaded

  const { naturalWidth: width, naturalHeight: height } = img
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  const outMimeType = 'image/jpeg'
  const outDataUrl = canvas.toDataURL(outMimeType, quality)
  const [, outBase64] = outDataUrl.split(',')
  if (!outBase64) throw new Error('Failed to encode downscaled image')

  return { base64: outBase64, mimeType: outMimeType }
}
