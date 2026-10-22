# Laundry pricing and visit discounts

Laundry configuration belongs to the shop's offline SQLite database. Retail products, prices,
discount settings, loyalty points and sales remain separate. Schema version 10 adds tables
and columns without rebuilding or rewriting posted orders.

## Initial catalog

All eleven offerings start with **fixed pricing**, charged once per selected offering. No
weight, load or piece assumptions are derived from the reference prices.

| Category | Offering | PHP |
| --- | --- | ---: |
| Core services | 1-DRY | 65 |
| Core services | 1-FOLD | 30 |
| Core services | 1-WASH | 80 |
| Core services | Drop Off | 175 |
| Core services | Rush Order | 245 |
| Core services | Self-Service | 145 |
| Special-item services | Bedsheets / Linens | 185 |
| Special-item services | Comforter | 200 |
| Optional add-ons | Extra Detergent | 15 |
| Optional add-ons | Extra Fabcon | 15 |
| Optional add-ons | Extra Wash / Rinse / Dry | 20 |

Open **Services & add-ons** to edit names, prices, category names, pricing units and active
status. Category names are free text, with existing names offered as suggestions. Services
support fixed, kilogram, load and piece pricing; add-ons support fixed or quantity pricing.
Remove hides an offering from the catalog while retaining its saved transaction references.
Rush Order starts as a standalone service. Owners can adjust these initial groupings.

## Initial discounts and owner controls

Open **Services & add-ons → Discounts & loyalty**. The initial rules are:

| Discount | Value | Initial eligibility |
| --- | ---: | --- |
| 5th Visit | 20% | Next qualifying visit is number 5 |
| 10th Visit | 100% | Next qualifying visit is number 10 |
| Student | PHP 30 | Cashier confirms student ID as instructed |
| Wednesday Promo | PHP 30 | Wednesday, using the shop device's local day |

Initially, discounts apply to the whole order, including add-ons. Visit milestones are
one-time rewards, not automatically recurring. The owner can change percentage/fixed values,
target visit, repeat interval, available weekday, eligibility instructions, active status,
stackability and scope: whole order, services, add-ons or selected categories.
Student eligibility is a cashier decision; the app does not infer enrollment from customer
records. Eligibility instructions appear on the selection button.

**Configure rules** is restricted to owners/admins. By default a visit is an order that:

- has reached Completed (collected),
- is fully paid, and
- has a subtotal of at least PHP 0.01 before discounts.

Received orders and archived legacy cancellations do not count. Owners can instead count ready or
completed orders, allow unpaid qualifying orders, set a minimum amount and choose whether the
minimum uses the subtotal or total after discounts. Each order counts at most once. Measuring
before discounts lets a completed 100% reward order count as a visit.

The register and customer profile show the qualifying visit counter. Reward eligibility is
checked against `qualified visits + 1` when saving. A positive visit reward reserves that
customer's milestone immediately; another open order cannot reuse it. Historical cancelled
orders release their reservation while keeping discount history. Status corrections do not
release rewards, so reopening an order cannot reuse a benefit. Previously used rewards
stay protected when qualification rules are changed. A zero-value discount does not reserve
a reward. Rules are recounted against order history, rather than incrementing a counter for
every newly recorded order.

## Calculation and history

Stacking is off initially. Selecting a named discount replaces other selections and clears
the manual discount. The API independently enforces the rule. When stacking is enabled, all
selected named discounts must permit stacking. They apply in saved creation/ID order to the
remaining eligible line amounts; a manual discount applies last. Fixed discounts are capped
at their remaining eligible amount. Percentages use integer basis points, and allocation uses
integer-cent rounding so allocations sum exactly to the discount. Totals never become negative.

Manual discounts retain the existing cashier limit. Owner-configured named discounts follow
their configured eligibility, so a cashier can apply a valid 100% loyalty reward. Catalog and
discount management require the existing product-management permission.

The same calculator is used for the register preview and authoritative posting. Posting checks
the displayed pricing key and SQLite guards reject concurrent price/rule changes. Staff return
to Review and use **Refresh prices & discounts** when a quote becomes stale. Order, line prices,
discount rule/name/value snapshots, per-line allocations, reward reservations and initial
payment commit in one transaction. Request keys retain the existing duplicate-tap protection.
Receipts and transaction details display saved discount names and values. Service reports use
the saved allocations; older orders retain their previous proportional allocation behavior.

## Seeding and upgrades

Defaults seed on first Laundry setup, or the next startup for an existing Laundry shop.
All seed rows and the shop's defaults marker commit together. Case-insensitive matching names
already in either laundry catalog are preserved, including custom prices and inactive items.
The marker prevents later edits/removals from being overwritten or resurrected. Retail Mode
does not seed a laundry catalog. Backups include the new configuration and transaction tables.

## Tablet behavior and verification

The existing Customer → Services → Review → Payment wizard remains in use. On landscape
viewports with at least 850px of page content, Services uses a split register: services on the
left and a live, independently scrollable order summary on the right. Portrait uses one
column; the existing total/action bar remains available. The same mounted form retains its
customer, quantities, notes and discount selections when rotating the device. Existing
Sellix buttons, fields, catalog cards, manual discount input and payment controls are reused.

The SQLite regression suite covers exact seed values, interrupted seeding, migration/data
preservation, custom catalog edits, eligibility/stacking, capped discounts, line allocation,
cash change, balances, concurrent reward claims, cancellation, snapshots, stale quotes,
printing failures and retail checkout. `tests/laundry-ui.mjs` includes landscape/portrait
layout and discount-editor acceptance checks. Physical OPPO Pad SE validation still requires
a connected QA device; never run disposable acceptance fixtures against a shop database.
