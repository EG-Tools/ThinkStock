# ThinkStock

ThinkStock ships in two modes from the same repository.

## 1. Public iPhone Safari link
- GitHub Pages app target: https://eg-tools.github.io/ThinkStock/
- Mobile web app source: `docs/`
- GitHub Pages should be configured to use `GitHub Actions`.

## 2. DART disclosures
- The Pages build keeps the last deployed disclosure snapshot as an offline fallback.
- Adding a stock checks only that stock once through the private Cloudflare Worker.
- Manual refresh checks only Korean stocks whose chart toggles are currently on.
- App startup and scheduled Pages builds do not request market-wide DART disclosures.
- The DART key is stored as the Worker's `DART_API_KEY` secret and is never sent to the browser.
- Store the same `THINKSTOCK_ACCESS_TOKEN` in the Worker and once in each device's API settings.
- Per-ticker results are shared through Cloudflare KV and retained in each browser's IndexedDB cache.
- Worker source and deployment configuration live in `worker/`; deploy with `npm run worker:deploy`.

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
- GitHub Pages builds use GitHub Secrets for market and macro data. DART refreshes run only through the private Worker.
