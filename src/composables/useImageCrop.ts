export interface CropCoordinates {
  x: number
  y: number
  width: number
  height: number
  rotate: number
  scaleX: number
  scaleY: number
}

export interface ConfirmedCrop {
  blob: Blob
  coordinates: CropCoordinates
}

export function normalizeCropCoordinates(coordinates: Partial<CropCoordinates>): CropCoordinates {
  return {
    x: Math.max(0, Math.round(coordinates.x ?? 0)),
    y: Math.max(0, Math.round(coordinates.y ?? 0)),
    width: Math.max(1, Math.round(coordinates.width ?? 1)),
    height: Math.max(1, Math.round(coordinates.height ?? 1)),
    rotate: coordinates.rotate ?? 0,
    scaleX: coordinates.scaleX ?? 1,
    scaleY: coordinates.scaleY ?? 1,
  }
}
