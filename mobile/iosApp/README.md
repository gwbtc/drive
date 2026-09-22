# iosApp

There is no Xcode project here yet, only the two Swift files it needs.
To create it on a Mac with Xcode:

1. Xcode → File → New → Project → iOS App. Product name `Drive`,
   organisation identifier `me.groundwire`, interface SwiftUI, language
   Swift. Save it in this directory as `iosApp.xcodeproj`.
2. Delete the generated `DriveApp.swift` and `ContentView.swift`; add
   the two files here instead.
3. Target → Build Phases → add a Run Script phase *before* Compile
   Sources:
   ```sh
   cd "$SRCROOT/.."
   ./gradlew :shared:embedAndSignAppleFrameworkForXcode
   ```
4. Target → General → Frameworks: the phase above places
   `Shared.framework` under `shared/build/xcode-frameworks/`; add it, and
   add that path to Framework Search Paths.
5. Info.plist: `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` = YES
   (comets serve plain HTTP).
6. Build for a simulator; fix whatever `shared/src/iosMain` does not
   compile (it has never been built).

Talon's `iosApp/` is the reference for the pbxproj details, including
the Gradle-heap workaround in its run-script phase.
