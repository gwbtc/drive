# Notifications: what works without a server, and what does not

The question behind this app is "do we need a notification server?".
The answer is: not for a first Android build, yes for iOS, and yes for
Android too if "reliable on every phone" is the bar. Here is why, tier
by tier.

## The constraint

A ship cannot push to a phone. It speaks HTTP to whoever connects to it,
and a phone in someone's pocket is not connected: Android freezes
background apps and their sockets within minutes, iOS within seconds.
The only things allowed to wake a phone are the platform push services,
Google's FCM and Apple's APNs (plus, on Android, a UnifiedPush
distributor app the user installs, which holds one connection for all
apps). All three have to be *sent to* by a server over HTTPS with
credentials a ship cannot produce: FCM wants a Google service-account
token (RS256 signing; Hoon has no RSA), APNs wants an ES256 token (P-256;
Hoon has no P-256). A ship can POST to a UnifiedPush endpoint, which is a
plain HTTP call, and that is the one door open to it.

## Tier 0, what this app does today: a foreground service

`ChatSyncService` keeps Drive's event stream open in the background and
posts a notification per room when someone else writes. Android permits
this only for a *foreground service* with a permanent, silent
notification in the shade ("Connected to ~ship"). The service reconnects
with backoff, re-fetches everything on every reconnect (so time spent
disconnected is caught up), and restarts after a reboot.

- Server: none. Ship only.
- Works on: a Pixel, or any phone once the app is excluded from battery
  optimisation (the app asks once). Signal without Play Services and
  Conversations (XMPP) run this way.
- Fails on: phones whose vendor kills background services anyway (some
  Xiaomi, Huawei, OnePlus, Samsung settings); a force-stop; the OS
  reclaiming memory. When it fails, nothing arrives until the app is
  opened.
- iOS: not possible. iOS has no foreground service. An iOS build of this
  app shows messages when opened and never otherwise.

## Tier 1, no central server, Android only: the ship pushes to ntfy

The ship itself can be the push sender. A small Gall agent on the comet
subscribes to Drive's facts and, for each new message not by us, sends
one iris `POST` to the phone's UnifiedPush endpoint (an HTTPS URL the
[ntfy](https://ntfy.sh) app hands out). The app registers with ntfy via
the UnifiedPush library, pokes the endpoint URL to the agent, and gets
woken with a "room X changed" hint; it then fetches the room from the
ship as usual. Message text never leaves the ship.

- Server: none of ours. ntfy.sh is public; anyone can self-host ntfy in
  ten minutes; the user could also run their own on the same droplet.
- Cost: one Hoon agent (roughly 150 lines), UnifiedPush in the app, an
  ntfy app on the phone.
- Caveat: the iris client has a bug with relative redirects (found while
  testing the DNS thread); ntfy answers 200 with no redirect, so it is
  not hit, but worth knowing.
- iOS: still nothing. Apple allows no UnifiedPush.

## Tier 2, a relay server: the only way to iOS

A small always-on server holds an SSE connection to each registered
user's ship, and on each event sends a push through APNs (iOS), FCM or
UnifiedPush (Android). Talon's `relay/` is exactly this, is open source
(PolyForm Noncommercial, so we would write our own or ask), and is about
eleven Kotlin files: register a device, keep credentials encrypted,
reconnect with backoff, dispatch. It needs an Apple Developer account for
the APNs key and somewhere to run (a $6 droplet).

- Trust: the relay holds each user's eyre cookie, so it can read their
  ship as them. Talon sends hint-only payloads for that reason and so
  should we; message text still never transits the relay.
- Survives everything client-side cannot: force-stop, OEM killing, OOM,
  reboot with no boot receiver.

## Recommendation

Ship Tier 0 now, since it is built and needs nothing. Add Tier 1 next if
Android reliability complaints appear; it keeps the "your ship, nothing
else" property. Build Tier 2 when iOS is real, because there is no other
way, and at that point it can serve Android too.
