import type { StockMovementType } from '../types'
import type { SqlStatement } from '../database/tx'

/**
 * Every stock change in Sellix goes through these builders, so the product's quantity and its
 * inventory_transactions row are always written together (inside the caller's transaction).
 *
 * Movement types match inventory_transactions.type and inventoryApi's labels.
 */
export const MOVEMENT_TYPE = {
  STOCK_IN: 1,
  STOCK_OUT: 2,
  CORRECTION: 3,
} as const

export type MovementType = (typeof MOVEMENT_TYPE)[keyof typeof MOVEMENT_TYPE]

/**
 * One-tap reasons for a manual stock adjustment, by adjustment type (1 add, 2 remove, 3 set).
 * A reason is required; staff can still type their own.
 */
export const ADJUSTMENT_REASONS: Record<1 | 2 | 3, string[]> = {
  1: ['Delivery', 'Customer return', 'Found in stock', 'Correction'],
  2: ['Damaged', 'Expired', 'Lost / stolen', 'Used in store', 'Returned to supplier'],
  3: ['Stock count', 'Correction'],
}

export const MIN_ADJUSTMENT_REASON = 3

type MovementBase = {
  productId: number
  reason: string
  createdBy: string | null
  at: string
}

/**
 * Relative change (+ restock/return/void, - sale). The quantity recorded as "after" is read back
 * from the product inside the same transaction, so it is exact even if stock moved meanwhile.
 */
export function stockChangeStatements(
  movement: MovementBase & { delta: number; type?: MovementType },
): SqlStatement[] {
  const type = movement.type ?? (movement.delta >= 0 ? MOVEMENT_TYPE.STOCK_IN : MOVEMENT_TYPE.STOCK_OUT)
  return [
    {
      statement: `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?`,
      values: [movement.delta, movement.at, movement.productId],
    },
    {
      statement: `INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at)
         VALUES (?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), ?, ?, ?)`,
      values: [movement.productId, type, movement.delta, movement.productId, movement.reason, movement.createdBy, movement.at],
    },
  ]
}

/** Absolute correction (physical count): records the difference against the stock at write time, then sets it. */
export function stockSetStatements(movement: MovementBase & { quantity: number }): SqlStatement[] {
  return [
    {
      statement: `INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at)
         VALUES (?, ?, ? - (SELECT stock_quantity FROM products WHERE id = ?), ?, ?, ?, ?)`,
      values: [
        movement.productId,
        MOVEMENT_TYPE.CORRECTION,
        movement.quantity,
        movement.productId,
        movement.quantity,
        movement.reason,
        movement.createdBy,
        movement.at,
      ],
    },
    {
      statement: `UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?`,
      values: [movement.quantity, movement.at, movement.productId],
    },
  ]
}

/* ------------------------------------------------------------------
   INGREDIENTS & SUPPLIES (inventory_items / stock_movements)
------------------------------------------------------------------ */

/** stock_movements.type, with the label staff see. */
export const INGREDIENT_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  opening: 'Opening stock',
  stock_in: 'Stock in',
  stock_out: 'Stock out',
  sale: 'Sale',
  void: 'Sale voided',
  production: 'Used in batch',
  count: 'Physical count',
  waste: 'Waste',
  damaged: 'Damaged',
  expired: 'Expired',
  spoilage: 'Spoilage',
  correction: 'Correction',
  other: 'Other',
}

/** Kinds of loss recorded through "Record waste". */
export const WASTE_TYPES = ['waste', 'spoilage', 'expired', 'damaged'] as const satisfies readonly StockMovementType[]
export type WasteType = (typeof WASTE_TYPES)[number]

