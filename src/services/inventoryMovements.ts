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
