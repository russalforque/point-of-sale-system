import type { Modifier, ModifierEffectRecord, ModifierGroup } from '../types'
import { querySQL } from '../database/sqlite'
import { runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import type { EffectAction } from '../services/recipes'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

/**
 * Modifier groups (Size, Milk, Add-ons, Sugar level) and their options. An option can change the
 * price, the ingredients used, or both. Options are never deleted once saved - sales refer to
 * them - so removing one from a group deactivates it.
 */

export type ModifierEffectInput = {
  action: EffectAction
  inventoryItemId: number | null
  replacementItemId?: number | null
  quantity?: number | null
  unitCode?: string | null
  scalePercent?: number | null
}

export type ModifierInput = {
  /** Existing option; omitted for a new one. */
  id?: number
  name: string
  priceDelta: number
  isDefault: boolean
  effects: ModifierEffectInput[]
}

export type ModifierGroupPayload = {
  name: string
  selection: 'single' | 'multiple'
  isRequired: boolean
  isActive: boolean
  modifiers: ModifierInput[]
  /** Products that offer this group. */
  productIds?: number[]
}

type GroupRow = { id: number; name: string; selection: string; is_required: number; is_active: number; sort: number; product_count: number }
type ModifierRow = { id: number; group_id: number; name: string; price_delta: number; is_default: number; is_active: number; sort: number }
type EffectRow = {
  id: number
  modifier_id: number
  action: EffectAction
  inventory_item_id: number | null
  replacement_item_id: number | null
  quantity: number | null
  unit_code: string | null
  scale_percent: number | null
}

function inList(ids: number[]): string {
  return ids.map(() => '?').join(', ')
}

async function effectsFor(modifierIds: number[]): Promise<Map<number, ModifierEffectRecord[]>> {
  const map = new Map<number, ModifierEffectRecord[]>()
  if (modifierIds.length === 0) return map
  const result = await querySQL(`SELECT * FROM modifier_inventory_effects WHERE modifier_id IN (${inList(modifierIds)}) ORDER BY id`, modifierIds)
  for (const row of (result.values ?? []) as EffectRow[]) {
    const list = map.get(row.modifier_id) ?? []
    list.push({
      action: row.action,
      inventoryItemId: row.inventory_item_id,
      replacementItemId: row.replacement_item_id,
      quantity: row.quantity,
      unitCode: row.unit_code,
      scalePercent: row.scale_percent,
    })
    map.set(row.modifier_id, list)
  }
  return map
}

function toModifier(row: ModifierRow, effects: ModifierEffectRecord[] = []): Modifier {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    priceDelta: row.price_delta,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    effects,
  }
}

async function buildGroups(rows: GroupRow[], includeInactiveOptions = false): Promise<ModifierGroup[]> {
  if (rows.length === 0) return []
  const groupIds = rows.map((row) => row.id)
  const modifierResult = await querySQL(
    `SELECT * FROM modifiers WHERE group_id IN (${inList(groupIds)}) ${includeInactiveOptions ? '' : 'AND is_active = 1'} ORDER BY sort, id`,
    groupIds,
  )
  const modifierRows = (modifierResult.values ?? []) as ModifierRow[]
  const effects = await effectsFor(modifierRows.map((row) => row.id))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    selection: row.selection === 'multiple' ? 'multiple' : 'single',
    isRequired: Boolean(row.is_required),
    isActive: Boolean(row.is_active),
    productCount: row.product_count ?? 0,
    modifiers: modifierRows.filter((modifier) => modifier.group_id === row.id).map((modifier) => toModifier(modifier, effects.get(modifier.id))),
  }))
}

const GROUP_SELECT = `
  SELECT g.id, g.name, g.selection, g.is_required, g.is_active, g.sort,
         (SELECT COUNT(*) FROM product_modifier_groups pmg JOIN products p ON p.id = pmg.product_id
           WHERE pmg.group_id = g.id AND p.is_active = 1) AS product_count
  FROM modifier_groups g
`

