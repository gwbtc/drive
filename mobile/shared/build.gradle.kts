import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Everything shareable: the ship transport, the Drive chat client, the
// state store and the Compose UI. Android components (activity, sync
// service, notifications) live in androidMain and merge into
// :androidApp through this module's manifest.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    // kotlinx-datetime 0.7+ delegates Instant/Clock to kotlin.time, which
    // is still opt-in. Once here rather than at every call site.
    compilerOptions { optIn.add("kotlin.time.ExperimentalTime") }

    androidLibrary {
        namespace = "me.groundwire.drive"
        compileSdk = 36
        minSdk = 26
        // Off by default under this plugin; without it no R class is
        // generated and the launcher icon and theme stop resolving.
        androidResources { enable = true }
    }

    // JVM target: runs the unit tests and the opt-in live-ship test. No
    // desktop app is built from it.
    jvm("desktop") {
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
    }

    // iOS: the framework an Xcode project links. Declared now so the iOS
    // port is "add an Xcode shell", not "port the app". Only compiles on
    // a Mac with Xcode; see docs/ios.md.
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "Shared"
            isStatic = true
            binaryOption("bundleId", "me.groundwire.drive.Shared")
        }
    }

    applyDefaultHierarchyTemplate()

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            // The core icon set (Send, ArrowBack, Refresh). The extended
            // set is 18 MB of Kotlin and is not needed.
            implementation("org.jetbrains.compose.material:material-icons-core:1.7.3")
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            implementation(libs.ktor.client.core)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            implementation(libs.androidx.core.ktx)
            implementation(libs.androidx.activity.compose)
            implementation(libs.kotlinx.coroutines.android)
        }
        val desktopMain by getting
        desktopMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }
        val desktopTest by getting
        desktopTest.dependencies {
            implementation(kotlin("test"))
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
    }
}
