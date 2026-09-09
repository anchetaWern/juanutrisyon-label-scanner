import { vi } from 'vitest'

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: vi.fn(() => 'blob:test-image'),
})

Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: vi.fn(),
})
