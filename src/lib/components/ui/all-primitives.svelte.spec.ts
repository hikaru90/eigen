import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import Button from './button/button.svelte'
import CardAction from './card/card-action.svelte'
import CardContent from './card/card-content.svelte'
import CardDescription from './card/card-description.svelte'
import CardFooter from './card/card-footer.svelte'
import CardHeader from './card/card-header.svelte'
import CardTitle from './card/card-title.svelte'
import Card from './card/card.svelte'
import Input from './input/input.svelte'
import Label from './label/label.svelte'
import PopoverClose from './popover/popover-close.svelte'
import PopoverContent from './popover/popover-content.svelte'
import PopoverDescription from './popover/popover-description.svelte'
import PopoverHeader from './popover/popover-header.svelte'
import PopoverPortal from './popover/popover-portal.svelte'
import PopoverTitle from './popover/popover-title.svelte'
import PopoverTrigger from './popover/popover-trigger.svelte'
import Popover from './popover/popover.svelte'
import SelectContent from './select/select-content.svelte'
import SelectGroupHeading from './select/select-group-heading.svelte'
import SelectGroup from './select/select-group.svelte'
import SelectItem from './select/select-item.svelte'
import SelectLabel from './select/select-label.svelte'
import SelectPortal from './select/select-portal.svelte'
import SelectScrollDownButton from './select/select-scroll-down-button.svelte'
import SelectScrollUpButton from './select/select-scroll-up-button.svelte'
import SelectSeparator from './select/select-separator.svelte'
import SelectTrigger from './select/select-trigger.svelte'
import Select from './select/select.svelte'
import Separator from './separator/separator.svelte'
import Textarea from './textarea/textarea.svelte'

describe('ui primitives', () => {
  it('renders simple primitives with class passthrough', async () => {
    render(Button, { class: 't-btn' })
    render(Label, { class: 't-label' })
    render(Input, { class: 't-input' })
    render(Textarea, { class: 't-textarea' })
    render(Separator, { class: 't-separator' })
    render(Card, { class: 't-card' })
    render(CardHeader, { class: 't-card-header' })
    render(CardTitle, { class: 't-card-title' })
    render(CardDescription, { class: 't-card-description' })
    render(CardContent, { class: 't-card-content' })
    render(CardAction, { class: 't-card-action' })
    render(CardFooter, { class: 't-card-footer' })
    await expect.element(page.locator('.t-btn')).toBeInTheDocument()
    await expect.element(page.locator('.t-label')).toBeInTheDocument()
    await expect.element(page.locator('.t-input')).toBeInTheDocument()
    await expect.element(page.locator('.t-textarea')).toBeInTheDocument()
  })

  it('imports popover/select primitives and mounts roots', async () => {
    render(Popover, { open: false })
    render(PopoverTrigger, { class: 't-popover-trigger' })
    render(PopoverContent, { class: 't-popover-content' })
    render(PopoverTitle, { class: 't-popover-title' })
    render(PopoverDescription, { class: 't-popover-description' })
    render(PopoverHeader, { class: 't-popover-header' })
    render(PopoverClose, { class: 't-popover-close' })
    render(PopoverPortal)

    render(Select, { open: false, value: 'a' })
    render(SelectTrigger, { class: 't-select-trigger' })
    render(SelectContent, { class: 't-select-content' })
    render(SelectItem, { value: 'a', class: 't-select-item' })
    render(SelectLabel, { class: 't-select-label' })
    render(SelectGroup)
    render(SelectGroupHeading, { class: 't-select-group-heading' })
    render(SelectSeparator, { class: 't-select-separator' })
    render(SelectScrollUpButton, { class: 't-select-scroll-up' })
    render(SelectScrollDownButton, { class: 't-select-scroll-down' })
    render(SelectPortal)

    await expect.element(page.locator('body')).toBeInTheDocument()
  })
})
