# ThinkStock

ThinkStock is one responsive web app with two access paths. Both run the same source from `docs/`.

## Use

- Local PC: run `run_local_pages.bat`, then use `http://127.0.0.1:8787/`.
- External PC or iPhone: open https://eg-tools.github.io/ThinkStock/.
- iPhone Home Screen: open the Pages link, use Share, then Add to Home Screen.

The local server keeps API keys in `.env.local`, mirrors the latest deployed data, and provides local fallbacks. The public app uses the private Cloudflare Worker for protected API calls. Secrets must never be committed.

## Local Workflow

- `run_local_pages.bat`: build and open the current local source.
- `test_local.bat`: validate the app, then open it only when checks pass.
- `update_from_github.bat`: fast-forward a clean local checkout to `origin/main`.
- `deploy_pages.bat "commit message"`: run release checks, bump the app version, commit, push, and start the manual GitHub Pages workflow.

Local edits are never published automatically. GitHub Pages is deployed only by `.github/workflows/deploy-pages.yml` after an explicit release.

## Architecture

- `docs/`: the only user-facing product, shared by local PC and GitHub Pages.
- `scripts/local_pages_server.mjs`: local runtime server and API fallback.
- `scripts/build_pages_data.py`: deployment data refresh.
- `worker/`: private Cloudflare gateway for DART and protected runtime data.
- `tests/`: unit and Safari/iPhone WebKit coverage.

## API Keys

Store local keys only in `.env.local`:

- `DART_API_KEY`
- `KOFIA_API_KEY`
- `KOSIS_API_KEY`
- `KRX_API_KEY`
- `ECOS_API_KEY`

GitHub Pages data builds use matching GitHub Secrets. The DART key remains only in the Cloudflare Worker.
