// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Import the run function from the library crate
use rss_reader_lib::run;

fn main() {
    run()
}
