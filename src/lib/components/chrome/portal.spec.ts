// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { portal } from './portal'

describe('portal', () => {
  it('moves the node out of its container to document.body and removes it on destroy', () => {
    const main = document.createElement('main')
    const node = document.createElement('div')
    main.appendChild(node)
    document.body.appendChild(main)

    const action = portal(node)
    expect(node.parentElement).toBe(document.body)
    expect(main.contains(node)).toBe(false)

    action.destroy()
    expect(node.isConnected).toBe(false)
    main.remove()
  })
})
