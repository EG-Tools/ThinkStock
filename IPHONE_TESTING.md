# iPhone Testing

## Public Safari link
- GitHub Pages target: https://eg-tools.github.io/ThinkStock/
- The mobile app source is stored in `docs/` on `main`.
- In GitHub `Settings > Pages`, set the source to `GitHub Actions`.

## Add to Home Screen
1. Open the GitHub Pages link in Safari.
2. Tap `Share`.
3. Tap `Add to Home Screen`.

## Runtime modes
- GitHub Pages mobile app: quick public test link, mobile-first UI, repo-built price cache
- Streamlit app: full feature version for local use or Streamlit Community Cloud

## Streamlit fallback
- Run `run_app.bat` locally
- Or deploy `app.py` / `streamlit_app.py` to Streamlit Community Cloud

## Notes
- GitHub Actions refreshes `docs/data/prices.json` before deploying the Pages artifact.
- Macro data can still come from sample CSV, upload, paste, or remote CSV URL.
