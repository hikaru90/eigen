import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import TemporalTimelineFiltersPanel from './temporal-timeline-filters-panel.svelte'

describe('temporal-timeline-filters-panel.svelte', () => {
  it('renders Show completed checkbox', async () => {
    await render(TemporalTimelineFiltersPanel, {
      statusFilter: 'open',
      onStatusFilterChange: vi.fn(),
    })
    await expect.element(page.getByText('Show completed')).toBeInTheDocument()
    await expect.element(page.getByRole('checkbox')).toBeInTheDocument()
  })

  it('toggles status filter between all and open', async () => {
    const onStatusFilterChange = vi.fn()
    const screen = await render(TemporalTimelineFiltersPanel, {
      statusFilter: 'open',
      onStatusFilterChange,
    })

    const checkbox = page.getByRole('checkbox')
    await expect.element(checkbox).not.toBeChecked()

    // Dispatch a real change event on the input (more reliable than click under
    // controlled `checked={...}` props in Vitest browser).
    const input = checkbox.element() as HTMLInputElement
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onStatusFilterChange).toHaveBeenCalledWith('all')

    onStatusFilterChange.mockClear()
    await screen.rerender({
      statusFilter: 'all',
      onStatusFilterChange,
    })
    await expect.element(checkbox).toBeChecked()
    const checkedInput = checkbox.element() as HTMLInputElement
    checkedInput.checked = false
    checkedInput.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onStatusFilterChange).toHaveBeenCalledWith('open')
  })
})
