import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

@Suppress("UNCHECKED_CAST")
val versionContract: Map<String, Any> = JsonSlurper()
    .parse(rootProject.file("../version.json")) as Map<String, Any>

val contractVersionName: String =
    (findProperty("versionName") as? String)?.takeIf { it.isNotBlank() }
        ?: (versionContract["version"] as String)
val contractVersionCode: Int =
    (findProperty("versionCode") as? String)?.toIntOrNull()
        ?: (versionContract["versionCode"] as Number).toInt()
val contractPackageId: String = versionContract["androidPackageId"] as String
val contractMinSdk: Int = (versionContract["minSdk"] as Number).toInt()
val contractTargetSdk: Int = (versionContract["targetSdk"] as Number).toInt()
val contractCompileSdk: Int = (versionContract["compileSdk"] as Number).toInt()
val contractPagesUrl: String = (versionContract["githubPagesUrl"] as String).trimEnd('/')
val releaseManifestUrl: String = "$contractPagesUrl/releases/update-manifest.json"

android {
    namespace = "com.mandala.studio"
    compileSdk = contractCompileSdk

    defaultConfig {
        applicationId = contractPackageId
        minSdk = contractMinSdk
        targetSdk = contractTargetSdk
        versionCode = contractVersionCode
        versionName = contractVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "RELEASE_MANIFEST_URL", "\"$releaseManifestUrl\"")
        buildConfigField("String", "GITHUB_PAGES_URL", "\"$contractPagesUrl\"")
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("MANDALA_KEYSTORE_PATH")
                ?: (findProperty("mandala.keystore.path") as? String)
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("MANDALA_KEYSTORE_PASSWORD")
                    ?: (findProperty("mandala.keystore.password") as? String)
                keyAlias = System.getenv("MANDALA_KEY_ALIAS")
                    ?: (findProperty("mandala.key.alias") as? String)
                keyPassword = System.getenv("MANDALA_KEY_PASSWORD")
                    ?: (findProperty("mandala.key.password") as? String)
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile?.exists() == true) {
                signingConfig = releaseSigning
            }
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("sideload") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_FLAVOR", "\"sideload\"")
            buildConfigField("boolean", "SELF_UPDATE_ENABLED", "true")
        }
        create("playstore") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_FLAVOR", "\"playstore\"")
            buildConfigField("boolean", "SELF_UPDATE_ENABLED", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.input.motionprediction)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit.jupiter.api)
    testImplementation(libs.junit.jupiter.params)
    testRuntimeOnly(libs.junit.jupiter.engine)
}
