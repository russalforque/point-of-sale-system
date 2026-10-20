import type { Role } from '../utils/permissions'
import type { InventoryMode, ModifierEffect } from '../services/recipes'
import type { BaseUnit, Conversions } from '../services/units'

export type { InventoryMode }

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
  /** Most the customer may owe on account; 0 = no credit allowed. */
  creditLimit: number
  /** Amount owed on account (negative = the store owes the customer). */
  creditBalance: number
  notes: string | null
}

export type CreditEntry = {
  id: number
  entryNumber: string
  customerId: number
  type: number
  typeLabel: string
  amount: number
  balanceAfter: number
  saleId: number | null
  invoiceNumber: string | null
  method: number | null
  methodLabel: string | null
  reference: string | null
  dueDate: string | null
  notes: string | null
  createdBy: string
  createdAt: string
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
  /** Optional, unique when set. Scanned at the register. */
  barcode: string | null
  /** Selling unit, e.g. "pcs", "kg". Null for products created before units existed. */
  unit: string | null
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
  /** How selling it changes stock. Products created before recipes existed are 'direct'. */
  inventoryMode: InventoryMode
  /** Batch products: servings one batch makes. */
  batchYield: number | null
  /**
   * How many can be sold right now: own stock (direct/batch), servings the ingredients on hand
   * can make (recipe), or null when nothing limits it (not tracked, or a recipe with no ingredients).
   */
  availableQuantity: number | null
  /** Where costPrice comes from: typed in, or worked out from the recipe's ingredient costs. */
  costSource: 'manual' | 'recipe'
  /** Active option groups (size, milk…) the cashier picks from when adding it. */
  modifierGroupCount: number
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
  createdBy: string | null
  createdAt: string
}

/** A product at or below its reorder level, with how many to order. */
export type ReorderSuggestion = {
  productId: number
  name: string
  sku: string
  supplierId: number | null
  supplierName: string | null
  stockQuantity: number
  reorderLevel: number
  costPrice: number
  /** Average units sold per day over the last 30 days. */
  dailySales: number
  suggestedQuantity: number
}

export type SaleItem = {
  /** sale_items row id: identifies the line when the same product is on two lines with different options. */
  id: number
  productId: number
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
  /** Units already returned from this line. */
  refundedQuantity: number
  /** Options chosen for this line ("Large", "Oat milk"), in group order. */
  modifiers: SaleItemModifier[]
  /** How the line was stocked when sold; null for sales before recipes existed (direct stock). */
  stockMode: InventoryMode | null
}

export type SaleItemModifier = { groupName: string; name: string; priceDelta: number }

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
  /** 'manual' or 'senior_pwd'; null when there is no discount (or for older sales). */
  discountType: DiscountType | null
  /** Senior/PWD ID number, when that discount was given. */
  discountReference: string | null
  /** Manager/admin who approved a discount above the store limit. */
  discountApprovedBy: string | null
  /** Part of `discount` paid for with loyalty points. */
  loyaltyDiscount: number
  pointsEarned: number
  pointsRedeemed: number
}

export type DiscountType = 'manual' | 'senior_pwd'

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
  /** Ingredients and supplies at or below their reorder level (food-service stores). */
  lowStockIngredients: LowStockIngredient[]
  topSellingProducts: {
    productId: number
    name: string
    imageUrl: string | null
    quantitySold: number
    revenue: number
  }[]
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
  /** Discounts above this % of the subtotal need a manager or admin. */
  maxDiscountPercent: number
  /** Senior citizen / PWD discount rate (%), applied with an ID number and exempt from the limit above. */
  seniorDiscountPercent: number
  loyaltyEnabled: boolean
  /** Amount paid per point earned, e.g. 100 = 1 point per ₱100. */
  loyaltyAmountPerPoint: number
  /** Money value of one point when redeemed. */
  loyaltyPointValue: number
  creditEnabled: boolean
  /** Days until a charged sale is due. */
  creditDefaultDays: number
  /** When an order needs more stock than is on hand: false blocks the sale, true allows it (stock goes negative) with a warning. */
  allowNegativeStock: boolean
  /** Ingredients, recipes, batches and modifiers (cafés, restaurants). Off keeps the retail screens unchanged. */
  foodServiceEnabled: boolean
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

export type HeldOrderLine = {
  productId: number
  name: string
  quantity: number
  unitPrice: number
  /** Options chosen (absent on orders held before modifiers existed). */
  modifierIds?: number[]
  modifierNames?: string[]
}

export type HeldOrder = {
  id: number
  label: string | null
  customerId: number | null
  customerName: string | null
  orderType: number
  discount: number
  discountType: DiscountType | null
  discountReference: string | null
  lines: HeldOrderLine[]
  itemCount: number
  subtotal: number
  total: number
  cashierName: string
  createdAt: string
}

export type RefundItem = {
  saleItemId: number | null
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
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  items: StockReceiptItem[]
}

export type PurchaseOrderStatus = 'Draft' | 'Ordered' | 'Partially received' | 'Received' | 'Cancelled'

