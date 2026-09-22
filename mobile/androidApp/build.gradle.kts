import java.io.FileInputStream
import java.util.Properties

// The Android application shell. No source of its own: the activity,
// the sync service and the receivers live in :shared's androidMain and
// their manifest merges into this one. What lives here is what only an
// application can declare: the id, the version, signing.
plugins {
    alias(libs.plugins.android.application)
}

val versionCodeProp = (property("mobile.versionCode") as String).trim().toInt()
val versionNameProp = (property("mobile.versionName") as String).trim()

android {
    // Namespaces this module's own R/BuildConfig; must differ from
    // :shared's. The applicationId below is what installs upgrade under.
    namespace = "me.groundwire.drive.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "me.groundwire.drive"
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeProp
        versionName = versionNameProp
    }

    signingConfigs {
        create("release") {
            // The keystore lives outside the repo; RELEASE_KEYSTORE_PROPS
            // names a properties file with storeFile/storePassword/
            // keyAlias/keyPassword. Unset (every dev box) falls back to
            // debug signing, and such a build must never be published:
            // see RELEASE.md.
            val propsPath = System.getenv("RELEASE_KEYSTORE_PROPS")
            if (propsPath != null) {
                val props = Properties().apply { FileInputStream(propsPath).use { load(it) } }
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            val hasReleaseKeys = System.getenv("RELEASE_KEYSTORE_PROPS") != null
            signingConfig = signingConfigs.getByName(if (hasReleaseKeys) "release" else "debug")
            // No shrinking yet: a dev-team sideload does not need the
            // last 5 MB, and R8 rules for Ktor + serialization are a
            // separate job.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation(project(":shared"))
}
