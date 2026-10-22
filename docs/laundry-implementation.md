# Sellix multi-business implementation

These are the original implementation notes. The current three-status workflow, correction
policy and legacy archive are documented in [Laundry workflow (schema v11)](laundry-workflow.md),
which supersedes the earlier cancellation and processing-stage behavior described below.

## Existing application and plan

The operational client is React 19 / TypeScript / Vite with Capacitor 8. Android uses
`@capacitor-community/sqlite`, database `sellix_pos`; browser previews deliberately have
no database. The separate .NET API and Windows print agent are not the offline client's
storage or printer path. Retail uses local APIs, shared customers/settings/users, audit
statements and atomic `executeSet` writes. Native Bluetooth Classic/USB and browser BLE
share a printer interface and ESC/POS builder. Backup captures the complete SQLite file.

Implementation sequence:
1. Add schema v7 without dropping, rebuilding or converting retail records.
2. Add integer-cent laundry calculations, immutable price snapshots, order/payment/status
   ledgers, transaction validation, idempotency and permissions.
3. Store business selection in settings; preserve Retail for upgraded installations;
   require admin confirmation and a closed register for later changes.
4. Add responsive laundry dashboard, orders/detail, order creation, catalog and reports;
   reuse customers, staff, shifts, settings, exports, backup and printer transports.
5. Verify migrations, accounting and failure cases using real SQLite, then typecheck/build.

## Architecture and data

Laundry tables are separate from retail sales: services, addons, orders, order_items,
order_addons, payments, status_history. Money uses integer minor units; quantities use
integer thousandths (fractional kg only). Order prices/names/customer contact are snapshots.
Posted orders cannot be edited or deleted; catalog changes only affect future orders.
Payment records are append-only, use unique request keys, and belong to an open staff shift.
SQL guards overpayment, closed shifts, cancelled orders, terminal status changes and deletion.
Paid cancellation is refused until a future explicit refund workflow exists.

Collections are grouped by payment time, order value by order creation time, and outstanding
balances are reported separately. Laundry receipts reuse the existing ESC/POS builder and
queued transport jobs; printing never controls whether an order/payment commits. Compact
tags use the printed order number for offline lookup; QR generation is optional and omitted.

## Risks / device acceptance

Browser preview cannot verify persistence. Native plugin migrations, physical 58/80mm
printing, drawer pulses, offline restart and Android responsive interaction require device
acceptance. No payment-provider integration is introduced: GCash/Maya are manual records.
The existing SQLite backup automatically includes all laundry tables after schema upgrade.
The .NET server is not extended because the Android app does not use it for core operations.

## Business workflow

- Schema v7 adds `business_type` and `business_setup_complete` to `store_settings`.
  Existing rows default to `retail` / complete. Seeding a new settings row explicitly
  requires setup. The existing admin permission controls selection and later changes.
- Switching requires typing the target mode and closing every open shift. Switching to
  Retail also refuses unresolved laundry orders. Both businesses' records remain intact.
- Laundry uses shared customer creation/search and requires a name/contact number.
  Services support kg (three decimal places), load, piece and fixed pricing; add-ons
  support whole quantities or a fixed price. The catalog starts empty in production.
- Posted orders retain customer/name/price snapshots and cannot be edited or deleted.
  Catalog entries are deactivated rather than removed. Cashier discounts use the store's
  existing limit; larger discounts must be entered by a manager/admin.
- Orders start Received. Staff can skip unnecessary processing stages but cannot move
  backwards. Completion requires Ready for Pickup and zero balance. Cancellation requires
  manager/admin permission, a reason and confirmation. Paid cancellation is blocked.
- Pay later creates no artificial zero-value payment. Every collection requires an open
  shift and has a unique request key. Database triggers enforce the remaining balance and
  shift ownership at commit time. Cash tender/change never inflate collections.
- Receipt/tag printing is a separate action after saving and reuses both existing printer
  transports. Reprinting never collects money or opens the drawer. A configured drawer can
  open after a new cash collection; failure does not roll back a committed payment.
- Reports use payment timestamps for collections and order timestamps for bookings.
  Service/add-on revenue allocates each discount cent once using cumulative rounded shares;
  net service totals reconcile to net order value. Current outstanding balances include all
  dates and are explicitly labelled separately from the selected reporting period.
- Laundry prices are final configured prices. Retail tax/loyalty/credit/inventory settings
  are retained for Retail and hidden from the Laundry settings workflow.

## Modified files

