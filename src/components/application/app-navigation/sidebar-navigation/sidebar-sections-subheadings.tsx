import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { Avatar } from '@/components/base/avatar/avatar'
import type { NavItemType } from '@/components/application/app-navigation/config'

interface SidebarNavigationSectionsSubheadingsProps {
  activeUrl?: string
  items: Array<{ label: string; items: NavItemType[] }>
  collapsed?: boolean
  header?: ReactNode
  footer?: ReactNode
  onNavigate?: () => void
}

export function SidebarNavigationSectionsSubheadings({
  items,
  collapsed = false,
  header,
  footer,
  onNavigate,
}: SidebarNavigationSectionsSubheadingsProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className={cx('flex h-16 items-center border-b border-gray-200', collapsed ? 'justify-center px-2' : 'px-5')}>
        {header}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {items.map((group) => (
          <div key={group.label} className="mb-5">
            {!collapsed ? (
              <p className="mb-1 px-2 text-xs font-medium text-gray-400">{group.label}</p>
            ) : (
              <div className="mx-1 mb-2 border-t border-gray-100" />
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                if (!item.href) return null
                return (
                  <li key={item.href + item.label}>
                    <NavLink
                      to={item.href}
                      title={collapsed ? item.label : undefined}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cx(
                          'group flex max-h-9 items-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-gray-50 text-gray-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                          collapsed ? 'justify-center' : 'gap-2',
                        )
                      }
                    >
                      {Icon ? <Icon className="size-5 shrink-0 text-gray-500 group-[.bg-gray-50]:text-gray-700" /> : null}
                      {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                      {!collapsed && item.badge ? <span className="ml-auto flex items-center">{item.badge}</span> : null}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {footer ? <div className="border-t border-gray-200 p-3">{footer}</div> : null}
    </div>
  )
}

export function SidebarAccount({
  name,
  email,
  collapsed,
  onLogout,
}: {
  name: string
  email: string
  collapsed: boolean
  onLogout: () => void
}) {
  const initials = name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className={cx('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
      <Avatar initials={initials} size="sm" className="size-10" />
      {!collapsed ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          <p className="truncate text-sm text-gray-500">{email}</p>
        </div>
      ) : null}
      {!collapsed ? (
        <button
          type="button"
          onClick={onLogout}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800"
        >
          Log out
        </button>
      ) : (
        <button type="button" title="Log out" onClick={onLogout} className="sr-only">
          Log out
        </button>
      )}
    </div>
  )
}
