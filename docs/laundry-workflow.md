# Laundry workflow (schema v11)

The active workflow has exactly three statuses:

1. **Received** is assigned automatically when an order is saved, including paid and pay-later orders.
2. **Ready for Pickup** is selected by staff when the laundry can be collected.
3. **Completed** is selected after collection. A confirmation dialog must be explicitly submitted.

Dashboard totals, order filters, order details and reports use these three statuses. Order details
show one next-step action, using the existing Sellix buttons, dialogs and status badges. On phones
the action stays above bottom navigation; tablets retain large inline actions. Status dialogs have
48px minimum controls, scrollable content and visible footer actions in portrait and landscape.
No machines, timers or extra processing stages are involved.

## Payment and corrections

Payment status remains independent. The default policy requires payment in full before completing
pickup. An admin can change **Services & add-ons → Discounts & loyalty → Configure rules → Allow
pickup with an unpaid balance**. If enabled, a Completed order retains its unpaid balance in
customer summaries, dashboard balances and reports, and staff can collect it later. Changing the
policy does not rewrite existing transactions. Loyalty visit qualification remains a separate rule.

Managers and admins can use **More actions → Correct status** to fix any active status, including
reopening a Completed order. A reason is required; corrections to Completed still require pickup
confirmation and follow shop payment policy. History preserves the original status, new status,
staff member, timestamp and reason. Corrections do not change payments, pricing or discount
snapshots and do not release previously reserved loyalty rewards.

## Legacy migration and offline persistence

The additive v11 migration maps Washing, Drying and For Folding to Received because those orders
were not yet ready for collection. Existing Received, Ready for Pickup and Completed values remain.
Original history entries remain unchanged; each mapped order receives an explicit migration entry
and its previous status is retained in `legacy_status`.

Historical Cancelled orders retain their stored status and history in a read-only **Legacy archive**
on the order list. They are excluded from active queues, order/service totals and outstanding
balances. Posted payment collections remain in the financial ledger and reports. Cancelled is not
an available status or a new operation. There is no recreation, deletion or repricing of orders,
customers, service snapshots, discounts, payments or Retail data.

SQLite guards enforce the three statuses, sequential normal changes, authorized corrections,
confirmation, shop payment policy and archive immutability. History, status revision and audit
entry commit together. Compare-and-update revisions reject stale corrections, while repeated taps
on the same next status do not create duplicate history. Migration markers and unique event keys
make initialization repeatable. All writes use the existing local SQLite transaction transport;
no network connection is needed. Backups include the additive columns and history.

## Verification

`npm.cmd test` exercises production API/migration code against disposable real SQLite databases.
Coverage includes legacy mapping and archival, unchanged snapshots and collections, repeat
initialization, role checks, required correction reasons, pickup confirmation, SQL bypass guards,
duplicate status requests, interrupted-write rollback, unpaid completion policy, later payments,
loyalty qualification, report balances and file-backed offline reopening. Retail regression tests
remain in the same suite.

`tests/laundry-ui.mjs` includes optional portrait/landscape action and confirmation acceptance
checks. A physical OPPO Pad SE and browser automation were not available in this session;
touch, keyboard and layout acceptance on that device remains a manual check.
