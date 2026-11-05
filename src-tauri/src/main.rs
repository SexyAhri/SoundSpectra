// Installed preview builds are desktop apps too; never create a console window.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    soundspectra_lib::run()
}