function validateEffect(effect: ModifierEffectInput, optionName: string): void {
  const where = `“${optionName}”`
  switch (effect.action) {
    case 'add':
      if (!effect.inventoryItemId) throw new ApiError(`Choose the ingredient ${where} uses.`, 400)
      if (!effect.quantity || !Number.isInteger(effect.quantity) || effect.quantity <= 0) throw new ApiError(`Enter how much ${where} uses.`, 400)
      return
    case 'remove':
      if (!effect.inventoryItemId) throw new ApiError(`Choose the ingredient ${where} leaves out.`, 400)
      return
    case 'replace':
      if (!effect.inventoryItemId || !effect.replacementItemId) throw new ApiError(`Choose both ingredients for the swap in ${where}.`, 400)
      if (effect.inventoryItemId === effect.replacementItemId) throw new ApiError(`${where} swaps an ingredient for itself.`, 400)
      if (effect.quantity != null && (!Number.isInteger(effect.quantity) || effect.quantity <= 0)) throw new ApiError(`Enter a valid amount for ${where}.`, 400)
      return
    case 'scale':
      if (effect.scalePercent == null || !Number.isInteger(effect.scalePercent) || effect.scalePercent < 0 || effect.scalePercent > 1000) {
        throw new ApiError(`Enter a percentage from 0 to 1000 for ${where}.`, 400)
      }
      return
    default:
      throw new ApiError(`Choose what ${where} does to the ingredients.`, 400)
  }
}

function validate(payload: ModifierGroupPayload): void {
  if (!payload.name.trim()) throw new ApiError('Enter the group name, e.g. Size or Milk.', 400)
  if (payload.selection !== 'single' && payload.selection !== 'multiple') throw new ApiError('Choose how many options can be picked.', 400)
  const active = payload.modifiers.filter((modifier) => modifier.name.trim())
  if (active.length === 0) throw new ApiError('Add at least one option.', 400)
  const names = new Set<string>()
  for (const modifier of payload.modifiers) {
    const name = modifier.name.trim()
    if (!name) throw new ApiError('Every option needs a name.', 400)
    if (names.has(name.toLowerCase())) throw new ApiError(`“${name}” is listed twice.`, 400)
    names.add(name.toLowerCase())
    if (!Number.isFinite(modifier.priceDelta) || Math.abs(modifier.priceDelta) > 1_000_000) throw new ApiError(`Enter a valid price for “${name}”.`, 400)
    for (const effect of modifier.effects) validateEffect(effect, name)
  }
  if (payload.selection === 'single' && payload.modifiers.filter((modifier) => modifier.isDefault).length > 1) {
    throw new ApiError('Only one option can be pre-selected when customers pick one.', 400)
  }
}

async function assertItemsExist(payload: ModifierGroupPayload): Promise<void> {
  const ids = new Set<number>()
  for (const modifier of payload.modifiers) {
    for (const effect of modifier.effects) {
      if (effect.inventoryItemId) ids.add(effect.inventoryItemId)
      if (effect.replacementItemId) ids.add(effect.replacementItemId)
    }
  }
  if (ids.size === 0) return
  const list = Array.from(ids)
  const result = await querySQL(`SELECT id FROM inventory_items WHERE is_active = 1 AND id IN (${inList(list)})`, list)
  if ((result.values ?? []).length !== list.length) throw new ApiError('An ingredient used by these options no longer exists or is inactive.', 400)
}

function effectStatements(modifierIdSql: string, modifierIdValues: unknown[], effects: ModifierEffectInput[]): SqlStatement[] {
  return effects.map((effect) => ({
    statement: `INSERT INTO modifier_inventory_effects (modifier_id, action, inventory_item_id, replacement_item_id, quantity, unit_code, scale_percent)
       VALUES (${modifierIdSql}, ?, ?, ?, ?, ?, ?)`,
    values: [
      ...modifierIdValues,
      effect.action,
      effect.inventoryItemId ?? null,
      effect.action === 'replace' ? effect.replacementItemId ?? null : null,
      effect.action === 'add' || effect.action === 'replace' ? effect.quantity ?? null : null,
      effect.unitCode ?? null,
      effect.action === 'scale' ? effect.scalePercent ?? null : null,
    ],
  }))
}

/**
 * Statements that write a group's options. Existing options are updated in place (sales keep
 * pointing at them); options no longer listed are deactivated; new ones are inserted.
 */
