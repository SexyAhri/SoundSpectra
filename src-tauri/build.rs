fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Native dependencies export symbols even from our executable. No consumer
        // links to it, so omit the unused .lib/.exp sidecars and their linker chatter.
        // This preserves the PE exports and all actual linker warnings.
        println!("cargo:rustc-link-arg=/NOIMPLIB");
        println!("cargo:rustc-link-arg=/NOEXP");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        use std::{path::PathBuf, process::Command};
        println!("cargo:rerun-if-changed=macos/AudioHelper.swift");
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let triple = if arch == "aarch64" {
            "arm64-apple-macos13.0"
        } else {
            "x86_64-apple-macos13.0"
        };
        let output =
            PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("soundspectra-macos-helper");
        let status = Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-target",
                triple,
                "-framework",
                "AppKit",
                "-framework",
                "ScreenCaptureKit",
                "-framework",
                "CoreMedia",
                "-framework",
                "AVFoundation",
                "macos/AudioHelper.swift",
                "-o",
            ])
            .arg(&output)
            .status()
            .expect("Xcode command-line tools are required");
        assert!(status.success(), "macOS native helper compilation failed");
        println!(
            "cargo:rustc-env=SOUNDSPECTRA_MACOS_HELPER={}",
            output.display()
        );
    }
    tauri_build::build()
}
