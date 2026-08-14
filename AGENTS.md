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

## Deployment
- `.github/workflows/deploy-pages.yml` is the only deployment workflow and is manual-only.
- `deploy_pages.bat` is the single local release entry point.
- The workflow must upload the prepared Pages artifact, not an alternate product surface.
- The local app version is authoritative. Increment it once when local feature work begins, then keep that same version while fixing any validation or deployment defects before redeploying.
