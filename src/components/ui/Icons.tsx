import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faBars,
  faBox,
  faBoxOpen,
  faBoxesStacked,
  faChartBar,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faClockRotateLeft,
  faEye,
  faGear,
  faHistory,
  faMagnifyingGlass,
  faMinus,
  faPen,
  faPlus,
  faShieldHalved,
  faStore,
  faTags,
  faTrash,
  faTruck,
  faUser,
  faUserPlus,
  faUserXmark,
  faUsers,
  faWarehouse,
  faXmark,
  faCartShopping,
  faBarcode,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

type IconProps = {
  size?: number
  className?: string
}

function Icon({ icon, size = 16, className = '' }: IconProps & { icon: IconDefinition }) {
  return <FontAwesomeIcon icon={icon} className={className} style={{ width: size, height: size }} />
}

export const ArrowRight = (props: IconProps) => <Icon icon={faArrowRight} {...props} />
export const Menu = (props: IconProps) => <Icon icon={faBars} {...props} />
export const Package = (props: IconProps) => <Icon icon={faBox} {...props} />
export const PackagePlus = (props: IconProps) => <Icon icon={faBoxOpen} {...props} />
export const Warehouse = (props: IconProps) => <Icon icon={faWarehouse} {...props} />
export const BarChart3 = (props: IconProps) => <Icon icon={faChartBar} {...props} />
export const ChevronDown = (props: IconProps) => <Icon icon={faChevronDown} {...props} />
export const ChevronLeft = (props: IconProps) => <Icon icon={faChevronLeft} {...props} />
export const ChevronRight = (props: IconProps) => <Icon icon={faChevronRight} {...props} />
export const Eye = (props: IconProps) => <Icon icon={faEye} {...props} />
export const History = (props: IconProps) => <Icon icon={faHistory} {...props} />
export const Search = (props: IconProps) => <Icon icon={faMagnifyingGlass} {...props} />
export const Minus = (props: IconProps) => <Icon icon={faMinus} {...props} />
export const Pencil = (props: IconProps) => <Icon icon={faPen} {...props} />
export const Plus = (props: IconProps) => <Icon icon={faPlus} {...props} />
export const ShieldCheck = (props: IconProps) => <Icon icon={faShieldHalved} {...props} />
export const Store = (props: IconProps) => <Icon icon={faStore} {...props} />
export const Tags = (props: IconProps) => <Icon icon={faTags} {...props} />
export const Trash2 = (props: IconProps) => <Icon icon={faTrash} {...props} />
export const Truck = (props: IconProps) => <Icon icon={faTruck} {...props} />
export const UserRound = (props: IconProps) => <Icon icon={faUser} {...props} />
export const UserPlus = (props: IconProps) => <Icon icon={faUserPlus} {...props} />
export const UserX = (props: IconProps) => <Icon icon={faUserXmark} {...props} />
export const Users = (props: IconProps) => <Icon icon={faUsers} {...props} />
export const Settings = (props: IconProps) => <Icon icon={faGear} {...props} />
export const X = (props: IconProps) => <Icon icon={faXmark} {...props} />
export const Barcode = (props: IconProps) => <Icon icon={faBarcode} {...props} />
export const ClockRotateLeft = (props: IconProps) => <Icon icon={faClockRotateLeft} {...props} />
export const ShoppingCart = (props: IconProps) => <Icon icon={faCartShopping} {...props} />
