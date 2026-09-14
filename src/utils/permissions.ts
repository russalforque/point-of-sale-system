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
  ],
  cashier: ['products.view', 'customers.view', 'customers.create', 'sales.process', 'drawer.open'],
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
