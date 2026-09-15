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
}

export type Sale = {
  id: number
  invoiceNumber: string
  customerId: number | null
  customerName: string | null
  cashierName: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  createdAt: string
  paymentMethod: string
  amountReceived: number | null
  change: number | null
  items: SaleItem[]
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

export type PaymentMethod = 0 | 1 | 2 | 3

export type PaymentBreakdown = {
  cash: number
  card: number
  gcash: number
  transfer: number
  other: number
}