function optionStatements(groupIdSql: string, groupIdValues: unknown[], payload: ModifierGroupPayload, existing: Modifier[]): SqlStatement[] {
  const statements: SqlStatement[] = []
  const keptIds = new Set(payload.modifiers.map((modifier) => modifier.id).filter((id): id is number => Boolean(id)))
  for (const old of existing) {
    if (!keptIds.has(old.id) && old.isActive) {
      statements.push({ statement: `UPDATE modifiers SET is_active = 0, is_default = 0 WHERE id = ?`, values: [old.id] })
    }
  }
  payload.modifiers.forEach((modifier, index) => {
    const values = [modifier.name.trim(), roundMoney(modifier.priceDelta), modifier.isDefault ? 1 : 0, index]
    if (modifier.id && existing.some((old) => old.id === modifier.id)) {
      statements.push(
        { statement: `UPDATE modifiers SET name = ?, price_delta = ?, is_default = ?, sort = ?, is_active = 1 WHERE id = ?`, values: [...values, modifier.id] },
        { statement: `DELETE FROM modifier_inventory_effects WHERE modifier_id = ?`, values: [modifier.id] },
        ...effectStatements('?', [modifier.id], modifier.effects),
      )
    } else {
      statements.push({
        statement: `INSERT INTO modifiers (group_id, name, price_delta, is_default, sort, is_active) VALUES (${groupIdSql}, ?, ?, ?, ?, 1)`,
        values: [...groupIdValues, ...values],
      })
      // Just inserted, so it is the newest option of this group with this name.
      const newIdSql = `(SELECT id FROM modifiers WHERE group_id = ${groupIdSql} AND name = ? ORDER BY id DESC LIMIT 1)`
      statements.push(...effectStatements(newIdSql, [...groupIdValues, modifier.name.trim()], modifier.effects))
    }
  })
  return statements
}

function productStatements(groupIdSql: string, groupIdValues: unknown[], productIds: number[] | undefined): SqlStatement[] {
  if (!productIds) return []
  return [
    { statement: `DELETE FROM product_modifier_groups WHERE group_id = ${groupIdSql}`, values: [...groupIdValues] },
    ...Array.from(new Set(productIds)).map((productId) => ({
      statement: `INSERT INTO product_modifier_groups (product_id, group_id, sort) VALUES (?, ${groupIdSql}, (SELECT COUNT(*) FROM product_modifier_groups WHERE product_id = ?))`,
      values: [productId, ...groupIdValues, productId],
    })),
  ]
}

function describeOptions(payload: ModifierGroupPayload, symbol: string): string {
  return payload.modifiers
    .map((modifier) => `${modifier.name.trim()}${modifier.priceDelta ? ` ${modifier.priceDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(modifier.priceDelta), symbol)}` : ''}`)
    .join(', ')
}

