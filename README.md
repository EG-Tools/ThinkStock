# ThinkStock

ThinkStock ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app target: https://eg-tools.github.io/ThinkStock/
- Mobile web app source: `docs/`
- GitHub Pages should be configured to use `GitHub Actions`.

## 2. Local web app with DART disclosures
- Put `DART_API_KEY=...` in `/.env.local`.
- Double-click `run_local_pages.bat` to open `http://127.0.0.1:8787`.
- A phone on the same Wi-Fi can open the private-network address printed in the server window.
- In the installed iOS app, save that address under API settings as the iPhone PC address.
- DART keys stay on the PC. Per-ticker disclosures are cached on both the PC and browser.

## 3. Full Streamlit app
- Entrypoint: `app.py` or `streamlit_app.py`
- Local run: `run_app.bat`
- Streamlit Community Cloud entrypoint: `app.py` or `streamlit_app.py`

## 4. Native iOS app packaging (Capacitor)
- Web source for iOS app shell: `docs/`
- Setup guide: `IOS_APP_TESTFLIGHT.md`
- First-time commands:
  - `npm install`
  - `npm run cap:add:ios`
  - `npm run cap:sync:ios`
  - `npm run cap:open:ios` (macOS)

## 5. iOS build without Mac (Codemagic)
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
- Store local keys in `/.env.local` only:
  - `DART_API_KEY=...`
  - `KOFIA_API_KEY=...`
  - `KOSIS_API_KEY=...`
  - `KRX_API_KEY=...`
  - `ECOS_API_KEY=...`
- GitHub Pages builds use GitHub Secrets for public market and macro data. DART disclosures are fetched only by the local PC server.
