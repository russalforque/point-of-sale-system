export type Role = 'admin' | 'manager' | 'cashier'

export type Permission =
  | 'products.view'
  | 'products.manage'
  | 'products.delete'
  | 'categories.manage'
  | 'suppliers.manage'
  | 'customers.view'
  | 'customers.create'
  | 'customers.manage'
  | 'inventory.manage'
  | 'reports.view'
  | 'settings.view'
  | 'settings.manage'
  | 'users.manage'
  | 'sales.process'
  | 'sales.refund'
  | 'printer.configure'
  | 'drawer.open'
  | 'shifts.manage'
  | 'sales.hold'
  | 'sales.void'
  | 'cash.movement'
  | 'inventory.count'
  | 'inventory.receive'
  | 'audit.view'
  | 'backup.manage'
  | 'sales.discount'
  | 'expenses.manage'
  | 'purchasing.manage'
  | 'credit.manage'
  | 'inventory.waste'
  | 'inventory.produce'

const ALL_PERMISSIONS: Permission[] = [
  'products.view',
  'products.manage',
  'products.delete',
  'categories.manage',
  'suppliers.manage',
  'customers.view',
  'customers.create',
  'customers.manage',
  'inventory.manage',
  'reports.view',
  'settings.view',
  'settings.manage',
  'users.manage',
  'sales.process',
  'sales.refund',
  'printer.configure',
  'drawer.open',
  'shifts.manage',
  'sales.hold',
  'sales.void',
  'cash.movement',
  'inventory.count',
  'inventory.receive',
  'audit.view',
  'backup.manage',
  'sales.discount',
  'expenses.manage',
  'purchasing.manage',
  'credit.manage',
  'inventory.waste',
  'inventory.produce',
]

// Manager's brief only calls out "manage products" / "manage inventory" as
// summary bullets, but running the catalog day-to-day requires touching
// categories and suppliers too, so those are folded into the manager grant.
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: [
    'products.view',
    'products.manage',
    'products.delete',
    'categories.manage',
    'suppliers.manage',
    'customers.view',
    'customers.create',
    'customers.manage',
    'inventory.manage',
    'reports.view',
    'settings.view',
    'sales.process',
    'sales.refund',
    'drawer.open',
    'shifts.manage',
    'sales.hold',
    'sales.void',
    'cash.movement',
    'inventory.count',
    'inventory.receive',
    'audit.view',
    'sales.discount',
    'expenses.manage',
    'purchasing.manage',
    'credit.manage',
    'inventory.waste',
    'inventory.produce',
  ],
  // Refunds, voids and discounts above the store's limit stay manager-level; a cashier can
  // still start one at the counter and have a manager or admin approve it with their PIN
  // (see ApprovalDialog).
  cashier: [
    'products.view',
    'customers.view',
    'customers.create',
    'sales.process',
    'sales.hold',
    'drawer.open',
    'cash.movement',
    // Baristas spill milk and brew the day's cold brew: they log waste and make batches
    // (each one is recorded with their name) but can't otherwise change stock.
    'inventory.waste',
    'inventory.produce',
  ],
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Cashier',
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function hasAnyPermission(role: Role | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission))
}

/** Roles whose members can approve a sensitive action for someone else with their PIN. */
export const APPROVER_ROLES: Role[] = ['admin', 'manager']
