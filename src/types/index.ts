import type { Role } from '../utils/permissions'

export type User = {
  id: string
  email: string
  fullName: string
  role: Role
}

export type LoginResponse = {
  token: string
  expiresAt: string
  user: User
}

export type PagedResult<T> = {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export type Customer = {
  id: number
  customerCode: string
  fullName: string
  phone: string | null
  email: string | null
  address: string | null
  isActive: boolean
  createdAt: string
  loyaltyPoints: number
}

export type Category = {
  id: number
  name: string
  description: string | null
  isActive: boolean
  productCount: number
}

export type Supplier = {
  id: number
  supplierCode: string
  companyName: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
}

export type Product = {
  id: number
  sku: string
  name: string
  description: string | null
  categoryId: number
  categoryName: string
  supplierId: number | null
  supplierName: string | null
  costPrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  imageUrl: string | null
  stockStatus: string
}

export type InventoryItem = {
  productId: number
  productName: string
  sku: string
  stockQuantity: number
  reorderLevel: number
  stockStatus: string
  lastUpdated: string
}

export type InventoryHistory = {
  id: number
  productId: number
  productName: string
  sku: string
  type: string
  quantityChange: number
  quantityAfter: number
  reason: string
  createdAt: string
}

export type SaleItem = {
  productId: number
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
  /** Units already returned from this line. */
  refundedQuantity: number
}

export type Sale = {
  id: number
  invoiceNumber: string
  customerId: number | null
  customerName: string | null
  cashierName: string
  shiftId: number | null
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  createdAt: string
  /** "Dine-In" / "Take-Out"; null for sales recorded before order types existed. */
  orderType: string | null
  paymentMethod: string
  amountReceived: number | null
  change: number | null
  items: SaleItem[]
  /** Tender lines (applied amounts). More than one = split payment. */
  payments: SalePayment[]
  refundedAmount: number
  refundStatus: 'None' | 'Partial' | 'Full'
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
  voidApprovedBy: string | null
}

export type SalePayment = {
  method: number
  label: string
  amount: number
  reference: string | null
}

export type DashboardData = {
  todaysSales: number
  todaysTransactions: number
  totalCustomers: number
  totalProducts: number
  lowStockCount: number
  salesOverview: { label: string; amount: number }[]
  recentTransactions: {
    id: number
    invoiceNumber: string
    customerName: string | null
    total: number
    paymentMethod: string
    createdAt: string
  }[]
  lowStockProducts: {
    id: number
    sku: string
    name: string
    stockQuantity: number
    reorderLevel: number
  }[]
  topSellingProducts: {
    productId: number
    name: string
    imageUrl: string | null
    quantitySold: number
    revenue: number
  }[]
}

export type NamedAmount = { name: string; amount: number; count: number }
export type SalesPeriod = { label: string; date: string; total: number; transactions: number }

export type ReportsData = {
  dailySales: SalesPeriod[]
  weeklySales: SalesPeriod[]
  monthlySales: SalesPeriod[]
  salesByProduct: NamedAmount[]
  salesByCategory: NamedAmount[]
  salesByPaymentMethod: NamedAmount[]
  topSellingProducts: NamedAmount[]
  inventoryStatus: {
    inStock: number
    lowStock: number
    outOfStock: number
    inventoryValue: number
  }
}

export type StoreSetting = {
  id: number
  storeName: string
  phone: string | null
  email: string | null
  address: string | null
  currency: string
  currencySymbol: string
  taxRate: number
  receiptFooter: string
  showLogoOnReceipt: boolean
}

export type ShiftStatus = 'Open' | 'Closed'

export type Shift = {
  id: number
  employeeId: number
  employeeName: string
  startingCash: number
  status: ShiftStatus
  startedAt: string
  endedAt: string | null
  cashSales: number | null
  nonCashSales: number | null
  totalSales: number | null
  expectedCash: number | null
  actualCash: number | null
  difference: number | null
  cashRefunds: number | null
  cashIn: number | null
  cashOut: number | null
  closedBy: string | null
}

export type ShiftSummary = {
  startingCash: number
  cashSales: number
  nonCashSales: number
  cashRefunds: number
  cashIn: number
  cashOut: number
  expectedCash: number
}

export type CashMovement = {
  id: number
  shiftId: number
  type: 'Cash in' | 'Cash out'
  amount: number
  reason: string
  createdBy: string
  createdAt: string
}

export type HeldOrderLine = { productId: number; name: string; quantity: number; unitPrice: number }

export type HeldOrder = {
  id: number
  label: string | null
  customerId: number | null
  customerName: string | null
  orderType: number
  discount: number
  lines: HeldOrderLine[]
  itemCount: number
  subtotal: number
  total: number
  cashierName: string
  createdAt: string
}

export type RefundItem = {
  productId: number
  productName: string
  quantity: number
  unitPrice: number
  amount: number
}

export type Refund = {
  id: number
  refundNumber: string
  saleId: number
  invoiceNumber: string
  amount: number
  method: number
  methodLabel: string
  reason: string
  restocked: boolean
  processedBy: string
  approvedBy: string | null
  createdAt: string
  items: RefundItem[]
}

export type StockCountItem = {
  productId: number
  productName: string
  sku: string
  systemQuantity: number
  countedQuantity: number
  difference: number
}

export type StockCount = {
  id: number
  countNumber: string
  notes: string | null
  itemsCounted: number
  itemsAdjusted: number
  netChange: number
  createdBy: string
  createdAt: string
  items: StockCountItem[]
}

export type StockReceiptItem = {
  productId: number
  productName: string
  sku: string
  quantity: number
  unitCost: number
  lineTotal: number
}

export type StockReceipt = {
  id: number
  receiptNumber: string
  supplierId: number | null
  supplierName: string | null
  reference: string | null
  receivedDate: string
  notes: string | null
  totalCost: number
  createdBy: string
  createdAt: string
  items: StockReceiptItem[]
}

export type AuditLog = {
  id: number
  userId: string | null
  userName: string
  action: string
  actionLabel: string
  description: string
  entityType: string | null
  entityId: string | null
  createdAt: string
}

export type PaymentMethod = 0 | 1 | 2 | 3

export type PaymentBreakdown = {
  cash: number
  card: number
  gcash: number
  transfer: number
  other: number
}
