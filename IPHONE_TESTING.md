# iPhone Testing

## Public Safari link
- GitHub Pages target: https://eg-tools.github.io/ThinkStock/
- The mobile app is served directly from `main/docs`.
- In GitHub `Settings > Pages`, set the source to `Deploy from a branch`, branch `main`, folder `/docs`.

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
- The Pages app reads `docs/data/prices.json` from the `docs/` folder on `main`.
- Macro data can still come from sample CSV, upload, paste, or remote CSV URL.
