use crate::Result;
use serde_json::{json, Value};

#[cfg(windows)]
mod spooler {
    use super::*;
    use std::{ffi::c_void, io, ptr};
    type Handle = *mut c_void;
    #[repr(C)]
    struct PrinterInfo4 { name: *const u16, server: *const u16, attributes: u32 }
    #[repr(C)]
    struct Document { name: *const u16, output: *const u16, datatype: *const u16 }
    #[link(name = "winspool")]
    extern "system" {
        fn EnumPrintersW(flags: u32, name: *const u16, level: u32, data: *mut u8, size: u32, needed: *mut u32, returned: *mut u32) -> i32;
        fn OpenPrinterW(name: *const u16, handle: *mut Handle, defaults: *const c_void) -> i32;
        fn ClosePrinter(handle: Handle) -> i32;
        fn GetPrinterW(handle: Handle, level: u32, data: *mut u8, size: u32, needed: *mut u32) -> i32;
        fn StartDocPrinterW(handle: Handle, level: u32, doc: *const Document) -> u32;
        fn StartPagePrinter(handle: Handle) -> i32;
        fn WritePrinter(handle: Handle, data: *const u8, size: u32, written: *mut u32) -> i32;
        fn EndPagePrinter(handle: Handle) -> i32;
        fn EndDocPrinter(handle: Handle) -> i32;
        fn AbortPrinter(handle: Handle) -> i32;
    }
    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
    fn error() -> String { format!("Windows printer: {}", io::Error::last_os_error()) }
    unsafe fn string(mut ptr: *const u16) -> String {
        if ptr.is_null() { return String::new(); }
        let mut result = Vec::new();
        while *ptr != 0 { result.push(*ptr); ptr = ptr.add(1); }
        String::from_utf16_lossy(&result)
    }
    struct Printer(Handle);
    impl Drop for Printer { fn drop(&mut self) { unsafe { ClosePrinter(self.0); } } }
    fn open(name: &str) -> Result<Printer> {
        if name.is_empty() || name.contains('\0') { return Err("Select a Windows printer queue".into()); }
        let mut handle = ptr::null_mut();
        if unsafe { OpenPrinterW(wide(name).as_ptr(), &mut handle, ptr::null()) } == 0 { return Err(error()); }
        let printer = Printer(handle);
        let mut status: u32 = 0;
        let mut needed = 0;
        if unsafe { GetPrinterW(handle, 6, &mut status as *mut u32 as *mut u8, 4, &mut needed) } == 0 { return Err(error()); }
        // Queue status is advisory. Successful submission cannot prove paper was printed.
        if status & (0x1 | 0x2 | 0x8 | 0x10 | 0x40 | 0x80 | 0x800 | 0x1000 | 0x40000 | 0x100000 | 0x400000) != 0 {
            return Err(format!("Printer queue needs attention (status {status:#x}). Check paper, power and Windows printer settings."));
        }
        Ok(printer)
    }
    pub fn list() -> Result<Value> {
        let mut needed = 0;
        let mut count = 0;
        unsafe { EnumPrintersW(2 | 4, ptr::null(), 4, ptr::null_mut(), 0, &mut needed, &mut count); }
        if needed == 0 {
            let code = io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if code == 0 { Ok(json!([])) } else { Err(error()) };
        }
        // usize storage keeps the native pointer fields correctly aligned.
        let mut data = vec![0usize; (needed as usize + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>()];
        if unsafe { EnumPrintersW(2 | 4, ptr::null(), 4, data.as_mut_ptr() as *mut u8, needed, &mut needed, &mut count) } == 0 { return Err(error()); }
        let printers = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const PrinterInfo4, count as usize) };
        Ok(Value::Array(printers.iter().map(|p| {
            let name = unsafe { string(p.name) };
            json!({ "id": name, "name": name, "type": "windows", "address": "Windows printer queue" })
        }).collect()))
    }
    pub fn check(name: &str) -> Result<()> { open(name).map(|_| ()) }
    pub fn write(name: &str, bytes: &[u8]) -> Result<u32> {
        let printer = open(name)?;
        let title = wide("Sellix Receipt");
        let raw = wide("RAW");
        let document = Document { name: title.as_ptr(), output: ptr::null(), datatype: raw.as_ptr() };
        let job = unsafe { StartDocPrinterW(printer.0, 1, &document) };
        if job == 0 { return Err(error()); }
        let result = (|| {
            if unsafe { StartPagePrinter(printer.0) } == 0 { return Err(error()); }
            let mut written = 0;
            if unsafe { WritePrinter(printer.0, bytes.as_ptr(), bytes.len() as u32, &mut written) } == 0 || written as usize != bytes.len() {
                return Err("Windows could not accept the complete receipt. Check the queue before retrying.".into());
            }
            if unsafe { EndPagePrinter(printer.0) } == 0 { return Err(error()); }
            if unsafe { EndDocPrinter(printer.0) } == 0 { return Err(error()); }
            Ok(job)
        })();
        if result.is_err() { unsafe { AbortPrinter(printer.0); } }
        result
    }
}

#[tauri::command(async)]
pub fn printers(name: Option<String>) -> Result<Value> {
    #[cfg(windows)] {
        if let Some(name) = name { spooler::check(&name)?; return Ok(Value::Null); }
        spooler::list()
    }
    #[cfg(not(windows))] { let _ = name; Err("Windows printing is only available on Windows".into()) }
}

#[tauri::command(async)]
pub fn print_raw(name: String, bytes: Vec<u8>) -> Result<u32> {
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 { return Err("Invalid print job size".into()); }
    #[cfg(windows)] { spooler::write(&name, &bytes) }
    #[cfg(not(windows))] { let _ = name; Err("Windows printing is only available on Windows".into()) }
}
