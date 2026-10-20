import { useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { modifierApi } from '../../api/modifierApi'
import { Badge } from '../../components/ui/Badge'
import { Plus } from '../../components/ui/Icons'
import { PrimaryButton } from '../../components/ui/MobileKit'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, WorkPage } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { ModifierGroup } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { emptyGroup, groupToDraft, ModifierGroupEditor, TEMPLATES, type GroupDraft } from './ModifierGroupEditor'

/** Option groups the cashier picks from at the register: Size, Milk, Add-ons, Sugar level. */
export function ModifiersPage() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const groups = useAsync(() => modifierApi.list({ includeInactive: true }), [])
  const [editor, setEditor] = useState<{ group: ModifierGroup | null; draft: GroupDraft } | null>(null)
  const [opening, setOpening] = useState<number | null>(null)

  async function edit(group: ModifierGroup) {
    setOpening(group.id)
    try {
      // Inactive options are left out of the editor: saving keeps them inactive.
      const [full, productIds, ingredients] = await Promise.all([modifierApi.get(group.id), modifierApi.productIds(group.id), ingredientApi.all()])
      setEditor({ group: full, draft: groupToDraft(full, productIds, ingredients) })
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setOpening(null)
    }
  }

  const list = groups.data ?? []

  return (
    <WorkPage
      title="Options"
      subtitle="Sizes, milks, add-ons and sugar levels the cashier picks when adding a drink."
      actions={
        <PrimaryButton onClick={() => setEditor({ group: null, draft: emptyGroup() })} className="h-12 flex-none px-5">
          <Plus size={11} />
          New group
        </PrimaryButton>
      }
    >
      <div className="mt-5 space-y-4">
        {groups.loading && !groups.data && (
          <div className="py-12">
            <Spinner />
          </div>
        )}
        {groups.error && <ErrorState message={groups.error} onRetry={() => void groups.reload()} />}

        {groups.data && list.length === 0 && (
          <Panel>
            <div className="py-6 text-center">
              <EmptyState title="No options yet" hint="Start from a common group, then link its options to ingredients and products." />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={() => setEditor({ group: null, draft: template.draft() })}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#E6F1EA] px-4 text-sm font-semibold text-[#1F5E3B] hover:bg-[#D3E6DB]"
                  >
                    <Plus size={10} />
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {list.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => void edit(group)}
              disabled={opening !== null}
              className="flex flex-col rounded-2xl bg-white p-4 text-left ring-1 ring-slate-100 transition hover:ring-slate-300 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-base font-semibold ${group.isActive ? '' : 'text-slate-400'}`}>{group.name}</p>
                  <p className="text-sm text-slate-500">
                    {group.selection === 'single' ? 'Pick one' : 'Pick any'}
                    {group.isRequired ? ' · required' : ''} · on {group.productCount} {group.productCount === 1 ? 'product' : 'products'}
                  </p>
                </div>
                {!group.isActive ? (
                  <Badge tone="gray">Off</Badge>
                ) : opening === group.id ? (
                  <span aria-label="Opening" className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#E6F1EA] border-t-[#1F5E3B]" />
                ) : null}
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {group.modifiers.map((modifier) => (
                  <li key={modifier.id} className="rounded-full bg-[#F3F5F4] px-3 py-1.5 text-sm">
                    {modifier.name}
                    {modifier.priceDelta !== 0 && (
                      <span className="tabular-nums text-slate-500">
                        {' '}
                        {modifier.priceDelta > 0 ? '+' : '−'}
                        {money(Math.abs(modifier.priceDelta))}
                      </span>
                    )}
                    {modifier.effects.length > 0 && <span className="text-[#1F5E3B]"> · stock</span>}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        {list.length > 0 && (
          <p className="text-sm text-slate-500">
            Options marked “stock” change the ingredients used, e.g. Extra Shot uses 18 g more beans, Oat Milk replaces fresh milk.
          </p>
        )}
      </div>

      {editor && (
        <ModifierGroupEditor group={editor.group} initial={editor.draft} onClose={() => setEditor(null)} onSaved={() => void groups.reload()} />
      )}
    </WorkPage>
  )
}
