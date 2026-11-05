// Regression helper: move only the supplied SoundSpectra child behind its
// wallpaper sibling. Never change wallpaper, Explorer, geometry or input styles.
use std::ffi::c_void;
type Hwnd = *mut c_void;
#[link(name = "user32")]
extern "system" {
    fn GetWindowThreadProcessId(window: Hwnd, pid: *mut u32) -> u32;
    fn GetParent(window: Hwnd) -> Hwnd;
    fn GetClassNameW(window: Hwnd, buffer: *mut u16, length: i32) -> i32;
    fn SetWindowPos(window: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn IsWindowVisible(window: Hwnd) -> i32;
}
unsafe fn class(window: Hwnd) -> String {
    let mut buffer = [0u16; 256];
    let length = GetClassNameW(window, buffer.as_mut_ptr(), 256);
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}
fn main() {
    let values: Vec<usize> = std::env::args().skip(1).map(|v| v.parse().unwrap()).collect();
    assert_eq!(values.len(), 3, "overlay HWND, wallpaper HWND, app PID required");
    let (window, wallpaper, expected_pid) = (values[0] as Hwnd, values[1] as Hwnd, values[2] as u32);
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        assert_eq!(pid, expected_pid, "overlay ownership changed");
        assert_ne!(pid, 0);
        let parent = GetParent(window);
        assert_eq!(class(parent), "Progman");
        assert_eq!(GetParent(wallpaper), parent);
        assert_eq!(class(wallpaper), "WorkerW");
        assert_ne!(IsWindowVisible(window), 0);
        assert_ne!(IsWindowVisible(wallpaper), 0);
        assert_ne!(SetWindowPos(window, wallpaper, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010), 0);
    }
}
