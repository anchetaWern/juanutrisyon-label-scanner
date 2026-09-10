import type { CropCoordinates } from '@/composables/useImageCrop'
import type { ImageQualityMetrics, ImageQualityWarning } from '@/composables/useImageQuality'
import type { OcrResult } from '@/services/ocr/types'

interface NavigatorWithDiagnostics extends Navigator {
  deviceMemory?: number
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
    mobile?: boolean
    platform?: string
  }
  connection?: {
    effectiveType?: string
    downlink?: number
    rtt?: number
    saveData?: boolean
  }
}

export interface ScannerDiagnosticEnvironment {
  page: {
    origin: string
    pathname: string
    mode: string
  }
  browser: Record<string, unknown>
  device: Record<string, unknown>
  display: Record<string, unknown>
  network: Record<string, unknown>
  performance: Record<string, unknown>
}

export interface ScannerDiagnosticInput {
  originalFile: File
  croppedBlob: Blob
  cropCoordinates: CropCoordinates | null
  qualityMetrics: ImageQualityMetrics | null
  qualityWarnings: ImageQualityWarning[]
  result: OcrResult
}

export function collectScannerEnvironment(): ScannerDiagnosticEnvironment {
  const browserNavigator = navigator as NavigatorWithDiagnostics
  const buildEnvironment = (import.meta as ImportMeta & { env?: { MODE?: string } }).env
  const connection = browserNavigator.connection
  const orientation = screen.orientation
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  return {
    page: {
      origin: window.location.origin,
      pathname: window.location.pathname,
      mode: buildEnvironment?.MODE ?? 'unknown',
    },
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: navigator.languages,
      userAgentData: browserNavigator.userAgentData
        ? {
            brands: browserNavigator.userAgentData.brands,
            mobile: browserNavigator.userAgentData.mobile,
            platform: browserNavigator.userAgentData.platform,
          }
        : null,
    },
    device: {
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: browserNavigator.deviceMemory ?? null,
      maxTouchPoints: navigator.maxTouchPoints,
    },
    display: {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      visualViewportWidth: window.visualViewport?.width ?? null,
      visualViewportHeight: window.visualViewport?.height ?? null,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio: window.devicePixelRatio,
      colorDepth: screen.colorDepth,
      orientation: orientation ? { type: orientation.type, angle: orientation.angle } : null,
    },
    network: {
      online: navigator.onLine,
      effectiveType: connection?.effectiveType ?? null,
      downlinkMbps: connection?.downlink ?? null,
      roundTripTimeMs: connection?.rtt ?? null,
      saveData: connection?.saveData ?? null,
    },
    performance: {
      pageTimeOrigin: performance.timeOrigin,
      navigationType: navigation?.type ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      pageLoadMs: navigation?.loadEventEnd ?? null,
      transferredBytes: navigation?.transferSize ?? null,
      encodedBodyBytes: navigation?.encodedBodySize ?? null,
      decodedBodyBytes: navigation?.decodedBodySize ?? null,
    },
  }
}

export function buildScannerDiagnosticReport(
  input: ScannerDiagnosticInput,
  environment: ScannerDiagnosticEnvironment = collectScannerEnvironment(),
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      name: 'juan-nutrisyon-label-scanner',
      version: '0.1.0',
      ...environment.page,
    },
    browser: environment.browser,
    device: environment.device,
    display: environment.display,
    network: environment.network,
    performance: environment.performance,
    images: {
      original: {
        filename: input.originalFile.name,
        type: input.originalFile.type,
        bytes: input.originalFile.size,
        lastModified: new Date(input.originalFile.lastModified).toISOString(),
      },
      crop: {
        type: input.croppedBlob.type,
        bytes: input.croppedBlob.size,
        width: input.qualityMetrics?.width ?? null,
        height: input.qualityMetrics?.height ?? null,
        coordinatesInOriginal: input.cropCoordinates,
        ocrInputSize: input.result.sourceSize ?? null,
      },
    },
    quality: {
      metrics: input.qualityMetrics,
      warnings: input.qualityWarnings,
    },
    ocr: input.result,
  }
}

export function cropDownloadFilename(originalFilename: string, mimeType: string): string {
  const stem = originalFilename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'nutrition-label'
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  return `${stem}-ocr-crop.${extension}`
}
