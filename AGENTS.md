# Repository Agent Guide

## Purpose
- ThinkStock has two user-facing surfaces:
  - `app.py` / `streamlit_app.py`: full Streamlit dashboard for local runs and Streamlit Community Cloud.
  - `docs/`: GitHub Pages mobile web app for iPhone Safari testing.

## Entry points
- Treat `streamlit_app.py` as the primary Streamlit source.
- Keep `app.py` identical to `streamlit_app.py` unless there is a deployment-specific reason not to.
- The public GitHub Pages URL is expected to be `https://eg-tools.github.io/ThinkStock/` after the Pages workflow finishes.

## Data flow
- Streamlit mode fetches live prices with `yfinance` at runtime.
- GitHub Pages mode uses prebuilt price data from `docs/data/prices.json`.
- `scripts/build_pages_data.py` generates that JSON during the Pages workflow.
- Macro data for both surfaces uses the same column convention: `date` plus one or more numeric series columns.

## Editing rules
- If you change labels, presets, or default tickers in Streamlit, mirror the change in the Pages app when relevant.
- Do not introduce secrets into the repo. Pages deployment must remain public-safe.
- Prefer mobile-first layout decisions because the repo is being tested from iPhone Safari.
- Preserve the current Korean UX copy unless there is a clear improvement.

## Deployment notes
- GitHub Pages is deployed by `.github/workflows/deploy-pages.yml`.
- The Pages workflow publishes the built `docs/` site to the `gh-pages` branch.
- Repository Pages settings should point to `gh-pages` with the `/` folder.
- Streamlit Community Cloud should use `app.py` or `streamlit_app.py` as the entrypoint.
- If the Pages app changes, make sure the workflow still uploads the `docs/` directory as the artifact.
