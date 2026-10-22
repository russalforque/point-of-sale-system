# System audit and Android APK — 21 October 2026

## Result

Built and verified **Sellix POS 1.0.1**, Android version code **2**, application ID **com.sellix.pos**. The installable release APK uses the existing release key; its certificate matches the previous 1.0.0 APK. The connected tablet was not modified or updated.

- APK: [Sellix-POS-v1.0.1.apk](../artifacts/android/Sellix-POS-v1.0.1.apk), 14,420,366 bytes (14.4 MB).
- Checksum: [SHA256SUMS.txt](../artifacts/android/SHA256SUMS.txt).
- Dependency results: [npm-audit.json](../artifacts/android/npm-audit.json).
- Signature results: [signature-verification.txt](../artifacts/android/signature-verification.txt).

APK SHA-256: `8dcac7f437d326159e2c192b67b8c6cf2272e9b27ceab8b841082c800a71f72d`.

## Scope

Reviewed the shared offline retail/laundry implementation, authentication and authorization, shifts, financial transaction safeguards, database migrations, report export, native Android backup code, dependency advisories, and Android packaging/signing. Executed the existing SQLite tests and current shift browser acceptance tests. Preserved the checkout's existing uncommitted work and included the recent laundry and shift UI changes.

This audit does not establish Windows native, server-backed API, payment gateway, physical printer/drawer, or real-device operational acceptance. Browser checks use disposable SQLite fixtures and explicit native transport doubles. No business database was opened, restored, or changed by the tests.

## Confirmed issues fixed

| Priority | Finding and impact | Applied change |
| --- | --- | --- |
| High | npm reported high-severity advisories in Vite 8.2.1 and follow-redirects 1.16.0. | Updated Vite to 8.2.4 and follow-redirects to 1.16.1 within compatible version ranges; retained the lockfile. Final advisory query reports zero high/critical issues. |
| Medium | Shift operations trusted the stored session's employee identity without re-reading account activation. History and another employee's drawer details lacked operation-level authorization. | `src/api/shiftApi.ts` now revalidates active accounts and permissions, limits ordinary staff to their own shift details/movements, and requires `shifts.manage` for history. Invalid cash movement types are rejected. Regression tests confirm denied operations write no cash/audit rows. |
| Medium | The Android FileProvider metadata key contained a line break and spaces. Capacitor Share looks up the exact key, so report/template export could fail on Android. | Corrected `android.support.FILE_PROVIDER_PATHS`; verified the exact key in the compiled APK manifest. |
| Medium | FileProvider allowed the entire external-storage root and cache root, including native backup staging/snapshot files. | Restricted the provider to `cache/exports/`, matching the application's generated-file export path. Verified the compiled resource contains only this path. |
| Medium | Android backup imports read an unbounded provider stream and unbounded decompressed ZIP entries, including metadata held in memory. | Enforced a 512 MB archive/database limit and 64 KB metadata limit on actual streamed bytes. Rejects unexpected/duplicate ZIP entries. Added JVM tests for exact limits, unknown-length providers, and compressed expansion. Existing archive format and keys remain compatible. |
| Medium | Native backup validation checked SQLite structural integrity but omitted relationship checks and the actual database schema marker. | Added `PRAGMA foreign_key_check` and inspection of `sellix_schema` before accepting the staged backup. Broken relationships and databases newer than the supported schema are rejected before replacement. Compiled successfully; native restore acceptance remains pending. |

## Remaining findings

These remain open; the APK being signed does not resolve them.

