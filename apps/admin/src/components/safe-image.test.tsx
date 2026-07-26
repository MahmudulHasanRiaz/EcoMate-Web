import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { SafeImage } from './safe-image'

const original =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" width="1" height="1"/></svg>'
const derivative =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue" width="1" height="1"/></svg>'
const replacement =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="yellow" width="1" height="1"/></svg>'
const replacementDerivative =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="purple" width="1" height="1"/></svg>'
const blur =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="green" width="1" height="1"/></svg>'

async function failImage(image: HTMLImageElement) {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const event = new Event('error', { cancelable: true })
  event.preventDefault()
  try {
    await act(async () => {
      image.dispatchEvent(event)
    })
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
  }
}

describe('SafeImage', () => {
  it('falls back from a failed derivative to the original before the blur image', async () => {
    const view = await render(
      <SafeImage
        src={original}
        alt='Product'
        variant='small'
        derivativeManifest={{ small: derivative }}
        blurUrl={blur}
      />
    )
    const image = () => view.container.querySelector('img') as HTMLImageElement

    expect(image().getAttribute('src')).toBe(derivative)

    await failImage(image())
    expect(image().getAttribute('src')).toBe(original)

    await failImage(image())
    expect(image().getAttribute('src')).toBe(blur)
  })

  it('resets the failure state when the resolved source changes', async () => {
    const view = await render(
      <SafeImage
        src={original}
        alt='Product'
        variant='small'
        derivativeManifest={{ small: derivative }}
        blurUrl={blur}
      />
    )
    const image = () => view.container.querySelector('img') as HTMLImageElement

    await failImage(image())
    await failImage(image())
    expect(image().getAttribute('src')).toBe(blur)

    await view.rerender(
      <SafeImage
        src={replacement}
        alt='Product'
        variant='small'
        derivativeManifest={{ small: replacementDerivative }}
        blurUrl={blur}
      />
    )

    expect(image().getAttribute('src')).toBe(replacementDerivative)
  })
})
