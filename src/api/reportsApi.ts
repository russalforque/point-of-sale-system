import type { ReorderSuggestion } from '../types'
import { querySQL } from '../database/sqlite'
import { inventoryApi } from './inventoryApi'
import { requirePermission } from '../services/authz'
import { methodLabel } from '../services/payments'
import { roundMoney } from '../utils/amount'

/**
 * Business reports, computed by SQLite on the device (no server). Figures follow what a store
 * owner expects to see:
 *
 *   Gross sales      = item prices before discounts and tax (completed sales in the period)
 *   Net sales        = gross sales − discounts − refunds (refunds without their tax)
 *   Cost of goods    = cost of items sold − cost of returned items put back on the shelf
 *   Gross profit     = net sales − cost of goods
 *   Net profit (est) = gross profit − expenses
 *
 * Sales use their sale date, refunds their refund date and expenses their expense date.
 * Voided sales are excluded everywhere and reported separately.
 */

export type ReportRange = {
  /** Local start of the first day, or null for "since the beginning". */
  start: Date | null
  /** Local start of the day after the last one (exclusive), or null for "until now". */
  end: Date | null
}

export type ProductPerformance = {
  productId: number
  name: string
  categoryName: string
  quantity: number
  revenue: number
  cost: number
  profit: number
}

export type GroupPerformance = { name: string; count: number; quantity: number; revenue: number; cost: number; profit: number }

export type SlowMover = { productId: number; name: string; stockQuantity: number; stockValue: number; quantitySold: number }

export type BusinessReport = {
  grossSales: number
  discounts: number
  seniorDiscounts: number
  loyaltyRedeemed: number
  refunds: number
  refundsExTax: number
  netSales: number
  taxCollected: number
  totalCollected: number
  costOfGoods: number
  grossProfit: number
  grossMargin: number | null
  expenses: number
  netProfit: number
  transactions: number
  averageTransaction: number
  itemsSold: number
  voidedCount: number
  voidedAmount: number
  bestSellers: ProductPerformance[]
  topProfit: ProductPerformance[]
  slowMovers: SlowMover[]
  byCategory: GroupPerformance[]
  byCashier: { name: string; count: number; total: number }[]
  byPaymentMethod: { method: number; label: string; count: number; amount: number }[]
  expensesByCategory: { name: string; amount: number; count: number }[]
  inventory: {
    costValue: number
    retailValue: number
    products: number
    lowStock: number
    outOfStock: number
    /** Ingredients and supplies on hand, at cost. */
    ingredientValue: number
    /** Ingredients at or below their low-stock level. */
    ingredientAlerts: number
  }
  lowStock: ReorderSuggestion[]
  receivables: { total: number; customers: number }
}

