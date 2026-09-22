# Drive mobile

The phone client for the chat half of Drive: your spaces' rooms and your
direct messages, with notifications. You give it your ship's address and
its `+code`; it talks to your own ship and nothing else. It depends on
the JSON the agent in `../desk` serves, so a change to an encoder or an
action tag there is a change here too, in the same PR.

Android today. The code is Kotlin Multiplatform with a Compose UI so an
iOS build is an Xcode shell away, not a rewrite: see [../docs/mobile-ios.md](../docs/mobile-ios.md).

## How it talks to the ship

Everything goes over eyre's HTTP surface on your ship, the same one the
Drive web client uses:

| what | how |
|---|---|
| log in | `POST /~/login` with the `+code`; the `urbauth-~ship` cookie is kept |
| who am I | `GET /~/host` |
| spaces, invites, nicknames | `GET /~/scry/drive/listing.json` |
| a space's chat | `GET /~/scry/drive/chat/<space-id>.json` |
| DM inbox, a thread | `GET /~/scry/drive/dms.json`, `GET /~/scry/drive/dm/<ship>.json` |
| post, send, mark read, accept invite | `POST /drive/action` with `{"post-message": …}` etc. |
| live updates | `GET /drive/sse?feed=listing`, which says *which room changed*; the app re-fetches it |

No message text is stored on the phone beyond what is on screen; the
ship is the source of truth and every open re-fetches.

## Notifications

The main point of the app, and the part with a real trade-off. Today the
app runs a small foreground service that holds the ship's event stream
open in the background and posts a conversation-style notification per
room when someone else writes. It costs one silent "Connected" entry in
the notification shade and works with no server anywhere.

What it cannot do is survive Android deciding to kill the app: some
phones do that within the hour unless the app is excluded from battery
optimisation (the app asks once), and nothing client-side survives a
force-stop. Reliable push on iOS, and bullet-proof push on Android, needs
a relay server. [../docs/mobile-notifications.md](../docs/mobile-notifications.md) lays out
the tiers and what each costs.

## Build

Prerequisites: JDK 17+, the Android SDK with platform 36 (`ANDROID_HOME`
set or `local.properties` with `sdk.dir=`).

```sh
./gradlew :shared:desktopTest          # unit tests
./gradlew :androidApp:assembleDebug    # androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
```

Against a real ship, the end-to-end test logs in, reads everything, opens
the feed, and with a space id also posts a message and waits for the
ship to announce it:

```sh
DRIVE_SHIP_URL=1.2.3.4:8080 DRIVE_CODE=lidlut-tabwed-pillex-ridrup \
DRIVE_SPACE=0v3gr.mqs9e… ./gradlew :shared:desktopTest --tests '*LiveShipTest*' -i
```

## Layout

```
shared/    Kotlin Multiplatform library: everything
  commonMain/urbit   ShipClient (login, scry, action POST, SSE), SseParser, ShipUrl
  commonMain/drive   the Drive JSON models, DriveApi, FeedEvent
  commonMain/store   ChatStore (all state + the feed loop), Session, NewMessages
  commonMain/ui      Compose screens: Login, Home, Room
  androidMain        MainActivity, ChatSyncService (foreground), Notifier, BootReceiver
  desktopMain        JVM bits for the tests
  iosMain            NSUserDefaults store + MainViewController for an Xcode shell
androidApp/  the Android application: id, version, signing; no code
../docs/     mobile-notifications.md, mobile-ios.md (in the repo docs dir)
iosApp/      the two Swift files an Xcode project needs, and how to make one
```

## Releasing

Tag-driven, CI-signed, GitHub Releases: see [RELEASE.md](RELEASE.md).

## Known limits

- The eyre cookie sits in private app storage unencrypted. Anyone with
  root on the phone can read it; that is the same trust as the browser.
- Text only. Drive's chat is text only today.
- Comets are shown by nickname when a space knows one, else the first two
  syllables of the @p; the full name is in the room header.
- iOS: compiles in principle, untested until someone with Xcode builds it.
