# SELLIX Windows and Android implementation

Audit and verification dates: 20–21 October 2026.

## Delivery status

The shared app and Windows native source have been extended in place. This is **not yet a verified Windows release**: this workstation has no Rust/Cargo or Microsoft C++ build tools. `tauri build --no-bundle` stops at missing `cargo metadata`. Native Rust tests, the executable, NSIS installer, actual Windows backup/restore and real printer/drawer operation remain unverified. Do not deploy the desktop source to a trading register before completing the checks below.

The React production build, TypeScript and configured JavaScript lint checks pass. ESLint currently excludes TypeScript/TSX; strict TypeScript compilation is a separate check. The original verification covered 27 laundry and cross-platform tests against disposable SQLite. See the [latest system audit](system-audit-2026-10-21.md) for 44 passing tests, signed Android release results and remaining findings. Browser acceptance checks use an explicit in-memory SQLite transport and are not Android device tests or native Windows tests.

## Phase 1: inspected implementation

| Area | Existing implementation | Change / limit |
| --- | --- | --- |
| Storage | `src/database/sqlite.ts`: Capacitor SQLite, `sellix_posSQLite.db`, Android only; browser preview deliberately has no persistent database | Shared connection interface; Tauri SQLite adapter added. No browser storage database introduced. |
| Schema | Additive versions 1–8, recipes, ingredients, batches, stock ledger, users, roles, shifts, audit, laundry | Version 9 adds checkout retry records, receipt/order notes and an application schema ledger. |
| Sales | `salesApi`, `salePlan`, `payments`, inventory statement builders; atomic `executeSet` transactions | Durable request IDs, serialized retail planning, post-commit receipt errors distinguish saved sales. |
| Restaurant | Categories, required/single/multiple modifier groups, option pricing and ingredient effects, dine-in/takeout, split tender, Senior/PWD/manual discounts, held orders, returns, voids, reprints and daily reports | Added order notes, including hold/resume and printed receipts. Existing payment methods retained. Wallet/card entries remain manual records, not payment gateway capture. |
| Android printing | Custom `SellixPrinterPlugin.java`: Bluetooth Classic SPP and USB. A separate BLE implementation is used for browser development | Native Android transport retained. Printer protocols are not interchangeable. |
| Windows printing | `Sellix.PrintAgent`: server-polled RAW spooler queue | Kept intact. New desktop adapter prints locally without the API server or print agent. |
| Backups | Custom Android `SellixBackupPlugin.java`; authenticated `.sellix` archive and staged replacement | Windows implements the same wire format, local dialogs, verification, staged restore and a recovery copy. Native interoperability still needs execution tests. |
| Authentication | Local users and role checks; unsalted SHA-256 credentials; web preview demo login | Windows uses SQLite account checks. New password/PIN hashes use random salts and PBKDF2-SHA256, 600,000 iterations. Legacy hashes upgrade on successful verification. |
| Desktop layout | Existing product grid/cart, responsive tablet layout, search and barcode entry | Full HD mouse category rail; F2/search and F4/checkout; tablet controls retained. |

No retail, laundry, inventory or reporting module was removed. This checkout already contained uncommitted laundry/tablet work; those changes were retained. The cloud API and old print agent remain available for their original deployment and are not required for desktop offline sales.

## Phase 2: architecture choice