function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** WHERE fragment on an ISO timestamp column for the range. */
function timeWindow(column: string, range: ReportRange): { sql: string; values: string[] } {
  const parts: string[] = []
  const values: string[] = []
  if (range.start) {
    parts.push(`${column} >= ?`)
    values.push(range.start.toISOString())
  }
  if (range.end) {
    parts.push(`${column} < ?`)
    values.push(range.end.toISOString())
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', values }
}

/** Same for yyyy-mm-dd date columns (expenses), with an inclusive last day. */
function dateWindow(column: string, range: ReportRange): { sql: string; values: string[] } {
  const parts: string[] = []
  const values: string[] = []
  if (range.start) {
    parts.push(`${column} >= ?`)
    values.push(localDateKey(range.start))
  }
  if (range.end) {
    parts.push(`${column} < ?`)
    values.push(localDateKey(range.end))
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', values }
}

async function one<T>(sql: string, values: unknown[] = []): Promise<T> {
  const result = await querySQL(sql, values)
  return (result.values?.[0] ?? {}) as T
}

async function many<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await querySQL(sql, values)
  return (result.values ?? []) as T[]
}

/** A sale line's share of what the customer actually paid before tax (sale-level discounts spread by value). */
const LINE_NET = `si.line_total * CASE WHEN s.subtotal > 0 THEN (s.subtotal - s.discount) / s.subtotal ELSE 0 END`

type ProductRow = { productId: number; name: string | null; categoryName: string | null; quantity: number; revenue: number; cost: number }

function toPerformance(row: ProductRow): ProductPerformance {
  const revenue = roundMoney(row.revenue ?? 0)
  const cost = roundMoney(row.cost ?? 0)
  return {
    productId: row.productId,
    name: row.name ?? 'Unknown product',
    categoryName: row.categoryName ?? 'Uncategorized',
    quantity: row.quantity ?? 0,
    revenue,
    cost,
    profit: roundMoney(revenue - cost),
  }
}

export const reportsApi = {
  business: async (range: ReportRange): Promise<BusinessReport> => {
    await requirePermission('reports.view')
    const sales = timeWindow('s.created_at', range)
    const refunds = timeWindow('r.created_at', range)
    const expenseDates = dateWindow('expense_date', range)

    const [salesTotals, voided, refundTotals, returnedCost, soldCost, expenseTotal, expenseRows] = await Promise.all([
      one<{ gross: number; discounts: number; senior: number; loyalty: number; tax: number; collected: number; count: number }>(
        `SELECT COALESCE(SUM(subtotal), 0) AS gross, COALESCE(SUM(discount), 0) AS discounts,
                COALESCE(SUM(CASE WHEN discount_type = 'senior_pwd' THEN discount - COALESCE(loyalty_discount, 0) ELSE 0 END), 0) AS senior,
                COALESCE(SUM(COALESCE(loyalty_discount, 0)), 0) AS loyalty,
                COALESCE(SUM(tax), 0) AS tax, COALESCE(SUM(total), 0) AS collected, COUNT(*) AS count
         FROM sales s WHERE s.status = 1 AND ${sales.sql}`,
        sales.values,
      ),
      one<{ count: number; amount: number }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount FROM sales s WHERE s.status = 2 AND ${sales.sql}`,
        sales.values,
      ),
      // A refund's tax share is the same fraction of it as tax was of its sale.
      one<{ amount: number; exTax: number }>(
        `SELECT COALESCE(SUM(r.amount), 0) AS amount,
                COALESCE(SUM(CASE WHEN s.total > 0 THEN r.amount * (s.total - s.tax) / s.total ELSE 0 END), 0) AS exTax
         FROM refunds r JOIN sales s ON s.id = r.sale_id WHERE ${refunds.sql}`,
        refunds.values,
      ),
      one<{ cost: number }>(
        `SELECT COALESCE(SUM(ri.quantity * COALESCE(si.unit_cost, 0)), 0) AS cost
         FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
         LEFT JOIN sale_items si ON si.id = COALESCE(ri.sale_item_id,
           (SELECT si2.id FROM sale_items si2 WHERE si2.sale_id = r.sale_id AND si2.product_id = ri.product_id LIMIT 1))
         WHERE r.restocked = 1 AND COALESCE(si.stock_mode, 'direct') IN ('direct', 'batch') AND ${refunds.sql}`,
        refunds.values,
      ),
      one<{ cost: number; items: number }>(
        `SELECT COALESCE(SUM(si.quantity * COALESCE(si.unit_cost, 0)), 0) AS cost, COALESCE(SUM(si.quantity), 0) AS items
         FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status = 1 AND ${sales.sql}`,
        sales.values,
      ),
      one<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE voided_at IS NULL AND ${expenseDates.sql}`,
        expenseDates.values,
      ),
      many<{ name: string; amount: number; count: number }>(
        `SELECT category AS name, ROUND(SUM(amount), 2) AS amount, COUNT(*) AS count
         FROM expenses WHERE voided_at IS NULL AND ${expenseDates.sql} GROUP BY category ORDER BY amount DESC`,
        expenseDates.values,
      ),
    ])

    const [productRows, categoryRows, cashierRows, methodRows, slowRows, inventoryRow, ingredientRow, receivablesRow, lowStock] = await Promise.all([
      many<ProductRow>(
        `SELECT si.product_id AS productId, p.name AS name, c.name AS categoryName, SUM(si.quantity) AS quantity,
                SUM(${LINE_NET}) AS revenue, SUM(si.quantity * COALESCE(si.unit_cost, 0)) AS cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE s.status = 1 AND ${sales.sql}
         GROUP BY si.product_id`,
        sales.values,
      ),
      many<{ name: string | null; count: number; quantity: number; revenue: number; cost: number }>(
        `SELECT c.name AS name, COUNT(DISTINCT s.id) AS count, SUM(si.quantity) AS quantity,
                SUM(${LINE_NET}) AS revenue, SUM(si.quantity * COALESCE(si.unit_cost, 0)) AS cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE s.status = 1 AND ${sales.sql}
         GROUP BY p.category_id
         ORDER BY revenue DESC`,
        sales.values,
      ),
      many<{ name: string; count: number; total: number }>(
        `SELECT s.cashier_id AS name, COUNT(*) AS count, ROUND(SUM(s.total), 2) AS total
         FROM sales s WHERE s.status = 1 AND ${sales.sql} GROUP BY s.cashier_id ORDER BY total DESC`,
        sales.values,
      ),
      many<{ method: number; count: number; amount: number }>(
        `SELECT sp.method AS method, COUNT(DISTINCT sp.sale_id) AS count, ROUND(SUM(sp.amount), 2) AS amount
         FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
         WHERE s.status = 1 AND ${sales.sql} GROUP BY sp.method ORDER BY amount DESC`,
        sales.values,
      ),
      // In stock but sold least (or not at all) in the period, largest money tied up first.
      many<{ productId: number; name: string; stockQuantity: number; stockValue: number; quantitySold: number }>(
        `SELECT p.id AS productId, p.name AS name, p.stock_quantity AS stockQuantity,
                ROUND(p.stock_quantity * p.cost_price, 2) AS stockValue,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.status = 1 AND ${sales.sql}), 0) AS quantitySold
         FROM products p
         WHERE p.is_active = 1 AND p.inventory_mode IN ('direct', 'batch') AND p.stock_quantity > 0
         ORDER BY quantitySold ASC, stockValue DESC
         LIMIT 10`,
        sales.values,
      ),
      one<{ costValue: number; retailValue: number; products: number; lowStock: number; outOfStock: number }>(
        `SELECT COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * cost_price ELSE 0 END), 0) AS costValue,
                COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * selling_price ELSE 0 END), 0) AS retailValue,
                COUNT(*) AS products,
                SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= reorder_level THEN 1 ELSE 0 END) AS lowStock,
                SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END) AS outOfStock
         FROM products WHERE is_active = 1 AND inventory_mode IN ('direct', 'batch')`,
      ),
      // Ingredients and supplies on hand, at their current cost (cafés; zero for retail).
      one<{ value: number; alerts: number }>(
        `SELECT COALESCE(SUM(CASE WHEN on_hand > 0 THEN on_hand * cost_per_base / 1000.0 ELSE 0 END), 0) AS value,
                SUM(CASE WHEN on_hand <= reorder_level OR on_hand <= 0 THEN 1 ELSE 0 END) AS alerts
         FROM inventory_items WHERE is_active = 1`,
      ),
      one<{ total: number; customers: number }>(
        `SELECT COALESCE(SUM(credit_balance), 0) AS total, COUNT(*) AS customers FROM customers WHERE credit_balance > 0.004`,
      ),
      inventoryApi.reorderSuggestions(),
    ])

    const grossSales = roundMoney(salesTotals.gross ?? 0)
    const discounts = roundMoney(salesTotals.discounts ?? 0)
    const refundsExTax = roundMoney(refundTotals.exTax ?? 0)
    const netSales = roundMoney(grossSales - discounts - refundsExTax)
    const costOfGoods = roundMoney((soldCost.cost ?? 0) - (returnedCost.cost ?? 0))
    const grossProfit = roundMoney(netSales - costOfGoods)
    const expenses = roundMoney(expenseTotal.total ?? 0)
    const transactions = salesTotals.count ?? 0
    const refundTax = roundMoney((refundTotals.amount ?? 0) - refundsExTax)

    const products = productRows.map(toPerformance)

    return {
      grossSales,
      discounts,
      seniorDiscounts: roundMoney(salesTotals.senior ?? 0),
      loyaltyRedeemed: roundMoney(salesTotals.loyalty ?? 0),
      refunds: roundMoney(refundTotals.amount ?? 0),
      refundsExTax,
      netSales,
      taxCollected: roundMoney((salesTotals.tax ?? 0) - refundTax),
      totalCollected: roundMoney(salesTotals.collected ?? 0),
      costOfGoods,
      grossProfit,
      grossMargin: netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null,
      expenses,
      netProfit: roundMoney(grossProfit - expenses),
      transactions,
      averageTransaction: transactions > 0 ? roundMoney((salesTotals.collected ?? 0) / transactions) : 0,
      itemsSold: soldCost.items ?? 0,
      voidedCount: voided.count ?? 0,
      voidedAmount: roundMoney(voided.amount ?? 0),
      bestSellers: [...products].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 10),
      topProfit: [...products].sort((a, b) => b.profit - a.profit).slice(0, 10),
      slowMovers: slowRows,
      byCategory: categoryRows.map((row) => {
        const revenue = roundMoney(row.revenue ?? 0)
        const cost = roundMoney(row.cost ?? 0)
        return { name: row.name ?? 'Uncategorized', count: row.count, quantity: row.quantity, revenue, cost, profit: roundMoney(revenue - cost) }
      }),
      byCashier: cashierRows,
      byPaymentMethod: methodRows.map((row) => ({ ...row, label: methodLabel(row.method) })),
      expensesByCategory: expenseRows,
      inventory: {
        costValue: roundMoney(inventoryRow.costValue ?? 0),
        retailValue: roundMoney(inventoryRow.retailValue ?? 0),
        products: inventoryRow.products ?? 0,
        lowStock: inventoryRow.lowStock ?? 0,
        outOfStock: inventoryRow.outOfStock ?? 0,
        ingredientValue: roundMoney(ingredientRow.value ?? 0),
        ingredientAlerts: ingredientRow.alerts ?? 0,
      },
      lowStock: lowStock.slice(0, 10),
      receivables: { total: roundMoney(receivablesRow.total ?? 0), customers: receivablesRow.customers ?? 0 },
    }
  },
}
