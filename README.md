## Windows desktop and Android

The existing app now includes a Tauri 2 Windows host, local SQLite adapter, local Windows
ESC/POS printer queues, backup/restore and file-export adapters. Android continues to use
Capacitor and its existing native plugins. Retail checkout adds durable retry IDs, receipt
notes, audited drawer commands and desktop keyboard shortcuts.

Read the [cross-platform audit, build instructions and verification limits](docs/cross-platform-implementation.md)
before deployment. The Windows native build is pending Rust/MSVC installation on this PC;
physical printing, drawer and device acceptance are still required.

The [21 October system audit and signed Android APK results](docs/system-audit-2026-10-21.md)
record the latest fixes, remaining findings, test evidence and release checksum.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run desktop:test
npm.cmd run desktop:build
npm.cmd run android:debug
```

The Windows build needs Rust, Microsoft C++ Build Tools and WebView2. Business data is kept
separately from installation files. See the implementation notes for backup compatibility,
account setup, printer requirements and installer validation.

## Legacy API print agent

This section describes the retained server-backed deployment. The native Android app and
new Windows desktop adapter print locally without this API queue or agent.

Sellix sends completed receipt data to `POST /api/printing/receipt`. The API formats the data as raw ESC/POS bytes and stores each job in the `PrintJobs` queue. The Windows agent polls the deployed API and prints locally, so the cloud API never needs to reach into the store network.

Apply the generated EF migration during deployment. Build and run `Sellix.PrintAgent` on each POS computer, then set `Printer:PrinterName` to the exact Windows printer queue name, `Printer:ApiUrl` to the deployed API URL, and use the same strong random value for `Printer:AgentKey` and the API's `Printing:AgentKey`. The agent uses the Windows spooler RAW path and never replaces the USB Printing Support driver.
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
## Offline Android business modes

Sellix supports Retail Store and Laundry Shop in one Android app. New installations ask
an admin to select a business type after sign-in. Existing installations stay in Retail.
Admins can change the mode in Settings after closing all shifts; unfinished laundry orders
must be completed and outstanding balances settled before returning to Retail. Switching keeps all records.

Laundry uses local SQLite services/prices, shared customers and staff, status history,
partial payments, order balances, reports, and the existing Bluetooth Classic/USB printer.
GCash and Maya payments are manual records. Configure final service prices, including any
applicable tax, in **Services & Add-ons**. Open **My Shift** before collecting payments.
Backups include both businesses because they capture the whole SQLite database.

Validation (Node 22.13+; this workspace was checked with Node 25):

```powershell
npm.cmd run typecheck
npm.cmd run test:laundry
npm.cmd run lint
npm.cmd run build
npx.cmd cap sync android
```

`test:laundry` runs production TypeScript against a disposable SQLite database using Node's
experimental SQLite/VM APIs. For optional browser acceptance testing, start
`node --experimental-vm-modules tests/ui-preview.mjs`, then run
`node tests/laundry-ui.mjs <path-to-playwright-core/index.mjs>` with Chrome installed.
That harness replaces only the native database transport and uses in-memory test fixtures.
Ordinary web preview still has no persistent SQLite database.

See [implementation and verification notes](docs/laundry-implementation.md) for migration
details, changed files, and device acceptance checks.

Laundry tablet refinements use the existing Sellix controls with a Customer → Services →
Review → Payment wizard, a landscape service/summary split, configurable service categories
and customer laundry history.
See the [tablet audit and changed-file list](docs/laundry-tablet-audit.md) for layout decisions,
verification results and remaining OPPO Pad SE acceptance checks. Schema v8 adds catalog
categories without rewriting saved orders or Retail records.

Schema v10 adds the initial laundry price list, editable named discounts, configurable visit
qualification and stacking, and immutable discount snapshots. See
[laundry pricing and loyalty configuration](docs/laundry-pricing.md) for initial values,
owner controls, calculation rules and offline/device verification details.

Schema v11 simplifies Laundry Mode to Received → Ready for Pickup → Completed, with pickup
confirmation, documented manager corrections and configurable unpaid pickup policy. Legacy
processing statuses migrate to Received; historical cancellations stay in a read-only archive.
See [laundry workflow and migration](docs/laundry-workflow.md).
