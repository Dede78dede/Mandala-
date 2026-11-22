-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Preserve Kotlinx Serialization descriptors
-keepclassmembers class com.mandala.studio.domain.** {
    *;
}
-keep,includedescriptorclasses class com.mandala.studio.domain.**$$serializer { *; }
-keepclassmembers class com.mandala.studio.domain.**$Companion {
    *** serializer();
}

# Preserve WebView JavaScript Bridge entrypoints
-keepclassmembers class com.mandala.studio.bridge.MandalaJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Rust JNI kernel native signatures
-keepclasseswithmembernames,includedescriptorclasses class com.mandala.studio.domain.NativeRustKernel {
    native <methods>;
}
