import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rows = [{ nutrient: 'protein', daily_value: 71, unit: 'g' }, { nutrient: 'sodium', daily_value: 1500, unit: 'mg' }]
beforeEach(() => { vi.resetModules(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('daily reference service', () => {
  it('deduplicates requests and retains the fixed population endpoint and units', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rows })
    vi.stubGlobal('fetch', fetch)
    const { loadDailyReferences, DAILY_REFERENCE_URL } = await import('./dailyReferences')
    const [first, second] = await Promise.all([loadDailyReferences(), loadDailyReferences()])
    expect(first).toEqual(second)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(DAILY_REFERENCE_URL)
    expect(DAILY_REFERENCE_URL).toContain('gender=male&age=19')
    expect(first.records.sodium).toMatchObject({ value: 1500, unit: 'mg' })
  })
  it('uses an identified valid cache during a later network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    await (await import('./dailyReferences')).loadDailyReferences()
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const cached = await (await import('./dailyReferences')).loadDailyReferences()
    expect(cached.cached).toBe(true)
    expect(cached.records.protein?.value).toBe(71)
  })
  it('rejects broken data and an expired cache without fabricating defaults', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ nutrient: 'protein', daily_value: -1, unit: 'g' }] }))
    const { loadDailyReferences, validateReferenceRows } = await import('./dailyReferences')
    expect(() => validateReferenceRows([])).toThrow()
    await expect(loadDailyReferences()).rejects.toThrow('could not be loaded')
    localStorage.setItem('jn-label-daily-reference:male:19:v1', JSON.stringify({ rows, fetchedAt: '2000-01-01T00:00:00Z' }))
    await expect(loadDailyReferences(true)).rejects.toThrow('could not be loaded')
  })
})