export const modifierApi = {
  /** All groups with their active options (Modifiers page, product form). */
  list: async (params: { includeInactive?: boolean } = {}): Promise<ModifierGroup[]> => {
    const result = await querySQL(`${GROUP_SELECT} ${params.includeInactive ? '' : 'WHERE g.is_active = 1'} ORDER BY g.is_active DESC, g.sort, g.name`)
    return buildGroups((result.values ?? []) as GroupRow[])
  },

  get: async (id: number): Promise<ModifierGroup> => {
    const result = await querySQL(`${GROUP_SELECT} WHERE g.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as GroupRow | undefined
    if (!row) throw new ApiError('Modifier group not found.', 404)
    return (await buildGroups([row]))[0]!
  },

  /** Active groups a product offers, in the order the cashier sees them. */
  forProduct: async (productId: number): Promise<ModifierGroup[]> => {
    const result = await querySQL(
      `${GROUP_SELECT} JOIN product_modifier_groups pg ON pg.group_id = g.id
       WHERE pg.product_id = ? AND g.is_active = 1 ORDER BY pg.sort, g.name`,
      [productId],
    )
    return buildGroups((result.values ?? []) as GroupRow[])
  },

  /** Product ids that offer a group (for the group editor). */
  productIds: async (groupId: number): Promise<number[]> => {
    const result = await querySQL(`SELECT product_id FROM product_modifier_groups WHERE group_id = ?`, [groupId])
    return ((result.values ?? []) as { product_id: number }[]).map((row) => row.product_id)
  },

  /** Options by id with their group names (resuming a held order). Inactive options are left out. */
  byIds: async (ids: number[]): Promise<(Modifier & { groupName: string })[]> => {
    if (ids.length === 0) return []
    const result = await querySQL(
      `SELECT m.*, g.name AS group_name FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id
       WHERE m.id IN (${inList(ids)}) AND m.is_active = 1 AND g.is_active = 1`,
      ids,
    )
    const rows = (result.values ?? []) as (ModifierRow & { group_name: string })[]
    const effects = await effectsFor(rows.map((row) => row.id))
    return rows.map((row) => ({ ...toModifier(row, effects.get(row.id)), groupName: row.group_name }))
  },

  create: async (payload: ModifierGroupPayload): Promise<ModifierGroup> => {
    const actor = await requirePermission('products.manage')
    validate(payload)
    await assertItemsExist(payload)
    const now = new Date().toISOString()
    const name = payload.name.trim()
    const groupIdSql = `(SELECT id FROM modifier_groups WHERE name = ? AND created_at = ? ORDER BY id DESC LIMIT 1)`
    const groupIdValues = [name, now]
    const symbol = (await settingsApi.get()).currencySymbol
    await runTransaction([
      {
        statement: `INSERT INTO modifier_groups (name, selection, is_required, sort, is_active, created_at, updated_at)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM modifier_groups), ?, ?, ?)`,
        values: [name, payload.selection, payload.isRequired ? 1 : 0, payload.isActive ? 1 : 0, now, now],
      },
      ...optionStatements(groupIdSql, groupIdValues, payload, []),
      ...productStatements(groupIdSql, groupIdValues, payload.productIds),
      auditStatement('modifier', `Added options “${name}”: ${describeOptions(payload, symbol)}`, { type: 'modifier_group', id: name }, actor, now),
    ])
    const created = await querySQL(`SELECT id FROM modifier_groups WHERE name = ? AND created_at = ? ORDER BY id DESC LIMIT 1`, groupIdValues)
    const id = created.values?.[0]?.id as number | undefined
    if (!id) throw new ApiError('Failed to save the options.', 500)
    return modifierApi.get(id)
  },

  update: async (id: number, payload: ModifierGroupPayload): Promise<ModifierGroup> => {
    const actor = await requirePermission('products.manage')
    validate(payload)
    await assertItemsExist(payload)
    const existing = await querySQL(`${GROUP_SELECT} WHERE g.id = ? LIMIT 1`, [id])
    const row = existing.values?.[0] as GroupRow | undefined
    if (!row) throw new ApiError('Modifier group not found.', 404)
    const before = (await buildGroups([row], true))[0]!
    const now = new Date().toISOString()
    const symbol = (await settingsApi.get()).currencySymbol
    await runTransaction([
      {
        statement: `UPDATE modifier_groups SET name = ?, selection = ?, is_required = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        values: [payload.name.trim(), payload.selection, payload.isRequired ? 1 : 0, payload.isActive ? 1 : 0, now, id],
      },
      ...optionStatements('?', [id], payload, before.modifiers),
      ...productStatements('?', [id], payload.productIds),
      auditStatement(
        'modifier',
        `Options “${payload.name.trim()}” updated${payload.isActive !== before.isActive ? (payload.isActive ? ' (reactivated)' : ' (turned off)') : ''}: ${describeOptions(payload, symbol)}`,
        { type: 'modifier_group', id },
        actor,
        now,
      ),
    ])
    return modifierApi.get(id)
  },

  /** Turns a group off everywhere; sales that used it keep their record. */
  deactivate: async (id: number): Promise<void> => {
    const actor = await requirePermission('products.manage')
    const group = await modifierApi.get(id)
    await runTransaction([
      { statement: `UPDATE modifier_groups SET is_active = 0, updated_at = ? WHERE id = ?`, values: [new Date().toISOString(), id] },
      auditStatement('modifier', `Options “${group.name}” turned off`, { type: 'modifier_group', id }, actor),
    ])
  },
}
