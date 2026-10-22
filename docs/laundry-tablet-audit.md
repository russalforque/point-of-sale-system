# Sellix Laundry tablet integration

Implementation date: 20 October 2026. This refines the Laundry implementation already
present in the working tree; existing Retail and unrelated edits are retained.

## Codebase audit and reuse decisions

Installed versions inspected: React 19.2.8, TypeScript 7.0.2, Vite 8.2.1, Tailwind 4.3.3,
Capacitor 8.5.2 and Capacitor Community SQLite 8.1.1. Native Android operations
use the Capacitor SQLite connection (`sellix_pos`), local APIs and atomic transactions.
The normal web preview deliberately has no persistent database. The .NET server is not
the Android client's operational storage. Laundry receipts already share Retail's
ESC/POS builder and queued Bluetooth Classic/USB/BLE printer transports.

| Existing component or system | Integration |
| --- | --- |
| `MainLayout`, sidebar, mobile bottom navigation and More sheet | Retained; active order navigation, accessible rail labels and safe-area sizing improved. |
| `WorkPage.Panel` | Laundry dashboard, service, customer, summary and detail cards now compose the same panel. |
| `Button`, `Field`, `Input` | Used in Laundry instead of a parallel button/input design. `ButtonLink` shares button styling. |
| `SearchBox`, `PillGroup`, `Pagination`, loading/error states | Reused for quick customer/catalog lookup, categories and customer history. |
| `Modal`, mobile `Sheet`, `BackLayer` | Retained and improved for available height, focus, internal scrolling and fixed actions. |
| Desktop and mobile customer screens | Retained; a shared `CustomerLaundryPanel` replaces Retail purchases/credit in Laundry profiles. |
| Local APIs, integer-cent calculations, shifts and idempotency | Preserved. Category metadata and an aggregate customer summary extend these APIs. |
| Receipt generation and physical printer transports | Preserved. Save-and-print commits first and offers a separate print retry on failure. |

No new runtime dependency or unrelated UI library was introduced.

## Changes and audit fixes

- **New order:** replaced the five-screen wizard with one page. Customer selection,
  services, optional add-ons, pickup, notes, summary and payment remain mounted during
  orientation changes. Selected customers collapse to a compact contact row. Search,
  category pills, decimal kg inputs and whole-count inputs reduce typing.
- **Landscape:** a two-panel order layout appears when at least 900 CSS pixels of
  *content* width are available, after the navigation rail and padding. The summary
  scrolls independently with save actions visible. Short windows use normal page flow.
- **Portrait:** a single column preserves usable form widths and a sticky total/review
  shortcut jumps to payment. Cards use available-width grids. Essential order fields
  become two-column order cards; payment/status actions precede history in order details.
- **Dashboard:** retains the Sellix heading, panels and brand tokens, showing collections,
  orders received today, in-progress work (including received loads), ready/completed orders
  and outstanding balances in a balanced six-card grid.
- **Orders:** search, received-date/status filters, clear filters, visible payment states,
  full-row detail access and adaptive rows. Cancelled orders do not imply a payable balance.
- **Services:** name/category search, category configuration, pricing method and availability.
  Categories are also available in new-order selection. Existing add-on configuration remains.
- **Customers:** total and active order counts, outstanding balance and paginated order history
  in both customer interfaces. Aggregate counts include orders beyond the first history page.
- **Reports:** collected-payment tables become labelled records at narrow content widths;
  essential information needs no horizontal scrolling.
- **Dialogs:** action footers stay outside scrollable fields. Shared modal and sheet focus
  handling traps Tab, restores focus and locks background scroll. Laundry catalog, payment,
  cancellation and receipt dialogs use existing back-stack dismissal. A StrictMode duplicate
  history-entry bug in the shared back hook was fixed.
- **Available height:** visual viewport resize/scroll updates shared CSS viewport variables.
  Dialog and app height follows these variables with safe-area padding. Dialog geometry
  changes immediately; inherited transition durations previously animated height during
  rotation and briefly put footer actions outside the visible viewport.
- **Validation:** native required/min/max/step constraints and existing domain validation
  remain active. Inline order feedback updates as staff correct selections and payment.
  Existing action locks and request keys protect against duplicate orders/payments.

## Persistence upgrade

Schema version **8** adds a default-empty `category` column to both Laundry catalog tables.
Startup checks table metadata before each ALTER, so failures are surfaced and repeated
initialization is safe. Tables, customer records, order snapshots, payment ledgers and
Retail records are not rebuilt. Backup version stamping uses the existing schema constant.

## Files changed by this refinement

- `src/App.tsx`
- `src/api/laundryApi.ts`
- `src/database/database.ts`
- `src/types/laundry.ts`
- `src/components/layout/MainLayout.tsx`, `Sidebar.tsx`
- `src/components/settings/BusinessSettings.tsx`
- `src/components/ui/Button.tsx`, `Modal.tsx`, `MobileKit.tsx`
- `src/components/laundry/LaundryUI.tsx`, `laundry.css`
- `src/components/customers/CustomerLaundryPanel.tsx` (new)
- `src/hooks/useVisualViewport.ts`, `useDialogFocus.ts` (new), `useDismissOnBack.ts`
- `src/pages/Laundry/Dashboard.tsx`, `NewOrder.tsx`, `Orders.tsx`, `Services.tsx`, `Reports.tsx`
- `src/pages/Customers/CustomersPage.tsx`, `src/pages/mobile/MobileCustomers.tsx`
- `tests/laundry.test.mjs`, `tests/laundry-ui.mjs`
- `tests/tablet-device.mjs`, `tests/android-qa.init.gradle`, `tests/android-qa-manifest.xml` (new, optional physical-device QA tools)
- `README.md`, this audit

