# Releasing

Modelled on how Talon ships (nisfeb/talon, RELEASE.md), minus the parts
we do not have yet.

## The rule: CI signs and publishes; nobody uploads an APK by hand

1. Bump `mobile.versionName` and `mobile.versionCode` in `mobile/gradle.properties`.
2. Commit, then tag and push the tag. The `mobile-` prefix is what keeps a
   desk or web tag from ever building an APK:
   ```sh
   git tag mobile-v0.1.1 && git push origin mobile-v0.1.1
   ```
3. `.github/workflows/mobile-release.yml` checks the tag against the version,
   builds the APK **signed with the release keystore** from repository
   secrets, and publishes a GitHub Release with `drive-mobile-0.1.1.apk` and
   its SHA-256.

A locally built APK is signed with your debug keystore. If one of those
is ever published next to a release-signed one, phones that installed it
can never upgrade to a real release without uninstalling ("App not
installed" with no explanation). Talon shipped three releases that way
before catching it. So: local `assembleRelease` is for checking the build
still works, never for shipping.

## One-time: the release keystore

Generate it once, keep it out of the repo, back it up somewhere durable
(losing it means every user must uninstall to upgrade):

```sh
keytool -genkeypair -v -keystore drive-mobile-release.keystore -alias drive-mobile \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then set four repository secrets (Settings → Secrets → Actions):

| secret | value |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | `base64 -i drive-mobile-release.keystore` |
| `RELEASE_STORE_PASSWORD` | the keystore password |
| `RELEASE_KEY_ALIAS` | `drive-mobile` |
| `RELEASE_KEY_PASSWORD` | the key password |

Until they exist the release job fails on purpose rather than publish a
debug-signed build.

## Installing a release on a phone

Sideload: open the `.apk` from the GitHub Release on the phone, allow
installs from the browser once. Updates install over the top as long as
the signing key is the same. There is no in-app updater yet; Talon has
one that reads a `latest.json` from its releases, and it is the obvious
next step once there is more than a handful of users.

## Google Play, F-Droid

Not now. Play would want a listing, a privacy policy URL, a closed test
track, and a declaration for the `specialUse` foreground service. F-Droid
wants a reproducible build. Both are documented in Talon's RELEASE.md if
the day comes.

## iOS

Separate track, Apple's tooling, see [../docs/mobile-ios.md](../docs/mobile-ios.md).
