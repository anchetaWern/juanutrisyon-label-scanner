import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScannerNutritionResult from './ScannerNutritionResult.vue'
import { parseNutrition } from '@/services/nutrition/parseNutrition'

describe('nutrition review output', () => {
  it('shows warnings and copies only the predictable nutrition schema', async () => {
    const extraction = parseNutrition({ text: '', lines: [], engine: 'test' })
    const wrapper = mount(ScannerNutritionResult, {
      props: { extraction },
      global: { stubs: { VBtn: { template: '<button><slot /></button>' }, VAlert: { template: '<aside><slot /></aside>' } } },
    })
    expect(wrapper.text()).toContain('review required')
    expect(wrapper.text()).toContain('Null means missing or ambiguous, not zero')
    expect(wrapper.find('pre').text()).toContain('"protein": null')
    expect(wrapper.findAll('li')).toHaveLength(extraction.issues.length)
    await wrapper.find('button').trigger('click')
    const emitted = wrapper.emitted('copy')![0]![0] as string
    expect(JSON.parse(emitted)).toEqual(extraction.data)
    expect(emitted).not.toContain('parserVersion')
  })
})
