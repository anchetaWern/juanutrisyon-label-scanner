import { describe, expect, it } from 'vitest'
import { buildScannerDiagnosticReport, cropDownloadFilename, type ScannerDiagnosticEnvironment } from './scannerDiagnostics'

const environment: ScannerDiagnosticEnvironment = {
  page: { origin: 'https://example.test', pathname: '/scanner', mode: 'test' },
  browser: { userAgent: 'Test Browser' },
  device: { maxTouchPoints: 5 },
  display: { viewportWidth: 390, viewportHeight: 844 },
  network: { online: true },
  performance: { pageLoadMs: 250 },
}

describe('scanner diagnostics', () => {
  it('creates a self-contained report without embedding image bytes', () => {
    const original = new File(['original'], 'My Label.JPG', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })
    const crop = new Blob(['crop'], { type: 'image/jpeg' })
    const report = buildScannerDiagnosticReport(
      {
        originalFile: original,
        croppedBlob: crop,
        cropCoordinates: { x: 10, y: 20, width: 900, height: 1200, rotate: 0, scaleX: 1, scaleY: 1 },
        qualityMetrics: {
          width: 900,
          height: 1200,
          meanLuminance: 120,
          clippedDarkRatio: 0,
          clippedHighlightRatio: 0.1,
          laplacianVariance: 80,
        },
        qualityWarnings: [],
        result: { text: 'Protein 7g', lines: [], engine: 'mock', sourceSize: { width: 900, height: 1200 } },
      },
      environment,
    )

    expect(report).toMatchObject({
      schemaVersion: 2,
      app: { origin: 'https://example.test', pathname: '/scanner', mode: 'test' },
      images: {
        original: { filename: 'My Label.JPG', type: 'image/jpeg', bytes: 8 },
        crop: { type: 'image/jpeg', bytes: 4, width: 900, height: 1200 },
      },
      ocr: { text: 'Protein 7g', engine: 'mock' },
      nutrition: { parserVersion: 'spatial-review-v2', data: { nutrients: { protein: null } } },
    })
    expect(JSON.stringify(report)).not.toContain('b3JpZ2luYWw=')
  })

  it('creates a safe crop download name', () => {
    expect(cropDownloadFilename('My Label (front).PNG', 'image/jpeg')).toBe('My-Label-front-ocr-crop.jpg')
  })
})
