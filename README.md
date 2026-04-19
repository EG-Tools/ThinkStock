# ThinkStock

ThinkStock now ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app target: https://eg-tools.github.io/ThinkStock/
- The mobile web app source lives in `docs/` on the default branch.
- GitHub Pages should be configured to use `GitHub Actions`, like ReStartHuman.

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
- `.github/workflows/deploy-pages.yml`: official GitHub Actions Pages workflow

## API Keys (Local Only)
- Never commit API keys to this repository.
- Store keys only on your local machine using one of these:
- `scripts/ecos_key.txt` (single line key)
- `scripts/.env.local` or `/.env.local` with `ECOS_API_KEY=...`
- The GitHub Actions workflow no longer injects `ECOS_API_KEY`.
