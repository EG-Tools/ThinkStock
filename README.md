# ThinkStock

ThinkStock now ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app target: https://eg-tools.github.io/ThinkStock/
- The workflow publishes the static mobile site to the `gh-pages` branch.
- In GitHub `Settings > Pages`, set the source to `Deploy from a branch` and choose `gh-pages` / `/`.

## 2. Full Streamlit app
- Entrypoint: `app.py` or `streamlit_app.py`
- Local run: `run_app.bat`
- Streamlit Community Cloud entrypoint: `app.py` or `streamlit_app.py`

## Included repo surfaces
- `docs/`: GitHub Pages mobile app
- `app.py`: Streamlit app
- `streamlit_app.py`: same Streamlit app source for alternate entrypoint use
- `AGENTS.md`: repo instructions for coding agents

## Docs
- `IPHONE_TESTING.md`: iPhone testing notes
- `.github/workflows/deploy-pages.yml`: `gh-pages` publish workflow
