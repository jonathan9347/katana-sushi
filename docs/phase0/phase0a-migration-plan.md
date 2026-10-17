# Phase 0A migration report

**Status: Applied to `katana_sushi_dev.public`.** The Phase 0A cleanup migration zeroed the two invented platter Crabstick quantities, marked both platter recipes as superseded by composition, and made both products unavailable. The original pre-migration platter values were 0.020 kg each. The older Supabase database was not touched.

## Changes applied

1. Inventory and recipe quantities, stock counts, batches, snapshots, transactions, movements, locks, and system default reorder levels now use whole-number types (`BIGINT`, except `system_settings.default_reorder_level`, which is `INTEGER`). The server and staff screens reject fractional stock, batch, reorder, waste, reservation, and recipe quantities.
2. Weight and liquid units were converted exactly (`kg` to `g`, `L` to `ml`). Counted items remain whole pieces or sheets. Recipe and inventory screens use base units directly; operational conversion-rule code and the staff Conversion Rules screen/endpoints were removed. The `conversion_rules` table and its three existing rows remain intact.
3. Stored material and batch costs use `DECIMAL(18,8)` and are stored per base unit. Staff sees costs per 100 g, per 100 ml, or per piece/sheet/cup/bottle.
4. Avocado is weight-only. The editable estimate is `INVENTORY_STANDARDS.estimatedAvocadoUsableGramsPerFruit = 150`; reorder level is 1,500 g, recipe quantity is 20 g, and stored cost is 0.36666667 per g. Its source basis remains recorded as 55 per 150 g. This is an estimate, not kitchen-confirmed.
5. Every recipe is marked `recipe not confirmed`. The baked-sushi estimates differ as approved: Small is Crabstick 2 pieces, Ebiko 20 g, Nori 1 sheet, Rice 200 g; Medium is Crabstick 3 pieces, Ebiko 30 g, Nori 2 sheets, Rice 300 g.
6. Crabstick stays in pieces. The Large and Medium Classic Platter Crabstick values of 31 and 25 were literal hard-coded guesses in both seed paths, not values calculated from selected Hoso/Futo products or a saved composition. Cleanup set both quantities to `0` without deleting either line, marked both recipes `superseded by composition`, and set both products unavailable until Phase 0C. The pre-migration values were `0.020 kg` each and remain recorded in the review sheet. All other flat platter lines remain unchanged and are superseded; Phase 0C still requires separate approval and the owner's Hoso/Futo choices.
7. The shared code constants are in `backend/src/config/inventoryStandards.ts`: owner-confirmed Spicy mayo 10 ml; estimated Teriyaki sauce 10 ml, Aonori 1 g, Tempura flakes 20 g, Sriracha 5 ml; and Avocado 150 g/fruit. Sriracha remains a default only and has no added recipe lines. These standards are not staff-editable yet; persisted settings, a staff API, and a UI are deferred to a future phase. A guarded follow-up migration corrected all six Spicy mayo recipe lines to 10 ml after verification found four lines at 20 ml.
8. The owner approved merging the Softdrinks material records. Keeper `cmv3t32dl00061da4l74v2ku0` is to be named exactly `Softdrinks`; duplicate `cmv6blwod028vn68q5g33s23u` (`Softdrinks ` with trailing space) remains archived (`is_deleted = true`). The existing repair migrations preserve both rows and the duplicate zero snapshot `cmv96a4tc00xymbt8tf5o4626` (2026-10-14) in `inventory_snapshot_archives`; the keeper snapshot `cmv96a4t600xsmbt88ki6vgne` remains live. The current dev database still has the keeper under `Softdrinks (Coke/Sprite/Royal)`; the separately approved corrective rename migration is pending and has not been deployed. The app's beverage stock material lookup and fresh seed paths must use `Softdrinks` without reactivating the archived alias.
9. Seed and demo-seed paths use base units, integer recipe amounts, shared standards above, and recipe flags. The two Classic Platters seed with zero Crabstick, `superseded by composition`, and unavailable. Both the CLI seed and demo seed fail closed unless `DATABASE_URL` is the local `katana_sushi_dev` database and the connected database name matches. The beverage lookup maps the old Softdrinks product display name to the canonical stock material rather than recreating a duplicate.
10. The Phase 0C platter Includes editor and mappings remain out of scope and were not built.

## Verified development state after migration

| Check | Result |
|---|---:|
| Database/schema | `katana_sushi_dev.public` |
| Material records | 42 total; 41 active and one archived duplicate |
| Recipes / recipe lines | 57 / 161 |
| Live snapshots / archived snapshots | 41 / 1 |
| Sales / batches / inventory transactions / movements | 0 / 0 / 0 / 0 |
| Active catering, reservation, takeout, and dine-in holds | 0 |
| Active recipe/material unit mismatches | 0 |
| Recipes not flagged `recipe not confirmed` | 0 |
| Classic Platter recipe flags / sale availability | 2 superseded by composition / 2 unavailable |
| Classic Platter Crabstick lines | 2 lines retained at 0 pieces |
| Existing conversion-rule rows retained | 3 |
| Prisma migrations | 18 migrations applied, including the Spicy mayo correction, Softdrinks repairs, and platter cleanup |

All reported material on-hand quantities remained zero. The material-level pre-/post-migration values and Softdrinks archive actions are in [phase0a-dry-run-materials.csv](./phase0a-dry-run-materials.csv); recipe-line details remain in [phase0-recipe-review.csv](./phase0-recipe-review.csv) and standard totals in [phase0-standard-portions.csv](./phase0-standard-portions.csv).

The older Supabase database contains real data on an older schema. It needs its own separately backed-up, schema-specific migration before any live release; Phase 0A did not connect to or modify it.

## Rollback

The pre-migration dump is the rollback source; do not try to reverse estimated or converted values by arithmetic. Migrations `20261017010000_phase0a_base_units`, `20261017020000_phase0a_spicy_mayo_standard`, `20261017030000_phase0a_softdrinks_archive_repair`, `20261017040000_phase0a_softdrinks_alias_rearchive`, and `20261017100000_phase0a_platter_cleanup` are forward-only guarded changes. The second migration corrects all six Spicy mayo lines to 10 ml after four lines were found at 20 ml. The Softdrinks repairs restore the descriptive keeper name and keep the duplicate material archived despite its legacy selling-product alias; no material or snapshot row is deleted. The platter cleanup retains both Crabstick lines at zero and the other legacy flat lines, while marking platter products unavailable. No sales, inventory transactions, movements, batches, or active holds exist. If rollback is authorized now:

1. Stop the backend with Ctrl+C in its existing terminal and verify port 5001 is clear with `netstat -ano | findstr :5001`.
2. Restore the pre-migration dump into a separate empty database and verify its original counts first.
3. Take and verify a post-migration dump of `katana_sushi_dev`.
4. Only after explicit authorization, restore the verified pre-migration dump to `katana_sushi_dev`; this replaces the current development database. Do not use `pg_restore --clean` against the target without that approval.
5. Recheck database identity, baseline counts, and migration history before reconnecting the application. A restore of the pre-migration dump rolls back all five Phase 0A migrations at once; do not edit applied migration SQL or reverse only one migration by arithmetic. If new operational writes occur, stop and reconcile them rather than restoring the old dump blindly.

## Deferred approvals

- Kitchen recipe confirmations and the planned post-week Stock Count/Movements review remain pending.
- Phase 0C platter composition is separate and requires its own approval.
- Do not proceed to the POS phase or use the system for real sales until real recipe confirmation is complete.
