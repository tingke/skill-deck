#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("hook") => skill_deck_lib::run_hook_cli(),
        _ => skill_deck_lib::run(),
    }
}
