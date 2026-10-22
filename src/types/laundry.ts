export type BusinessType = 'retail' | 'laundry'
export const LAUNDRY_STATUSES = [
  'Received',
  'Ready for Pickup',
  'Completed',
] as const
export type LaundryStatus = (typeof LAUNDRY_STATUSES)[number]
export type LaundryPricing = 'kg' | 'load' | 'piece' | 'fixed'
export type AddonPricing = 'fixed' | 'quantity'
export type LaundryMethod = 'Cash' | 'GCash' | 'Maya'
export type LaundryCatalog = {
  id: number
  name: string
  category?: string
  pricing: LaundryPricing | AddonPricing
  price_cents: number
  is_active: number
  removed_at?: string | null
}
export type LaundryDiscount = {
  id: number; name: string; kind: 'percent' | 'fixed'; value: number
  scope: 'order' | 'services' | 'addons' | 'categories'; categories: string[]
  visit_number: number; repeat_every: number; weekday: number | null
  stackable: number; is_active: number; revision: number; eligibility_note: string
}
export type LaundryRules = {
  allow_stacking: number; visit_status: 'Completed' | 'Ready for Pickup'
  visit_require_paid: number; visit_minimum_cents: number; visit_basis: 'subtotal' | 'total'; revision: number
  allow_unpaid_completion: number
}
export type LaundryDiscountContext = {
  customer_id: number; visits: number; reservations: { discount_id: number; visit_number: number; order_id: number }[]
  rules: LaundryRules; discounts: LaundryDiscount[]
}
export type LaundryAppliedDiscount = {
  id?: number; discount_id: number | null; name: string; kind: 'percent' | 'fixed'; value: number
  amount_cents: number; visit_number: number | null; rule_json: string
}
export type LaundryLine = {
  id: number
  name: string
  pricing: string
  quantity_milli: number
  price_cents: number
  total_cents: number
  category?: string
}
export type LaundryPayment = {
  id: number
  method: LaundryMethod
  amount_cents: number
  tendered_cents: number
  reference: string | null
  created_at: string
  staff: string
}
export type LaundryOrder = {
  id: number
  order_number: string
  customer_id: number
  customer_name: string
  customer_phone: string | null
  /** Cancelled is retained only on read-only pre-v11 archives, never a workflow choice. */
  status: LaundryStatus | 'Cancelled'
  status_version: number
  archived_at?: string | null
  legacy_status?: string | null
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  paid_cents: number
  pickup_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type LaundryDetail = LaundryOrder & {
  items: LaundryLine[]
  addons: LaundryLine[]
  payments: LaundryPayment[]
  history: { id: number; status: string; from_status?: string | null; event_type?: string; reason: string | null; staff: string; created_at: string }[]
  discounts?: LaundryAppliedDiscount[]
}
export type LaundrySelection = { id: number; quantity: number }
export type LaundryPaymentInput = {
  requestKey: string
  method: LaundryMethod
  amount: number
  tendered: number
  reference?: string
}
export type NewLaundryOrder = {
  requestKey: string
  customerId: number
  items: LaundrySelection[]
  addons: LaundrySelection[]
  discount: number
  discountIds?: number[]
  pricingKey?: string
  pickupAt?: string
  notes?: string
  payment?: LaundryPaymentInput
}
