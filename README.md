# ThinkStock

ThinkStock now ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app: https://eg-tools.github.io/ThinkStock/
- This mode is mobile-first and can be added to the iPhone home screen.
- It uses repo-built market cache data plus macro CSV input.

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
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment workflow
