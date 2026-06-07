import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SectionShell } from './section-shell'

describe('SectionShell', () => {
  it('renders title and description', async () => {
    const { getByText } = await render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={false}
        isSaving={false}
        dirtyCount={0}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await expect.element(getByText('Store Identity')).toBeInTheDocument()
    await expect.element(getByText('Basic info')).toBeInTheDocument()
    await expect.element(getByText('child')).toBeInTheDocument()
  })

  it('shows save bar when dirty', async () => {
    const { getByText } = await render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={true}
        isSaving={false}
        dirtyCount={2}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await expect.element(getByText('2 unsaved changes')).toBeInTheDocument()
    await expect.element(getByText('Save Section')).toBeInTheDocument()
  })

  it('does not render save bar when pristine', async () => {
    const { getByText } = await render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={false}
        isSaving={false}
        dirtyCount={0}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await expect.element(getByText('child')).toBeInTheDocument()
    await expect.element(getByText('Save Section')).not.toBeInTheDocument()
  })

  it('calls onSave when Save Section is clicked', async () => {
    const onSave = vi.fn()
    const { getByText } = await render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={true}
        isSaving={false}
        dirtyCount={1}
        lastSavedAt={null}
        onSave={onSave}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await getByText('Save Section').click()
    expect(onSave).toHaveBeenCalledOnce()
  })
})
