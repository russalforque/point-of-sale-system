import { useState } from 'react'
import { businessApi } from '../../api/businessApi'
import { useSettings } from '../../context/SettingsContext'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { LaundryCard, LaundryField, useLaundryAction } from '../laundry/LaundryUI'
import type { BusinessType } from '../../types/laundry'
import { Button } from '../ui/Button'

export function BusinessSettings({ setup = false }: { setup?: boolean }) {
  const { settings, reload } = useSettings(),
    { can, logout } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<BusinessType>(settings.businessType)
  const [confirmation, setConfirmation] = useState(''),
    { busy, run } = useLaundryAction()
  const canManage = can('settings.manage')
  return (
    <div className="laundry-screen" style={setup ? { maxWidth: 760, paddingTop: 'max(24px, env(safe-area-inset-top,0px))' } : undefined}>
      <LaundryCard title={setup ? 'Welcome to Sellix. Choose your business.' : 'Business type'}>
        <div className="laundry-stack">
          <p className="laundry-muted">
            {setup
              ? 'Choose the workflow for this device. Your customers, staff and printer are shared.'
              : `Current workflow: ${settings.businessType === 'laundry' ? 'Laundry Shop' : 'Retail Store'}. All existing records are retained when switching.`}
          </p>
          {canManage ? (
            <>
              <div className="laundry-grid two">
                {(['retail', 'laundry'] as const).map((type) => (
                  <button
                    type="button"
                    key={type}
                    disabled={busy}
                    className={`laundry-choice ${selected === type ? 'selected' : ''}`}
                    onClick={() => {
                      setSelected(type)
                      setConfirmation('')
                    }}
                    aria-pressed={selected === type}
                  >
                    <div>
                      <strong>{type === 'retail' ? 'Retail Store' : 'Laundry Shop'}</strong>
                      <p className="laundry-muted">
                        {type === 'retail'
                          ? 'Products, stock and checkout'
                          : 'Services, order tracking and balances'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="laundry-muted">
                Close all shifts before switching. Complete laundry pickups and settle outstanding balances before returning to
                Retail. Records are never converted or removed.
              </p>
              <LaundryField
                label={`Type SELECT ${selected.toUpperCase()} to confirm`}
                value={confirmation}
                disabled={busy}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
              <Button
                disabled={busy || confirmation !== `SELECT ${selected.toUpperCase()}`}
                onClick={() =>
                  void run(async () => {
                    await businessApi.select(selected, confirmation)
                    await reload()
                    setConfirmation('')
                    navigate('/dashboard', { replace: true })
                  })
                }
              >
                {busy ? 'Saving…' : setup ? 'Continue' : 'Change business type'}
              </Button>
            </>
          ) : (
            <p>Ask an admin to {setup ? 'complete setup' : 'change the business type'}.</p>
          )}
          {setup && (
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          )}
        </div>
      </LaundryCard>
    </div>
  )
}
