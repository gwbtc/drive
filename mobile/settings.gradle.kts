pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

// Lets Gradle fetch a JDK it cannot find locally, so a dev box with only
// a newer or older JDK than the one the build wants still builds.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "drive-mobile"

// Everything that can be shared lives in :shared — the ship transport,
// the Drive chat client, the state store and the Compose UI — as a
// Kotlin Multiplatform library with Android, JVM (tests) and iOS targets.
include(":shared")
// The Android application shell: application id, signing, manifest merge.
// Kept separate because com.android.application cannot be applied next
// to the Kotlin Multiplatform plugin.
include(":androidApp")
