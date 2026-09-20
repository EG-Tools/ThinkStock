# v3.53 A/B/C Optimization Closeout

## Scope And Owners

The approved A/B/C groups are implemented through existing owners, not parallel rendering or scheduling systems.

| Group | Owner / extension | Change |
| --- | --- | --- |
| A1 | `scripts/verify_runtime_parity.mjs` | Compare recent seed values, ticker prices/volumes, and both report sources in addition to company financials. |
| A2, A3 | `broker-research-cache.mjs` | Publish available references per source; fetch Naver's 180-day source page once; do not repeat permanent failures during window expansion. |
| A4, B6 | `chart-marker-runtime.mjs`, `ticker-price-runtime.mjs`, research worker | Preserve unchanged volume maps; reuse sorted inputs and component fingerprints; prepare ticker rows and benchmark maps once. |
| A5 | `market-timing-service.mjs` | One worker failure/timeout releases every pending request and detaches the failed worker. |
| A6 | WebKit runner, timing reporter, E2E fixture | Record per-test duration, retry count and boot wait; attach live startup diagnostics on readiness failures. No regression cases are removed. |
| A7 | `app-bootstrap-orchestrator.mjs` | Move restored-feature scheduling policy out of `app.js`; keep the application as a wiring layer. No unrelated file-wide extraction. |
| B1 | research navigation + timing service | Include VIX/VKOSPI, raw market benchmarks and historical corrections in input fingerprints. Bump timing cache contract to v16. |
| B2 | research controller | Stop analysis if required shared history preparation fails; retain the previous result instead of publishing success. |
| B3, C1 | shared request registry, background scheduler, research worker client | Abort obsolete consumers, free canceled slots, prevent OFF/ON from reusing canceled work, guard completion by activation ownership, add worker timeouts. |
| B4 | research controller | Free lanes pull the next ticker from a market-balanced queue; batch cache writes do not block each completed ticker. |
| B5 | research controller | Show calculated candidates first; enrich categories later without overwriting newer navigation/search results. |
| B7 | research navigation, summary contract, existing failure popover | Preserve failure category/reason locally and in server summaries; clear them after recovery. |
| C2 | background task scheduler | Keep one serial lane for state/UI work and up to three network lanes within the existing scheduler. |
| C3 | bootstrap orchestrator + startup task runtime | Release required work when critical data settles, not when the title animation ends; remove restored-feature artificial delays. |
| C4, C5 | application control config + auxiliary contract | Share ADR/technical colors; derive credit-offset help from the current setting. |

## Preserved Contracts

- The production signal formula, thresholds and AI model remain unchanged.
- Cached results with incomplete input fingerprints are recomputed rather than treated as current.
- The price store is the sole writer of volume maps. A value change replaces the per-ticker map; unchanged merges retain its identity.
- Canceling one shared request subscriber does not cancel other subscribers.
- A canceled activation cannot complete or clear the progress indicator of a newer activation.
- Chart 1 still owns viewport transitions; charts 2/3 still use their existing shared render/sync contracts.
- Local and deployed clients use the same source and generated bundles. Runtime parity checks compare data values, not just app version strings.

## Verification Evidence

- Final JavaScript unit suite: 1,730 passed. Bundled/mirror data and application validation passed at v3.53.
- AI release gate: approved `path-v20` runtime unchanged.
- Live parity: RFHIC and Samsung company financials, 60 recent price/volume rows per ticker, four recent datasets, Naver and Hankyung report lists matched.
- Full WebKit run: 76 passed, 15 platform-specific skips, two outdated or racing assertions. The obsolete fixed-offset help assertion was updated; the insider-hover test now waits for supplemental startup data before sampling marker input, because a data redraw intentionally clears hover. The two corrected cases and the setting-change case passed on the final build (3/3, no retries). Combined coverage: 78 passed and 15 intended skips; no cases were removed.
- The full browser run took 13.6 minutes. Its longest AI interaction test took 133.3 seconds, but that test's app-ready wait was 3.4 seconds. These are different measurements, not evidence of a 133-second app boot. Individual test timings and readiness diagnostics are recorded under `.thinkstock-cache/validation/` for future comparisons.
- Final diff review includes shared request generation ownership, cancellation cleanup, progressive result publication, and input revision invalidation. Generated bundles were rebuilt after the last runtime change.
- Real iPhone hardware performance is not established by WebKit emulation. No claim of a measured device-level speedup is made.
- Deployment is separate from this local optimization task; the new release must be verified after publication as usual.

## News Sentiment Refresh Follow-Up

- Reproduced the user's existing-cache state: local and deployed pages displayed 2026-09-06 while the persisted macro provider receipt claimed 2026-09-13. No macro request was made during that boot. A clean-browser check alone did not reproduce this failure.
- An inactive index with an older trailing date caused the complete runtime snapshot to be rejected. Price snapshot validation now checks missing sessions inside each index's own historical coverage; differing trailing dates require freshness checks, not rejection of unrelated cached components.
- When startup falls back to bundled seed data, `runtime-data-app` invalidates the old confirmation receipts through `runtime-source-health`. It preserves user data, diagnostic history and failure backoff. A valid snapshot retains its confirmation receipts.
- `runtime-refresh-orchestrator` checks stale component observations as well as the provider receipt. `runtime-source-contract` maps each component to its actual refresh provider, including spreads and volatility served by the crisis feed.
- The auxiliary revision group now includes macro data, which owns news sentiment. The existing companion render queue can publish committed auxiliary data before signal preparation completes; no second renderer or scheduler was introduced.
- Focused unit validation: 82 passed. A WebKit/iPhone regression verifies stale-seed boot recovery to 2026-09-13 and a subsequent forced refresh appending a synthetic 2026-09-14 observation. One preceding WebKit run stalled during bundle loading; the final run passed without retry.
- Isolated Chrome verification with real data: news sentiment reached 2026-09-13 (99.59), then survived a warm restart with no redundant macro request. Existing user tabs were inspected read-only, not reloaded or navigated.
- Release preflight after the follow-up: all 1,736 JavaScript unit tests passed; bundled and local mirror data validation and application validation passed. The completed full WebKit coverage and the focused news regression are reused rather than repeating the same full browser run.
- This follow-up is included in the prepared v3.53 release. Publication and public-site verification are handled by the normal deployment workflow.
