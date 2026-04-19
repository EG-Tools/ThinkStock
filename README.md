# ThinkStock

ThinkStock ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app target: https://eg-tools.github.io/ThinkStock/
- Mobile web app source: `docs/`
- GitHub Pages should be configured to use `GitHub Actions`.

## 2. Full Streamlit app
- Entrypoint: `app.py` or `streamlit_app.py`
- Local run: `run_app.bat`
- Streamlit Community Cloud entrypoint: `app.py` or `streamlit_app.py`

## 3. Native iOS app packaging (Capacitor)
- Web source for iOS app shell: `docs/`
- Setup guide: `IOS_APP_TESTFLIGHT.md`
- First-time commands:
  - `npm install`
  - `npm run cap:add:ios`
  - `npm run cap:sync:ios`
  - `npm run cap:open:ios` (macOS)

## 4. iOS build without Mac (Codemagic)
- CI config: `codemagic.yaml`
- Setup guide: `CODEMAGIC_IOS.md`
- Workflow id: `thinkstock-ios-testflight`

## Included repo surfaces
- `docs/`: GitHub Pages mobile app
- `app.py`: Streamlit app
- `streamlit_app.py`: same Streamlit app source for alternate entrypoint use
- `AGENTS.md`: repo instructions for coding agents

## Docs
- `IPHONE_TESTING.md`: iPhone testing notes
- `IOS_APP_TESTFLIGHT.md`: Capacitor iOS/TestFlight build guide
- `CODEMAGIC_IOS.md`: Codemagic iOS/TestFlight build guide (no Mac)
- `.github/workflows/deploy-pages.yml`: GitHub Actions Pages workflow

## API Keys (Local Only)
- Never commit API keys to this repository.
- Store keys only on your local machine using one of these:
  - `scripts/ecos_key.txt` (single line key)
  - `scripts/.env.local` or `/.env.local` with `ECOS_API_KEY=...`
- GitHub Actions workflow no longer injects `ECOS_API_KEY`.