| Priority | Evidence | Required follow-up |
| --- | --- | --- |
| High | `src/database/seed.ts:10` creates three accounts with known installation passwords on an empty users table. There is no mandatory first-login password replacement. | Replace installation passwords and configure manager PINs before recording business transactions. Add a first-run account setup/password-change requirement for unattended deployment. Established databases do not have missing default accounts recreated. |
| Medium | `src/database/sqlite.ts:63` opens the database without encryption. `SellixBackupPlugin.java` derives archive keys from a constant shipped in the APK. `AndroidManifest.xml:6` enables OS backup without explicit exclusion rules. | Treat device data and exported backups as sensitive. Add password-derived, versioned backup encryption and a compatible legacy importer; evaluate Android Keystore/database encryption and explicit OS backup/transfer exclusions. This patch keeps existing backups readable. |
| Medium | `AndroidManifest.xml:7` permits cleartext traffic; `MainActivity.java:25` explicitly allows mixed content. The current Capacitor origin is `http://localhost`. | Restrict network policy and mixed content after checking native WebView/printer behavior. Preserve or explicitly migrate existing WebView-origin storage when changing the Capacitor origin. No remote development-server URL is packaged. |
| Medium | Final npm audit has three moderate findings: `@capacitor/cli → xcode → uuid`. npm proposes Capacitor CLI 8.4.3, below the declared `^8.5.2` range. | Resolve with a compatible Capacitor tooling update. These are CLI/iOS tooling dependencies, not imports of the packaged React renderer. No forced downgrade or incompatible override was applied. See the saved advisory JSON for exact ranges and advisory links. |
| Medium | `eslint.config.js:10` matches JavaScript/JSX only. TypeScript/TSX is excluded from ESLint. | Configure a compatible TypeScript ESLint parser/rules and address its findings. Strict TypeScript compilation passed, but it is not equivalent to TypeScript ESLint/React Hooks coverage. |
| Medium | Native backup restore, report sharing, actual printer/drawer commands, cold start, app kill/restart, Android update persistence, keyboard avoidance, and device rotation were not exercised on the tablet. | Complete device acceptance on disposable data before using this release at a trading register. JVM stream tests do not exercise Android content providers or SQLite restore replacement. Windows Rust/MSVC and legacy backend runtime checks are outside this APK verification. |
| Low | Main JavaScript bundle is about 1.76 MB before gzip, plus an 813 KB logo; Vite emits a bundle-size warning. CSS requests Google Fonts with system fallbacks. | Split additional feature routes, compress the logo, bundle essential fonts locally, and measure cold start on the target tablet. Bundle size alone does not establish actual startup performance. |
| Low | Android application lint reports 0 errors and 17 warnings: manifest ordering, resource cleanup/icon issues, and usable-space checks. The host also reports an SDK metadata-version warning. | Clean up resources/manifest ordering and align Android command-line tools with Android Studio in a separate maintenance change. The current release build succeeds with the existing wrapper/JDK/SDK. |

## Verification performed

| Check | Result |
| --- | --- |
| `npm.cmd test` | 44 passed, 0 failed: retail/laundry transactions, retries/concurrent requests, rollback, migrations, authorization, customer-name-only orders, shifts, discounts/loyalty, reporting, receipt formatting, and printer-failure save preservation. |
| `npm.cmd run typecheck` | Passed with strict configuration covering `src`. |
| `npm.cmd run lint` | Passed for its configured JavaScript/JSX scope; TypeScript coverage gap documented above. |
| My Shift browser acceptance | Passed: start/zero float, duplicate taps, cash in/out validation, cash/noncash totals, close variance, new-shift isolation, eight viewports, long notes, filters, and error recovery. |
| Shift History browser acceptance | Passed after dependency patches: nine viewports, long names/large amounts, dialog focus, filters, rotation, pagination, and refresh error recovery. |
| Android backup stream JVM tests | 3 relevant tests passed, 0 failed. Gradle also executes the pre-existing arithmetic example test; it provides no operational assurance. |
| `:app:lintRelease` | Passed: 0 errors, 17 warnings. |
| `npm.cmd run android:sync` | Passed: TypeScript, Vite 8.2.4 production build, and all five native plugin syncs. |
| `:app:assembleRelease --offline` | Passed with JDK 21, Gradle 8.14.3, compile/target SDK 36, minimum SDK 24. |
| APK signature | `apksigner verify` passed with APK Signature Scheme v2; one signer. Certificate SHA-256 matches the previous APK: `d2f56fa56cbe327146a165586c10158b3bf03da162fb70376f9e4190243a2be1`. |
| Compiled APK inspection | App ID/version/minimum and target SDK verified; debugging is not enabled; ARM64, ARMv7, x86 and x86_64 native libraries included. Correct FileProvider metadata and export-only path verified. |
| Packaged frontend | All 16 files from the current `dist/` match APK asset SHA-256 hashes. ZIP CRC verification passed. No acceptance-test database bridge or development-server URL found in these packaged files/configuration. |
| Final npm advisory query | 0 critical, 0 high, 3 moderate. |

## Rebuild

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run android:sync
Set-Location android
.\gradlew.bat :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease --no-daemon --max-workers=2
```

Use the existing JDK 21/Android SDK and original ignored release-signing configuration. Do not replace the signing key or application ID for an update. The release output is `android/app/build/outputs/apk/release/Sellix-POS-v1.0.1.apk`.

The first packaging attempt exhausted this PC's disk space. An unused Gradle 9.1.0 transformation cache and task-created npm cache were removed; the final build then succeeded. Keep sufficient free disk space for subsequent Gradle builds. No source files, signing keys, installed apps, or business records were removed.