Tauri 2 was selected for Windows. It uses the installed Windows WebView2 runtime and a small Rust host. Electron embeds Chromium and Node.js. Reusing WebView2 is the better fit for the requested i3/8 GB target; actual startup/RAM measurements still need the packaged application. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [Electron architecture](https://www.electronjs.org/docs/latest/tutorial/process-model).

The Capacitor Android project stays in `android/`. Tauri stays in `src-tauri/`; both consume the same Vite build and business APIs. Windows uses hash routing so app reloads do not require a web server. Android retains its existing routes and native plugins.

Platform boundaries:

- `services/platform.ts`: native desktop detection, local-database availability and native invocation. An ordinary browser retains preview behavior.
- `database/connection.ts`, `database/desktop.ts`, `database/sqlite.ts`: common database contract and two native transports.
- `services/printer/windowsPrinter.ts`: Windows queue selection/checking and RAW bytes. The existing formatter, labels and drawer commands are shared with Android.
- `services/drawer.ts`: permission checks, completed-cash-sale checks, audit before sending and an outcome record.
- `utils/fileExport.ts`: a Windows Save As dialog, Android sharing, and browser download.
- `services/backup.ts`: common authorization/audit/reload workflow; native adapters own file access.

The two installations have independent databases. There is no automatic synchronization. Backup restoration deliberately replaces the selected installation's records after explicit confirmation; it is not a merge or synchronization feature.

Dashboard/report charts now load in separate bundles. The measured main Vite JavaScript output fell from about 2.11 MB to 1.61 MB (uncompressed); this is a bundle-size comparison, not a measured device startup/RAM result. Existing debounced/limited catalog searches, indexed history queries and database stock calculations are retained. There are no new polling services.

## Phase 3: persistence and recovery

Windows data is stored at:

```text
%LOCALAPPDATA%\Sellix POS\BusinessData\sellix_posSQLite.db
```

It is outside both the installation directory and Tauri's removable application-data directory. The uninstaller removes its shortcut/application files and does not target this business-data folder. This behavior still requires a real install/uninstall/reinstall test.

The Windows host owns one SQLite connection under a mutex, with foreign keys, WAL, a five-second busy timeout and FULL synchronous writes. `executeSet` runs an entire write inside one native `BEGIN IMMEDIATE`/commit/rollback. Desktop bulk imports use one native transaction instead of exposing a transaction across renderer callbacks. A single-instance plugin avoids a second desktop process allocating the same invoice number.

Version 9 is additive: no table is dropped, cleared or rebuilt. Existing NULL historical costs retain the pre-existing migration behavior. The schema ledger is separate from SQLite's `user_version`, which remains under Capacitor's control. Column introspection replaces swallowed ALTER failures; duplicate invoice numbers or real storage errors stop setup visibly instead of accepting an unsafe schema. A database stamped with a newer Sellix schema is rejected without resetting it.

Every new retail draft has a request ID. Clearing a draft, starting another completed sale or resuming a held order gives it a new ID. The ID, actor, submitted payload and sale ID are written in the same transaction as the sale, tenders, inventory and audit rows. Identical retries return the saved sale; changed retries with that ID are refused. If result delivery fails after commit, keep the draft unchanged and retry or check history. Never create a new sale merely to recover a receipt.

On Windows backup:

1. The native host takes a consistent SQLite backup, including committed WAL contents.
2. It verifies integrity, relationships and required tables.
3. It writes the existing Android-compatible AES-CTR/HMAC `.sellix` envelope, then verifies the encoded contents before saving atomically.
4. Restore authenticates before decoding, checks supported format/schema and stages a private database copy. Unsupported, incomplete, corrupt or inconsistent backups are rejected.
5. Confirmation suspends new database opens, closes the connection, retains a `before-restore-<timestamp>.db` recovery copy and atomically replaces the live file. Sign-in is cleared and the app reloads through normal migrations. A failure resumes the original connection workflow.

Native exports/backups cannot overwrite the business-data directory. Backups are limited to 512 MB; choose a separate drive/folder. Recovery copies are retained, not automatically rotated away. Protect them like the live database.

The `.sellix` format deliberately retains Android's existing embedded key for compatibility. It detects accidental damage but does not provide password-based confidentiality against someone who can inspect the app. The live SQLite database and recovery copies are not encrypted at rest. Existing default installation accounts are retained on a **fresh** installation; change their passwords and configure manager PINs before use. Missing default manager accounts are no longer recreated on established databases. Role checks protect normal application operations; this is an offline trusted-workstation model, not protection against a machine administrator editing application files or SQLite directly.

## Printer and drawer setup

On Windows, install the printer manufacturer's compatible driver, then choose its queue under **Receipt printer → Installed Windows printers**. USB and compatible driver-exposed Bluetooth queues use the Windows spooler. BLE-only devices or printers using proprietary protocols require a matching driver/adapter; the app does not guess a Bluetooth protocol. Select a printer supporting RAW ESC/POS, not a PDF or ordinary office printer.

Choose 58 mm / 32 columns or 80 mm / 48 columns. Test the receipt before enabling cutting or drawer operation. Queue accessibility/accepted job IDs do not prove paper was printed; check Windows queue status and inspect the physical slip. A failed/partial submission is surfaced, without automatic replay. Check the queue before manually reprinting, since ambiguous hardware delivery can otherwise duplicate receipts.

The receipt formatter includes business details, invoice, local date/time, cashier, items/options, quantities, prices, subtotal, discounts, tax, total, tender, change and notes. Android SPP/USB permissions, pairing and reconnection remain in the original transport.

Cash drawer commands are separate from sale persistence. Automatic opening requires an enabled setting and the cashier's completed cash sale. Manual opening checks the existing `drawer.open` role permission and records an attempt before sending; a printer failure records a failure. A failed print is followed by an independent drawer attempt, and neither changes the saved payment. Existing role grants, including cashier drawer access, are retained.

The timing UI now shows real milliseconds. ESC/POS pulse bytes use 2 ms units; legacy saved values are converted while preserving the exact prior command bytes. The defaults therefore display 50 ms on / 500 ms off. See the [Epson ESC p reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html). Verify the electrical connector, voltage, pin and timing against the actual printer/drawer manuals.

## Windows build

Install on the **development/build PC**:

1. Node.js 24 LTS (Node 22.13+ supports the test harness; this session used Node 25.2.1).
2. Microsoft Visual Studio Build Tools 2022, **Desktop development with C++**, MSVC x64/x86 tools and a Windows 10/11 SDK.
3. Rust via [rustup](https://rustup.rs/), using the `stable-x86_64-pc-windows-msvc` toolchain. Restart the terminal after installation.
4. Microsoft Edge WebView2 Runtime. It is already present on this workstation. The NSIS release configuration bundles its offline installer for deployment to offline tills.
5. Sufficient disk space for the toolchains, Cargo target directory, frontend and bundling tools. This session exhausted disk space during an optional test dependency download; temporary dependencies/caches were cleaned and project dependencies restored from `package-lock.json`.

From the repository root:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run desktop:test
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

The expected installer is in `src-tauri/target/release/bundle/nsis/`. It installs per user and creates a desktop shortcut. The installer is unsigned until a production code-signing certificate is configured. Tauri/NSIS/Cargo dependencies and the offline WebView installer require internet **at build time**, not during till operation. See [Tauri's Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/).

`.github/workflows/windows-desktop.yml` provides a manually triggered Windows verification/build job; it has not been executed in this session. After the first successful native build, retain/review the generated `src-tauri/Cargo.lock` for reproducible subsequent builds.

## Android build

Keep the existing Android Studio/JDK 21/SDK setup and the Gradle wrapper. On Windows:

```powershell
npm.cmd run android:debug
npm.cmd run android:release
```

Both commands check TypeScript, build Vite and run `cap sync android` before Gradle. The existing `android/keystore.properties.example` documents release signing; supply the original production key through the existing ignored properties file. Without that file the release artifact is unsigned. Do not replace a production key or change the application ID to install an update.

Debug output: `android/app/build/outputs/apk/debug/app-debug.apk`. Release output follows the existing `Sellix-POS-v<versionName>[-unsigned].apk` naming. The session verified a debug APK, not a signed production release or installation on an OPPO tablet.

## Phase 4: verification and remaining acceptance

Executed successfully:

- TypeScript, ESLint and Vite production build.
- Original 15 laundry tests plus cross-platform tests covering create/edit products, cash/tax/discount/change, history and notes, concurrent/repeated sale IDs, changed-payload rejection, interrupted transaction rollback, post-commit receipt recovery, reopen persistence, failed migrations, refunds/voids/authorization, drawer audit/failure, transport arguments, credential upgrades and receipt widths.
- Browser acceptance at 1920×1080, 1280×800 and 800×1280, plus coarse touch-pointer rotation. F2 search, Enter barcode entry, F4 checkout and suppression while typing passed. External resource requests were blocked during the desktop check. Screenshots were inspected; they are under `.qa/retail-ui/`.
- Capacitor Android sync and Gradle `assembleDebug --offline` with the existing native printer/backup plugins.

Native Rust unit tests are supplied for rollback and backup authentication but **could not run here**. Before production:

- Compile/test the Rust host, build and install the Windows installer, and verify shortcut, data location and persistence across app restart, Windows reboot, update, uninstall and reinstall.
- Run Windows backup/restore, corrupt/truncated/newer-schema rejection, disk-full failure, pre-restore recovery and Android↔Windows archive interchange on non-production fixtures. Confirm all retail/laundry tables, users, stock and audit rows survive.
- Test an actual USB thermal printer and any intended Bluetooth driver: both widths, long descriptions, accents/currency output, cutter, paper-out, power loss, disconnected/reconnected transport, spooler rejection, failed/partial submission and manual reprint.
- Test the actual cash drawer: authorized manual action/audit, cash/split/non-cash behavior, disabled automatic opening and printer failure after a committed sale.
- Install the APK on OPPO Pad SE and verify real touch controls, keyboard avoidance, portrait/landscape, app kill/restart, Android reboot, offline checkout and native backup/restore. Browser emulation does not establish these results.
- Confirm store prices, discounts, taxes and payment methods, and replace installation passwords/PINs before recording business transactions.

No hardware printing, physical drawer actuation, Windows native build, installer acceptance, native backup interchange or real-device Android acceptance is claimed by the browser/SQLite tests.

Dependency audit: compatible patches were applied to `brace-expansion` and `source-map-js`, removing the two reported high-severity advisories. Three moderate advisories remain in Capacitor CLI's iOS `xcode`/`uuid` toolchain. npm's proposed resolution downgrades the CLI outside the existing declared range; it was not forced into this Android change. Review with the next compatible Capacitor tooling update. These packages are build tooling and are not imported by the bundled POS renderer.
