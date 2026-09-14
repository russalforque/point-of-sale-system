import type { DashboardData } from '../types'
import { querySQL } from '../database/sqlite'
import { PAYMENT_OPTIONS } from '../utils/pos'

// created_at is stored as a UTC ISO string, but "today" must follow the device's own
// calendar day - date(created_at, 'localtime') converts the stored value to local time
// before comparing, and the JS side keys are built from local getters (not toISOString(),
// which would silently shift the date for the early-morning hours in a UTC+ timezone).
function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const dashboardApi = {
  get: async (): Promise<DashboardData> => {
    const today = localDateKey(new Date())

    const todaySalesResult = await querySQL(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
       FROM sales WHERE date(created_at, 'localtime') = ? AND status = 1`,
      [today],
    )
    const todaysSales = (todaySalesResult.values?.[0]?.total as number | undefined) ?? 0
    const todaysTransactions = (todaySalesResult.values?.[0]?.count as number | undefined) ?? 0

    const customerCountResult = await querySQL(
      `SELECT COUNT(*) AS count FROM customers WHERE is_active = 1`,
    )
    const totalCustomers = (customerCountResult.values?.[0]?.count as number | undefined) ?? 0

    const productCountResult = await querySQL(
      `SELECT COUNT(*) AS count FROM products WHERE is_active = 1`,
    )
    const totalProducts = (productCountResult.values?.[0]?.count as number | undefined) ?? 0

    const lowStockResult = await querySQL(
      `SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND stock_quantity <= reorder_level`,
    )
    const lowStockCount = (lowStockResult.values?.[0]?.count as number | undefined) ?? 0

    const salesOverview: { label: string; amount: number }[] = []
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      const key = localDateKey(day)
      const result = await querySQL(
        `SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE date(created_at, 'localtime') = ? AND status = 1`,
        [key],
      )
      const amount = (result.values?.[0]?.total as number | undefined) ?? 0
      salesOverview.push({
        label: day.toLocaleDateString('en-US', { weekday: 'short' }),
        amount,
      })
    }

    const recentResult = await querySQL(
      `SELECT s.id AS id, s.invoice_number AS invoiceNumber, c.full_name AS customerName,
              s.total AS total, s.created_at AS createdAt, pay.method AS method
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN payments pay ON pay.sale_id = s.id
       WHERE s.status = 1
       ORDER BY s.created_at DESC
       LIMIT 8`,
    )
    const recentTransactions = ((recentResult.values ?? []) as any[]).map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName ?? null,
      total: row.total,
      paymentMethod:
        PAYMENT_OPTIONS.find((opt) => opt.value === row.method)?.label ?? 'Other',
      createdAt: row.createdAt,
    }))

    const lowStockRows = await querySQL(
      `SELECT id, sku, name, stock_quantity AS stockQuantity, reorder_level AS reorderLevel
       FROM products
       WHERE is_active = 1 AND stock_quantity <= reorder_level
       ORDER BY stock_quantity ASC
       LIMIT 10`,
    )
    const lowStockProducts = ((lowStockRows.values ?? []) as any[]).map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      stockQuantity: row.stockQuantity,
      reorderLevel: row.reorderLevel,
    }))

    const topSellingResult = await querySQL(
      `SELECT si.product_id AS productId, p.name AS name,
              SUM(si.quantity) AS quantitySold, SUM(si.line_total) AS revenue
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 1
       GROUP BY si.product_id
       ORDER BY quantitySold DESC
       LIMIT 5`,
    )
    const topSellingProducts = ((topSellingResult.values ?? []) as any[]).map((row) => ({
      productId: row.productId,
      name: row.name ?? 'Unknown product',
      quantitySold: row.quantitySold,
      revenue: row.revenue,
    }))

    return {
      todaysSales,
      todaysTransactions,
      totalCustomers,
      totalProducts,
      lowStockCount,
      salesOverview,
      recentTransactions,
      lowStockProducts,
      topSellingProducts,
    }
  },
}
