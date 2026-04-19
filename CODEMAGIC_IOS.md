# Codemagic iOS/TestFlight Setup (No Mac)

This repository includes `codemagic.yaml`, so you can build and upload iOS builds to TestFlight from Windows.

## 1) Connect repository in Codemagic

1. Add `EG-Tools/ThinkStock` in Codemagic.
2. Scan branch and detect `codemagic.yaml` in repo root.
3. Select workflow `thinkstock-ios-testflight`.

## 2) Create required environment variable group

In Codemagic app settings > Environment variables, create group `appstore_credentials` and add:

- `APP_STORE_CONNECT_PRIVATE_KEY` (Secret)
  - Full text content of your `.p8` key file
- `APP_STORE_CONNECT_KEY_IDENTIFIER` (Secret)
  - App Store Connect API Key ID
- `APP_STORE_CONNECT_ISSUER_ID` (Secret)
  - App Store Connect API Issuer ID

Optional variable:
- `APP_STORE_APPLE_ID`
  - Numeric Apple ID of your app in App Store Connect
  - If set, build number auto-increments from latest App Store build.

## 3) Verify group is attached to workflow

In `codemagic.yaml`, this workflow imports:

```yaml
environment:
  groups:
    - appstore_credentials
```

If the group name is different in UI, either rename the group in UI or change the workflow to match exactly.

## 4) Apple account requirements

- Apple Developer Program membership is required.
- API key should have `App Manager` permission.
- Bundle id is currently `com.egtools.thinkstock`.

## 5) Run build

1. Click `Start new build` in Codemagic.
2. Choose workflow `thinkstock-ios-testflight`.
3. On success, Codemagic produces IPA and uploads to App Store Connect/TestFlight.

## 6) Install on iPhone

1. Install `TestFlight` from App Store.
2. Add your Apple ID as internal tester in App Store Connect.
3. Install ThinkStock from TestFlight.

## Quick troubleshooting

- `Missing value ISSUER_ID` in `Fetch signing files`
  - `APP_STORE_CONNECT_ISSUER_ID` is missing in build environment.
  - Add it to group `appstore_credentials` and ensure the workflow imports that group.
- `API key invalid`
  - Re-check key id, issuer id, and full `.p8` content.
- `Signing` failed
  - Verify Apple account permissions and bundle id match.
- `No app record`
  - Create the app record in App Store Connect first.
