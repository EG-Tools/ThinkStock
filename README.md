# ThinkStock

ThinkStock is a mobile-friendly Streamlit dashboard for comparing Korean market prices with macro overlays such as leading indicators and credit balances.

## Main entrypoint
- `streamlit_app.py`

## Local run
- Double-click `run_streamlit_mobile.bat`
- Or run `streamlit run streamlit_app.py --server.address 0.0.0.0 --server.port 8501`

## iPhone test
1. Open the deployed or local URL in Safari.
2. Use `Share > Add to Home Screen`.
3. For Streamlit Community Cloud, choose `streamlit_app.py` as the entrypoint.

## Data sources
- Price: Yahoo Finance
- Macro: sample CSV, uploaded CSV, pasted CSV, or remote CSV URL

## Docs
- `IPHONE_TESTING.md`: mobile testing and deployment flow
- `.streamlit/config.toml`: theme and toolbar settings