export type PurchaseOrderItem = {
  id: number
  productId: number
  productName: string
  sku: string
  quantityOrdered: number
  quantityReceived: number
  unitCost: number
  lineTotal: number
}

export type PurchaseOrder = {
  id: number
  poNumber: string
  supplierId: number
  supplierName: string
  status: PurchaseOrderStatus
  expectedDate: string | null
  notes: string | null
  totalCost: number
  createdBy: string
  createdAt: string
  updatedAt: string
  orderedAt: string | null
  closedAt: string | null
  lineCount: number
  unitsOrdered: number
  unitsReceived: number
  items: PurchaseOrderItem[]
}

export type ExpenseCategory = string

export type Expense = {
  id: number
  expenseNumber: string
  category: ExpenseCategory
  amount: number
  description: string
  reference: string | null
  expenseDate: string
  paidFromDrawer: boolean
  createdBy: string
  createdAt: string
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
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

/** 0 Cash · 1 Card · 2 GCash · 3 Other · 4 Charge to the customer's account. */
export type PaymentMethod = 0 | 1 | 2 | 3 | 4

export type PaymentBreakdown = {
  cash: number
  card: number
  gcash: number
  transfer: number
  other: number
}

/* ------------------------------------------------------------------
   INGREDIENTS, RECIPES & MODIFIERS (schema v6)
   Quantities are stored thousandths of the item's base unit - see services/units.ts.
------------------------------------------------------------------ */

export type StockLevel = 'In Stock' | 'Low Stock' | 'Out of Stock'

/** Something the business stocks to make what it sells: coffee beans, milk, cups, lids. */
export type Ingredient = {
  id: number
  name: string
  sku: string | null
  baseUnit: BaseUnit
  onHand: number
  reorderLevel: number
  /** Price paid for one `costUnit`, e.g. ₱850 per kg. */
  unitCost: number
  costUnit: string
  /** Same cost for one base unit (₱0.85 per g); used for recipe costs. */
  costPerBase: number
  /** Unit it is usually bought in (bag, box…), offered first when receiving. */
  purchaseUnit: string | null
  /** Package sizes: unit code → stored quantity in one package. */
  conversions: Conversions
  supplierId: number | null
  supplierName: string | null
  notes: string | null
  isActive: boolean
  stockStatus: StockLevel
  /** Products whose recipe uses it. */
  recipeCount: number
  createdAt: string
  updatedAt: string
}

export type LowStockIngredient = { id: number; name: string; onHand: number; reorderLevel: number; baseUnit: BaseUnit }

export type StockMovementType =
  | 'opening'
  | 'stock_in'
  | 'stock_out'
  | 'sale'
  | 'void'
  | 'production'
  | 'count'
  | 'waste'
  | 'damaged'
  | 'expired'
  | 'spoilage'
  | 'correction'
  | 'other'

export type StockMovement = {
  id: number
  inventoryItemId: number
  itemName: string
  baseUnit: BaseUnit
  type: StockMovementType
  typeLabel: string
  /** Signed change (+ in, − out). */
  quantity: number
  previousQuantity: number
  newQuantity: number
  /** Cost per base unit when it happened. */
  unitCost: number | null
  referenceType: string | null
  referenceId: string | null
  reason: string | null
  userName: string | null
  createdAt: string
}

export type RecipeLineDetail = {
  inventoryItemId: number
  name: string
  baseUnit: BaseUnit
  conversions: Conversions
  /** Stored quantity used per serving (per batch for batch products). */
  quantity: number
  /** Unit it was entered in, for display. */
  unitCode: string
  costPerBase: number
  onHand: number
  isActive: boolean
}

export type ProductRecipe = {
  lines: RecipeLineDetail[]
  modifierGroupIds: number[]
}

export type ModifierEffectRecord = ModifierEffect & {
  /** Unit the quantity was entered in, for display. */
  unitCode: string | null
}

export type Modifier = {
  id: number
  groupId: number
  name: string
  priceDelta: number
  isDefault: boolean
  isActive: boolean
  effects: ModifierEffectRecord[]
}

export type ModifierGroup = {
  id: number
  name: string
  /** 'single': pick one (Size) · 'multiple': pick any (Add-ons). */
  selection: 'single' | 'multiple'
  isRequired: boolean
  isActive: boolean
  modifiers: Modifier[]
  /** Products that offer this group. */
  productCount: number
}

export type ProductionBatch = {
  id: number
  batchNumber: string
  productId: number
  productName: string
  batches: number
  servings: number
  ingredientCost: number
  notes: string | null
  createdBy: string
  createdAt: string
}

/** One item's theoretical vs actual movement over a period. All quantities stored, signed as named. */
export type IngredientUsageRow = {
  inventoryItemId: number
  name: string
  baseUnit: BaseUnit
  costPerBase: number
  opening: number
  /** Deliveries and opening stock added in the period. */
  purchases: number
  /** Used by sales (net of voids) and batches. */
  usage: number
  waste: number
  /** Other manual changes (stock out, corrections). */
  adjustments: number
  /** opening + purchases − usage − waste + adjustments */
  expected: number
  /** Physical count differences recorded in the period (actual − system). */
  countVariance: number
  closing: number
}
