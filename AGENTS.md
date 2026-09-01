# Repository Agent Guide

## Product
- ThinkStock has one user-facing web app in `docs/`.
- Local PC access uses `run_local_pages.bat` and `scripts/local_pages_server.mjs`.
- External PC and iPhone access use `https://eg-tools.github.io/ThinkStock/`.
- Do not recreate separate Streamlit, native iOS, or alternate UI implementations.

## Data Flow
- Local mode prefers the validated mirror in `.thinkstock-cache/pages-data` and falls back to bundled `docs/data`.
- GitHub Pages uses the segmented datasets in `docs/data`.
- `scripts/build_pages_data.py` refreshes deployment data.
- Protected runtime calls go through `worker/`; secrets must never enter the public bundle.

## Editing Rules
- Preserve the Korean UX and mobile-first behavior unless there is a clear improvement.
- Keep local and deployed behavior identical by changing the shared `docs/` source only.
- Keep `main` as the only long-lived deployment branch.
- Run unit validation and Safari/iPhone WebKit coverage before release.
- Before implementing any behavior, identify existing contracts, reusable modules, and every related UI, data, input, cache, local/deployed, and desktop/mobile path that can share it. If the commonization boundary changes behavior or performance, stop and confirm that boundary with the user before editing.

## Chart And Interaction Invariants
- The main viewport is the authoritative owner of the visible time range. Linked auxiliary charts consume the same committed range and MUST NOT maintain an independent equivalent range.
- Apply a viewport action's X range, automatic Y fit, handles, overlays, dated markers, and linked-chart ranges through one coordinated update path.
- Dated overlays derive their position from the owning series and date. They MUST NOT persist or independently estimate coordinates already defined by that series.
- Pointer, wheel, pinch, resize, and drag input coalesce to the latest animation frame. Perform no more than one necessary reconciliation after the interaction settles.
- Desktop and touch adapters use the same viewport state transition whenever their semantics match.

## Deployment
- `.github/workflows/deploy-pages.yml` is the only deployment workflow and is manual-only.
- `deploy_pages.bat` is the single local release entry point.
- The workflow must upload the prepared Pages artifact, not an alternate product surface.
- The local app version is authoritative. Increment it once when local feature work begins, then keep that same version while fixing any validation or deployment defects before redeploying.