/** Manual adjustments and the direction each one moves stock (0 = either). */
export const ADJUSTMENT_TYPES: { type: StockMovementType; label: string; sign: 1 | -1 | 0; reasonRequired: boolean }[] = [
  { type: 'stock_in', label: 'Stock in', sign: 1, reasonRequired: false },
  { type: 'stock_out', label: 'Stock out', sign: -1, reasonRequired: true },
  { type: 'waste', label: 'Waste', sign: -1, reasonRequired: false },
  { type: 'spoilage', label: 'Spoilage', sign: -1, reasonRequired: false },
  { type: 'expired', label: 'Expired', sign: -1, reasonRequired: false },
  { type: 'damaged', label: 'Damaged', sign: -1, reasonRequired: false },
  { type: 'correction', label: 'Correction', sign: 0, reasonRequired: true },
  { type: 'other', label: 'Other', sign: 0, reasonRequired: true },
]

/** An item by id, or by a sub-select for a row inserted earlier in the same transaction. */
export type ItemRef = number | { sql: string; values: unknown[] }

type IngredientMovementBase = {
  inventoryItemId: ItemRef
  type: StockMovementType
  reason: string | null
  referenceType?: string | null
  referenceId?: string | null
  user: { id: string | number; fullName: string } | null
  at: string
}

function itemRef(item: ItemRef): { sql: string; values: unknown[] } {
  return typeof item === 'number' ? { sql: '?', values: [item] } : item
}

/**
 * Relative change to an ingredient (+ stock in, − sale/waste). The movement row records the
 * quantity before and after as read inside the same transaction, then on_hand moves. The table’s
 * CHECK (new = previous + quantity) and the not-negative trigger guard both.
 */
export function ingredientChangeStatements(movement: IngredientMovementBase & { delta: number }): SqlStatement[] {
  const id = itemRef(movement.inventoryItemId)
  const onHand = `(SELECT on_hand FROM inventory_items WHERE id = ${id.sql})`
  return [
    {
      statement: `INSERT INTO stock_movements (inventory_item_id, type, quantity, previous_quantity, new_quantity, unit_cost, reference_type, reference_id, reason, user_id, user_name, created_at)
         VALUES (${id.sql}, ?, ?, ${onHand}, ${onHand} + ?, (SELECT cost_per_base FROM inventory_items WHERE id = ${id.sql}), ?, ?, ?, ?, ?, ?)`,
      values: [
        ...id.values,
        movement.type,
        movement.delta,
        ...id.values,
        ...id.values,
        movement.delta,
        ...id.values,
        movement.referenceType ?? null,
        movement.referenceId ?? null,
        movement.reason,
        movement.user ? String(movement.user.id) : null,
        movement.user?.fullName ?? null,
        movement.at,
      ],
    },
    {
      statement: `UPDATE inventory_items SET on_hand = on_hand + ?, updated_at = ? WHERE id = ${id.sql}`,
      values: [movement.delta, movement.at, ...id.values],
    },
  ]
}

/** Absolute figure (physical count): the movement is the difference from what is on hand at write time. */
export function ingredientSetStatements(movement: IngredientMovementBase & { quantity: number }): SqlStatement[] {
  const id = itemRef(movement.inventoryItemId)
  const onHand = `(SELECT on_hand FROM inventory_items WHERE id = ${id.sql})`
  return [
    {
      statement: `INSERT INTO stock_movements (inventory_item_id, type, quantity, previous_quantity, new_quantity, unit_cost, reference_type, reference_id, reason, user_id, user_name, created_at)
         VALUES (${id.sql}, ?, ? - ${onHand}, ${onHand}, ?, (SELECT cost_per_base FROM inventory_items WHERE id = ${id.sql}), ?, ?, ?, ?, ?, ?)`,
      values: [
        ...id.values,
        movement.type,
        movement.quantity,
        ...id.values,
        ...id.values,
        movement.quantity,
        ...id.values,
        movement.referenceType ?? null,
        movement.referenceId ?? null,
        movement.reason,
        movement.user ? String(movement.user.id) : null,
        movement.user?.fullName ?? null,
        movement.at,
      ],
    },
    {
      statement: `UPDATE inventory_items SET on_hand = ?, updated_at = ? WHERE id = ${id.sql}`,
      values: [movement.quantity, movement.at, ...id.values],
    },
  ]
}
