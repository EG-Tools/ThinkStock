# ThinkStock Mobile Testing

## Quick start
1. Run `run_streamlit_mobile.bat` on Windows.
2. Open `http://localhost:8501` on the PC.
3. If the iPhone is on the same Wi-Fi, open `http://PC-IP:8501` in Safari.
4. In Safari, choose `Share > Add to Home Screen` to get an app-like icon.

## GitHub + Streamlit Community Cloud
1. Push this repository to GitHub.
2. In Streamlit Community Cloud, create a new app from the repo.
3. Select `streamlit_app.py` as the entrypoint.
4. After deploy, open the app URL on iPhone Safari.

## What changed in the upgraded app
- Mobile-first hero and dashboard layout
- Macro series rendered as step lines instead of misleading linear interpolation
- Source status pills, latest-value cards, and failure diagnostics
- Remote CSV URL input for GitHub Raw or published CSV feeds
- Export button for the currently selected dataset

## Current data model
- Price data: Yahoo Finance
- Macro data: sample CSV, upload, paste, or remote CSV URL
- KOFIA live sync is not wired yet; remote CSV is the bridge for cloud testing until the API connector is added
