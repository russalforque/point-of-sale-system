import { MobilePayment } from './mobile/MobilePayment'

/**
 * Legacy full-page checkout route (`/payment`).
 *
 * Both registers now take payment in PaymentModal, and nothing in the app links here
 * anymore. The route stays for anyone with a bookmark, and renders the shared
 * full-screen payment flow so settlement logic isn't duplicated in a second copy.
 */
export function PaymentPage() {
  return <MobilePayment />
}

export default PaymentPage
