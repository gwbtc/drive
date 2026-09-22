# iOS

The app is Kotlin Multiplatform with Compose Multiplatform, the same
arrangement Talon uses, so everything under `shared/` already targets
iOS: the transport, the Drive client, the store and the UI compile to a
static framework called `Shared`, and `MainViewController()` in
`shared/src/iosMain` hands Swift a view controller that hosts the whole
app. What is missing is the Xcode shell around it, and a Mac with Xcode
to build and sign it.

## What "port" means here

Not a rewrite. The work is:

1. An Xcode project with one SwiftUI app target that (a) runs
   `./gradlew :shared:embedAndSignAppleFrameworkForXcode` as a build
   phase and (b) shows `MainViewController()` in a `UIViewControllerRepresentable`.
   The two Swift files in `iosApp/` are that. Talon's `iosApp/` is the
   worked example, including the Gradle-heap workaround its run script
   needs.
2. Fix whatever does not compile in `iosMain` on first contact; there are
   three small files there and none has been built.
3. `usesCleartextTraffic` has an iOS equivalent: `NSAppTransportSecurity`
   with `NSAllowsArbitraryLoads` in Info.plist, since comets serve plain
   HTTP on an IP:port. Apple review frowns on it; TestFlight does not.
4. Notifications: none in the background without a relay server (see
   notifications.md). The first iOS build shows messages when opened.

## TestFlight, in one paragraph

TestFlight is Apple's beta channel: you upload a build to App Store
Connect, and up to 100 "internal" testers (people on your developer
team) or 10,000 "external" testers (anyone with a link, after a light
review) install it through the TestFlight app; builds expire after 90
days. It requires an Apple Developer Program membership ($99/year), an
app record in App Store Connect with a bundle id (`me.groundwire.drive`),
and a signed archive produced by Xcode on a Mac. Submitting to the App
Store proper is a separate, reviewed step with its own requirements
(privacy policy URL, screenshots, review notes); Talon has done
TestFlight for months and not the App Store.

## How Talon does it, and what to borrow

- Talon does not archive on a Mac of its own: it uses `nomac`, a hosted
  service that takes the working tree, runs xcodebuild, signs with the
  team's certificates and uploads to TestFlight. Its docs
  (`docs/app-store-release.md`) have the exact commands and the traps
  (`build --smoke` is the free unsigned check).
- Its CI runs an unsigned `xcodebuild archive` on a macOS runner on every
  push (`test.yml`, job `ios-compile`) so an iOS compile break is caught
  without spending a paid build. Worth copying the day `iosApp/` exists.
- If Jackson helps with his developer account, the app ships under his
  team's certificates and bundle-id prefix. Moving it to a Groundwire
  account later means a new bundle id or a transfer in App Store Connect,
  so decide whose account it is before the first upload.
