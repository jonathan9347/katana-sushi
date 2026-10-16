# Phase 0A migration plan (proposal only)

**Status:** Report-only proposal. No migration, database update, application-code change, or merge has been run. Target remains `katana_sushi_dev.public`; the older Supabase database is out of scope and must have its own backup and schema-specific migration before any live release.

## Proposed migration sequence

1. Confirm the development and live database targets without printing credentials. Export the development database and prove the dump restores into a separate empty database. Take a fresh pre-migration backup and verify it before touching the target.
2. Require explicit go-ahead, verify branch `revision-phase-0` and a clean worktree, and confirm the backend/frontend state and terminals. No migration is authorized by this report.
3. In a reviewed migration, change inventory stock, batch quantities, reorder levels, recipe quantities, snapshot/history quantities, and relevant lock quantities to whole-number base units (`BIGINT` in PostgreSQL / Prisma `BigInt`). Enforce whole-number input in service validation and staff screens. Do not round arbitrary fractional piece values silently.
4. Convert weight and liquid quantities exactly: `kg × 1,000 = g`, `L × 1,000 = ml`. Keep counted items as whole pieces/sheets. Convert Avocado to weight only:
   - Editable estimate: `AVOCADO_USABLE_GRAMS_PER_FRUIT = 150` g; this is not kitchen-confirmed.
   - Reorder level `10 pieces × 150 g = 1,500 g`; recipe amount remains `20 g`.
   - Cost basis `55 per fruit / 150 g = 0.366666… per g`, displayed as `36.666667 per 100 g`. A finite decimal cannot represent this ratio exactly. `DECIMAL(18,8)` is proposed for stored/displayed decimal costs, while the exact source basis (`55` per `150 g`) must remain available so conversion/display rounding is explicit rather than misrepresented as exact.
5. Convert Crabstick mismatched recipe lines to whole pieces using the proposals in `phase0-recipe-review.csv`; the two Classic Platter Crabstick lines become 31 and 25 pieces as derived in `phase0c-platter-mapping-proposal.csv`. There is no legacy-kg exception. These platter flat lines stay flagged and are superseded only if/when the 0C composition is approved.
6. Keep Kani tempura in pieces; the current mismatched line has a temporary estimate of 1 piece. Keep all unconfirmed recipe statuses visible as `recipe not confirmed`.
7. Keep the proposed sauce/garnish amounts in one shared editable setting each (report proposals only): Spicy mayo 10 ml (owner-confirmed), Teriyaki 10 ml (estimate), Sriracha 5 ml (estimate/default only; add no recipe lines), Aonori 1 g (estimate), and Tempura flakes 20 g (estimate). All recipe lines remain `recipe not confirmed`.
8. Do not merge the Softdrinks records in this migration without separate explicit approval. Proposed keeper is `cmv3t32dl00061da4l74v2ku0` (currently `Softdrinks (Coke/Sprite/Royal)`), to be renamed exactly `Softdrinks`; the trailing-space record `cmv6blwod028vn68q5g33s23u` is the proposed repoint source. Each currently has zero stock, reorder, and cost; both use bottles and have zero recipe, batch, transaction, movement, or hold references. Each has one zero-valued snapshot on `2026-10-14`. Repointing both snapshots would violate the existing unique key `(snapshot_date, raw_material_id)`. If approved later, retain one snapshot and archive/deduplicate the other deliberately; do not drop either record or snapshot before that decision.
9. Update seeds, `defaultRoll`, unit-conversion paths, and staff validation only in the separately authorized code phase. Customer-facing catering may continue to display kg at the presentation boundary; staff inventory remains in base units.
10. Keep the platter mapping in the report-only CSV for now. Phase 0C is a separate approval step; no Includes editor or runtime mapping has been built.

## Reported development-data baseline

The actual development database report had 42 materials, 57 recipes, 161 recipe lines, and 42 inventory snapshots; stock was zero across the reported materials, and there were no batches, sales, inventory transactions, movements, reservations, or active holds. Reconfirm counts during preflight because they can change.

## Rollback plan

1. Before migration, create a fresh full development dump and restore it into a separate empty database. Do not proceed unless the restore is verified.
2. Preserve exact pre-migration values for all affected material, recipe, batch, snapshot, transaction, movement, and lock rows (including IDs and units) in a migration backup. Apply schema and data changes in one database transaction where supported; validate integer constraints and row counts before commit.
3. If validation fails before commit, roll back the transaction. If the migration has committed but no new operational writes have occurred, stop the app and restore the preserved values/schema using the reviewed down-migration, then verify counts and sample rows.
4. If new writes occurred after migration, do not blindly restore the old dump or reverse rounded/estimated values. Stop affected operations, take another backup, reconcile post-migration writes, and only then restore or repair from the preserved pre-migration values.
5. Verify the restored development database independently before reconnecting the app. Supabase is never part of this rollback or migration.

## Decisions summarized in the companion reports

- Futo California in `Fried Roll` (`cmv3t2qbh002z6uns2tgzllq3`, recipe `cmv3t2qbi00316unsiz4vtyqh`) and `Futo Maki` (`cmv3t2qbm00366uns4ayau22g`, recipe `cmv3t2qbo00386unsnf4ofwpy`) are distinct products with distinct product and recipe IDs, not duplicate recipe lines. Matching display names alone do not cause a double deduction; selling both deducts each product's own recipe. The stale “Duplicate recipe line retained” note is absent from the updated recipe review.
- The platter product mapping, unconfirmed Kani/Tamago set-piece mappings, randomized Hoso/Futo selections, and computed ingredient totals are in `phase0c-platter-mapping-proposal.csv`. The Medium component quantities are scaled per product by `40/71`, rounded to nearest whole number with ties up and a minimum of 1 per included product. Set recipes are divided by the piece count; ingredient totals are rounded once per material, nearest whole unit, ties up.
- No merge, deletion, seed change, service/UI change, migration, or Supabase operation is included in this report update.
