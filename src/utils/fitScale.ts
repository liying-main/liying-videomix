export interface FitScaleResult {
  position: { x: number; y: number }
  scale: { x: number; y: number }
}

/** Scale video to fit canvas (letterbox) centered. */
export function fitScale(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): FitScaleResult {
  if (!videoWidth || !videoHeight) {
    return { position: { x: 0, y: 0 }, scale: { x: -1, y: -1 } }
  }

  const ratio = Math.min(canvasWidth / videoWidth, canvasHeight / videoHeight)
  const scaledW = Math.round(videoWidth * ratio)
  const scaledH = Math.round(videoHeight * ratio)
  return {
    position: {
      x: Math.round((canvasWidth - scaledW) / 2),
      y: Math.round((canvasHeight - scaledH) / 2),
    },
    scale: { x: scaledW, y: scaledH },
  }
}
