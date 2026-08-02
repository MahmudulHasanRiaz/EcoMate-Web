import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { TemplatePageForm } from './template-page-form'
import { templatePageSchemas, type TemplatePageSchema } from './template-schemas'

vi.mock('@/components/media-picker', () => ({
  MediaPicker: () => null,
}))

describe('TemplatePageForm', () => {
  it('renders an object field as a single object with its sub-fields', async () => {
    const onChange = vi.fn()
    const { getByText } = await render(
      <TemplatePageForm
        schema={templatePageSchemas.careers}
        config={{ hero: { title: 'WE ARE HIRING.', subtitle: '', image: '' } }}
        onChange={onChange}
      />
    )

    await expect.element(getByText('Hero Title')).toBeInTheDocument()
    await expect.element(getByText('Hero Subtitle')).toBeInTheDocument()
    await expect.element(getByText('Apply Email')).toBeInTheDocument()
    await expect.element(getByText('Apply Button Text')).toBeInTheDocument()
  })

  it('edits a plain text field and emits the new config', async () => {
    const onChange = vi.fn()
    const schema: TemplatePageSchema = {
      key: 't',
      slug: 't',
      title: 'T',
      description: '',
      fields: [{ key: 'note', label: 'Note', type: 'text' }],
    }
    const { getByRole } = await render(
      <TemplatePageForm schema={schema} config={{ note: '' }} onChange={onChange} />
    )

    await userEvent.fill(getByRole('textbox'), 'hello')
    expect(onChange).toHaveBeenCalledWith({ note: 'hello' })
  })

  it('adds a blank item to an array field', async () => {
    const onChange = vi.fn()
    const { getByRole } = await render(
      <TemplatePageForm
        schema={templatePageSchemas.careers}
        config={{ jobs: [] }}
        onChange={onChange}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Add Job' }))
    expect(onChange).toHaveBeenCalledWith({
      jobs: [
        { title: '', department: '', location: '', type: '', salary: '', description: '' },
      ],
    })
  })

  it('adds a blank string to a stringArray field', async () => {
    const onChange = vi.fn()
    const { getByRole } = await render(
      <TemplatePageForm
        schema={templatePageSchemas.careers}
        config={{ benefits: [] }}
        onChange={onChange}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Add Benefit' }))
    expect(onChange).toHaveBeenCalledWith({ benefits: [''] })
  })
})
