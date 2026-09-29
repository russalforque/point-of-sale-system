import { PIN_PATTERN } from '../../api/authApi'
import { canHavePin } from '../../api/userApi'
import type { Role } from '../../utils/permissions'
import { SwitchRow, TextField } from '../ui/MobileKit'

export function pinError(pin: string | undefined): string | undefined {
  return pin && !PIN_PATTERN.test(pin) ? 'PIN must be 4 to 6 digits.' : undefined
}

/**
 * Approval PIN for managers and admins: they type it on a cashier's screen to approve a
 * refund or void. Hidden for cashiers, who can't approve anything.
 */
export function ApprovalPinField({
  role,
  pin,
  hasPin,
  clearPin,
  onPin,
  onClearPin,
}: {
  role: Role
  pin: string
  /** The account already has a PIN (editing). */
  hasPin: boolean
  clearPin: boolean
  onPin: (pin: string) => void
  onClearPin: (clear: boolean) => void
}) {
  if (!canHavePin(role)) return null

  return (
    <div className="space-y-3">
      {!clearPin && (
        <TextField
          label={hasPin ? 'New approval PIN' : 'Approval PIN'}
          optional
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(value) => onPin(value.replace(/\D/g, '').slice(0, 6))}
          error={pinError(pin)}
          hint={
            hasPin
              ? 'Leave blank to keep the current PIN.'
              : '4–6 digits. Lets them approve refunds and voids on a cashier’s screen.'
          }
        />
      )}
      {hasPin && (
        <SwitchRow
          label="Remove approval PIN"
          description="They won’t be able to approve for others."
          checked={clearPin}
          onChange={(checked) => {
            onClearPin(checked)
            if (checked) onPin('')
          }}
        />
      )}
    </div>
  )
}
