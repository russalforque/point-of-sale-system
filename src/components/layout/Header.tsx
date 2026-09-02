type HeaderProps = {
  title?: string
  onToggle?: () => void
  onOpenMobile?: () => void
}

export function Header({ title = 'Sellix POS', onToggle, onOpenMobile }: HeaderProps) {
  void onToggle
  void onOpenMobile
  void title

  return null
}