## Verification and physical-device limits

TypeScript, ESLint and the Vite production build pass. All **15** real-SQLite integration
tests pass, including additive v7-to-v8 catalog upgrades, existing Retail checkout/stock/tax,
customer totals beyond 30 history records, partial/final payments, duplicate submissions,
transaction rollback, status guards, file reopen persistence and 58/80mm receipt formatting.

`npx.cmd cap sync android` and `assembleDebug --offline --no-daemon` pass using the installed
JDKs. The optional Gradle QA init script requires the installed JDK 21
(`C:\Users\PC\.jdks\jbr-21.0.11`); JDK 25 cannot compile this test-only Groovy init script.
The final debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`, verified with
the normal `com.sellix.pos` application ID. The QA artifact used during the physical run is
`android/app/build/tablet-qa/sellix-tablet-qa.apk`.
Existing large JavaScript chunk, Android SDK metadata and Gradle/plugin deprecation warnings
remain. Release signing and native printer code were not changed by this refinement.

Browser acceptance uses the real React app and production local APIs against disposable
SQLite, substituting only the Capacitor transport. That transport uses local HTTP solely
for testing, so browser offline mode cannot establish native offline persistence.

The complete Chrome acceptance runner passes: setup, category configuration/filtering,
customer creation, validation, orientation state, expanded/collapsed sidebar, partial/final
payment, modal focus and fixed footers, statuses, receipt preview, reports, empty filters,
catalog error/retry, and double-tap save-and-print with no configured printer. Print failure
retains one saved order and reports a separate print retry. Seven pages were checked for
horizontal overflow at 1280×800, 800×1280, 1024×600, 600×960, 390×844 and 844×390. Customer
profiles and catalog dialogs were also checked at each width. Browser screenshots from the
passing run: `C:\Users\PC\AppData\Local\Temp\sellix-ui-qa-e8uRQr`.

## Physical OPPO validation completed

The reconnected OPPO `OPD2419` reports a physical 1200×1920 display at density 280.
An explicitly separate **Sellix Tablet QA** app (`com.sellix.pos.tabletqa`) was built from
this implementation. Its own native SQLite database contained only disposable QA
records. The installed `com.sellix.pos` app was not upgraded, and its database was not opened
or migrated by this work.

| Check | Observed result |
| --- | --- |
| Actual landscape viewport | Approximately **1097×649 CSS px**, DPR **1.75**. |
| Actual portrait viewport | Approximately **686×1060 CSS px**, DPR **1.75**. |
| Dashboard, new order, orders, detail, services, reports, customer profile | All seven pages passed body/content overflow checks in both orientations. Native screenshots captured. |
| Native schema and local CRUD | Startup/schema v8, categories, service/add-on creation, customer creation and staff shift worked through the actual Capacitor SQLite plugin. |
| Orientation state | Customer, 5 kg weight, selected add-on, discount and notes survived portrait then landscape rotation before save. |
| Real Android keyboard | Landscape height reduced to approximately **313 CSS px**. Notes remained usable; payment dialog footer stayed inside the reduced viewport. |
| Android Back | Hid the keyboard, then dismissed the payment dialog while keeping the order open. |
| Payments/status/receipt | 375 subtotal − 25 discount = **350** total; **150 cash**, **200 tendered**, then **200 Maya**. Ready/Completed and receipt preview passed. |
| Native integrity | `PRAGMA integrity_check = ok`, no foreign-key violations, exactly **1 order / 2 payments / 35000 collected cents**, category column present. |
| Offline cold start | Airplane mode enabled and Wi-Fi disabled; Android reported **no active default network**. Force-stopping/restarting the QA app retained Completed status, notes, payments and the 350 collection report. Native integrity rechecked successfully afterward. |

Native screenshots and viewport/integrity JSON evidence are in
`android/app/build/tablet-qa/`. DevTools screenshots were unreliable on this WebView;
the final page audit used Android's native screenshot capture, guarded to refuse capture
unless the QA package was foreground. The QA app was then uninstalled, its USB debug
forward removed, and the original airplane/Wi-Fi/mobile-data and rotation settings restored.
The final visual review also made total rows use an explicit two-column grid for reliable
label/amount alignment. This final CSS adjustment was checked in Chrome at both measured
device viewports (1097×649 and 686×1060), then included in the final normal debug APK.

## Remaining physical acceptance

Physical 58/80mm paper output, Bluetooth/USB permissions and reconnect behavior, drawer
pulses, native exports/sharing and backup restore were not exercised. A physical reboot and
an upgrade using a copy of a real shop backup also remain; the device run used a fresh QA
database and force-stop/restart. Existing printed-width, additive upgrade and SQLite file
reopen integration tests cover their software-side contracts. Browser viewports remain
preliminary checks rather than substitutes for other Android display-scaling/IME settings.
