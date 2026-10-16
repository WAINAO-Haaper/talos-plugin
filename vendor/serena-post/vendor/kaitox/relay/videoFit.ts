/**
 * TALOS adaptation of SerenaPost's video fitting boundary (MIT).
 * Keep compatible MP4/MOV bytes. Never discover or execute ffmpeg/ffprobe.
 * The browser extension/X performs the final codec validation and acknowledges failures.
 */
const X_CONTAINERS = new Set(['video/mp4', 'video/quicktime']);

export async function fitVideoBytes(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!mime.startsWith('video/') || X_CONTAINERS.has(mime.toLowerCase())) return { bytes, mime };
  throw new Error('Unsupported video format: use an X-compatible H.264/AAC MP4 or MOV; automatic transcoding is disabled.');
}