| Area | Files |
| --- | --- |
| Schema and startup | `src/database/laundryMigration.ts`, `database.ts`, `seed.ts`, `sqlite.ts`; `src/main.tsx` |
| Domain types and precise calculations | `src/types/laundry.ts`, `src/types/index.ts`, `src/services/laundryMath.ts` |
| Local APIs | `src/api/businessApi.ts`, `laundryApi.ts`, `laundryReportsApi.ts`; `settingsApi.ts`, `shiftApi.ts` |
| Business selection and navigation | `src/App.tsx`, `src/context/SettingsContext.tsx`, `src/components/settings/BusinessSettings.tsx`, `SalesRulesSettings.tsx`, `src/components/layout/MainLayout.tsx`, `Sidebar.tsx`, `src/pages/mobile/MobileButtomNav.tsx` |
| Laundry screens | `src/pages/Laundry/Dashboard.tsx`, `NewOrder.tsx`, `Orders.tsx`, `Services.tsx`, `Reports.tsx` |
| Shared touch UI | `src/components/laundry/LaundryUI.tsx`, `laundry.css`; `src/pages/Settings.tsx`, `src/pages/mobile/MobileSettings.tsx` |
| Printing | `src/services/printer/laundryReceipt.ts`, `laundryPrinting.ts`, `types.ts`, `nativePrinterService.ts`, `bluetoothPrinter.ts` |
| Audit and exports | `src/services/audit.ts`, `laundryExport.ts`, `src/utils/reportExport.ts` |
| Checks and documentation | `tests/laundry.test.mjs`, `tests/ui-preview.mjs`, `tests/laundry-ui.mjs`, `package.json`, `eslint.config.js`, `README.md`, this document |
| Existing compile cleanup | Removed two unused declarations in `src/components/ui/Icons.tsx` and `src/pages/Categories/POSCategories.tsx` so the project typecheck passes. |

The four pre-existing modified .NET `obj` files were left untouched. No production database
was opened or altered during development; migrations were tested on disposable databases.

## Verification

`npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build` pass. The build retains
the existing warning about a JavaScript chunk over 500 KB; no new runtime library was added.
ESLint now ignores generated Android/Gradle/.NET output instead of linting copied bundles.

`npm.cmd run test:laundry`: **13 passing integration tests**, running the production
migrations/APIs/calculations/formatters against real SQLite with only the Capacitor bridge
replaced. Coverage includes:

- Additive upgrade, existing Retail settings/data, repeated initialization, foreign keys
  and SQLite integrity; first-time setup and business switching restrictions.
- Retail checkout after v7: tax, stock movements, tender/change, shift collection totals.
- Invalid money/quantities, kg rounding, fixed prices, service snapshots and permissions.
- A 350 order with 150 cash (200 tendered / 50 change) and 200 later via Maya, with one
  collection per payment and correct outstanding/shift/report totals.
- Concurrent duplicate order/payment requests, mismatched retry payloads, overpayment
  races, interrupted transactions and successful retries after rollback.
- Forward status transitions, history, cancellation permissions, paid cancellation refusal,
  completion requirements and zero-value orders.
- Exact service/add-on discount allocation; payment-date versus order-date reporting.
- Persistence after closing/reopening a file-backed SQLite database.
- Immutable ledgers, parameterized writes, foreign keys, 58/80mm receipt/tag widths,
  manual wallet labels, CSV formula escaping and generated PDF structure.

The headless Chrome acceptance flow uses the actual React application and local APIs with
an in-memory SQLite transport. It verifies setup, opening a shift, creating an order,
partial/final payment, Ready/Completed status, receipt preview, reports and absence of
browser runtime errors. Service configuration, shared customer creation and Laundry settings
visibility also pass. Viewports checked: 1280×800, 800×1280, 390×844 and 844×390, including
horizontal overflow checks. Dashboard, order detail and reports were inspected visually.
This harness is test-only and is never
included in production startup or used to replace device persistence.

`npx.cmd cap sync android` completed successfully. `assembleDebug --offline --no-daemon`
also passed using the installed Android Studio JDK (`C:\Program Files\Android\Android Studio\jbr`).
The generated QA APK is `android/app/build/outputs/apk/debug/app-debug.apk`. It was not
installed on a device. Existing Gradle/SDK/plugin deprecation warnings remain; no native
source changes or production signing changes were needed.

## Remaining acceptance checks and deliberate limits

- Run the upgraded APK against a copy of a real shop backup on Android. Verify native
  plugin migration/transaction behavior, force-stop/reboot persistence and airplane-mode
  operation. Node/browser tests do not prove those Android-specific behaviors.
- Test physical 58mm/80mm Bluetooth Classic/USB output, disconnected printer errors,
  drawer pulses, paper cutting where configured, and native CSV/PDF sharing.
- Paid-order refunds are not implemented. Paid orders cannot be cancelled or deleted.
  Orders are immutable; a correction to an unpaid order requires cancellation/re-entry.
- Optional QR tags are not implemented. A printed order number supports local offline
  search, including keyboard-style scanners that type that number.
- There is no external wallet verification, automatic cloud sync, machine assignment or
  machine timing. Existing local backup/restore remains the recovery mechanism.
- Existing default-account seeding is unchanged. Change the seeded account passwords
  before using a fresh installation in a real shop.
- The browser acceptance harness uses HTTP only to stand in for the native bridge;
  production laundry operations call the local Capacitor SQLite connection directly.
