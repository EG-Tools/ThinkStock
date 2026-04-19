# iOS App (Capacitor) Build Guide

ThinkStock web app (`docs/`) can be wrapped as a native iOS app using Capacitor.

## 1. Install dependencies

```bash
npm install
```

## 2. Create iOS project (first time only)

```bash
npm run cap:add:ios
```

## 3. Sync latest web assets

```bash
npm run cap:sync:ios
```

## 4. Open Xcode project (macOS)

```bash
npm run cap:open:ios
```

## 5. Build and distribute

- In Xcode, set your Apple Team and Bundle Identifier.
- Use `Product > Archive`.
- Upload archive to App Store Connect.
- Distribute to TestFlight.

## Notes

- `docs/` is used as the iOS app web source.
- API keys remain local-only and should never be committed.
- To refresh app content after web changes, run `npm run cap:sync:ios` before archiving.