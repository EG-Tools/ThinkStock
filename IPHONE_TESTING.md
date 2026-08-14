# iPhone Testing

## Public Link
- Open https://eg-tools.github.io/ThinkStock/ in iPhone Chrome or Safari.
- The same `docs/` source is used on local PCs and GitHub Pages.

## Add to Home Screen
1. Open the public link in Safari.
2. Tap Share.
3. Tap Add to Home Screen.

## Release Check
- Run `test_local.bat` for fast local validation.
- A Pages release also runs the full Safari and iPhone WebKit suite before deployment.
- If an old version remains visible, close the installed web app and reload once so its service worker can activate the new asset version.
