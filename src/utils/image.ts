export interface ImageDimensions {
  width: number
  height: number
}

export async function getImageDimensions(blob: Blob): Promise<ImageDimensions> {
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected file could not be decoded as an image.'))
    image.src = source
  })
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The cropped image could not be created.'))),
      type,
      quality,
    )
  })
}
