use crate::{Result, Store};
use aes::cipher::{KeyIvInit, StreamCipher};
use hmac::{Hmac, Mac};
use rand::RngCore;
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Cursor, Read, Write}, path::{Path, PathBuf}};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const SECRET: &str = "sellix-pos/backup/v1/7c1f9e2a-43d8-4b6e-a0f5-2d9b8e61c4a7";
const MAX_FILE: u64 = 512 * 1024 * 1024;
type Cipher = ctr::Ctr128BE<aes::Aes256>;
type Auth = Hmac<Sha256>;

fn key(prefix: &str) -> Vec<u8> { Sha256::digest(format!("{prefix}:{SECRET}").as_bytes()).to_vec() }
fn now() -> String { chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }
fn name(path: &Path) -> String { path.file_name().unwrap_or_default().to_string_lossy().into_owned() }

/// Same authenticated format as Android. These embedded keys are obfuscation, not a user password.
fn encode(metadata: &Value, database: &[u8]) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("metadata.json", options).map_err(|e| e.to_string())?;
    zip.write_all(metadata.to_string().as_bytes()).map_err(|e| e.to_string())?;
    zip.start_file("sellix.db", options).map_err(|e| e.to_string())?;
    zip.write_all(database).map_err(|e| e.to_string())?;
    let mut body = zip.finish().map_err(|e| e.to_string())?.into_inner();
    let mut iv = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut iv);
    Cipher::new_from_slices(&key("enc"), &iv).map_err(|e| e.to_string())?.apply_keystream(&mut body);
    let mut result = b"SELLIXBK\x01".to_vec();
    result.extend(iv);
    result.extend(body);
    let mut mac = Auth::new_from_slice(&key("mac")).map_err(|e| e.to_string())?;
    mac.update(&result);
    result.extend(mac.finalize().into_bytes());
    Ok(result)
}

fn decode(bytes: &[u8], max_schema: u64) -> Result<(Value, Vec<u8>)> {
    if bytes.len() < 57 || &bytes[..8] != b"SELLIXBK" { return Err("This is not a Sellix backup".into()); }
    if bytes[8] != 1 { return Err("Unsupported backup format. Update Sellix first.".into()); }
    let end = bytes.len() - 32;
    let mut mac = Auth::new_from_slice(&key("mac")).map_err(|e| e.to_string())?;
    mac.update(&bytes[..end]);
    mac.verify_slice(&bytes[end..]).map_err(|_| "Backup is damaged or incomplete")?;
    let mut body = bytes[25..end].to_vec();
    Cipher::new_from_slices(&key("enc"), &bytes[9..25]).map_err(|e| e.to_string())?.apply_keystream(&mut body);
    let mut zip = ZipArchive::new(Cursor::new(body)).map_err(|e| e.to_string())?;
    if zip.len() != 2 { return Err("Invalid backup contents".into()); }
    fn entry(zip: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str, limit: u64) -> Result<Vec<u8>> {
        let file = zip.by_name(name).map_err(|_| "Missing backup contents")?;
        if file.size() > limit { return Err("Backup exceeds the supported size".into()); }
        let mut result = Vec::new();
        file.take(limit + 1).read_to_end(&mut result).map_err(|e| e.to_string())?;
        if result.len() as u64 > limit { return Err("Backup exceeds the supported size".into()); }
        Ok(result)
    }
    let metadata: Value = serde_json::from_slice(&entry(&mut zip, "metadata.json", 65536)?).map_err(|e| e.to_string())?;
    if metadata["app"] != "Sellix POS" || metadata["formatVersion"] != 1 { return Err("Invalid Sellix backup metadata".into()); }
    if metadata["databaseVersion"].as_u64().filter(|v| *v <= max_schema).is_none() {
        return Err("This backup needs a newer Sellix version".into());
    }
    Ok((metadata, entry(&mut zip, "sellix.db", MAX_FILE)?))
}

fn validate(path: &Path) -> Result<(u64, u64)> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if integrity != "ok" { return Err("The database in this backup is damaged".into()); }
    // Reject broken relationships before replacement, including a partially copied database.
    let violations = db.prepare("PRAGMA foreign_key_check").map_err(|e| e.to_string())?
        .exists([]).map_err(|e| e.to_string())?;
    if violations { return Err("The backup contains inconsistent records".into()); }
    for table in ["users", "products", "categories", "sales", "store_settings"] {
        let found: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)", [table], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !found { return Err("This file does not contain Sellix data".into()); }
    }
    let products = db.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let sales = db.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok((products, sales))
}

/// Flush beside the target and replace atomically, including when overwriting an existing file.
fn replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" { fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32; }
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 1 | 8) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
        Ok(())
    }
    #[cfg(not(windows))] { fs::rename(source, destination).map_err(|e| e.to_string()) }
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = PathBuf::from(format!("{}.{}.tmp", path.display(), rand::random::<u64>()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        replace(&temporary, path)
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}
fn clean(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] { let _ = fs::remove_file(format!("{}{suffix}", path.display())); }
}
fn read_limited(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_FILE { return Err("Backup exceeds 512 MB".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE { return Err("Backup exceeds 512 MB".into()); }
    Ok(bytes)
}

fn protect_business_data(path: &Path, directory: &Path) -> Result<()> {
    let parent = path.parent().ok_or("Choose an export folder")?.canonicalize().map_err(|e| e.to_string())?;
    let protected = directory.canonicalize().map_err(|e| e.to_string())?;
    if parent.starts_with(protected) { return Err("Choose a folder outside Sellix's business database directory".into()); }
    Ok(())
}

fn validate_schema(path: &Path, maximum: u64) -> Result<()> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let has_marker: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sellix_schema')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if has_marker {
        let version: u64 = db.query_row("SELECT COALESCE(MAX(version),0) FROM sellix_schema", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if version > maximum { return Err("The database in this backup needs a newer Sellix version".into()); }
    }
    Ok(())
}

fn apply_restore(state: &mut crate::database::Store) -> Result<()> {
    let staged = state.directory.join("restore-staged.db");
    if state.connection.is_some() { return Err("Close the database before restoring".into()); }
    let candidate = state.staged.as_ref().ok_or("Select a backup first")?;
    if !staged.exists() { return Err("Select a backup first".into()); }
    validate(&staged)?;
    validate_schema(&staged, candidate["databaseVersion"].as_u64().ok_or("Invalid staged schema")?)?;
    // Keep the prior database independently of the user-selected backup.
    // All connections are closed; successful close has checkpointed the WAL.
    let live = state.path();
    let recovery = state.directory.join(format!("before-restore-{}.db", chrono::Utc::now().format("%Y%m%d%H%M%S%f")));
    if live.exists() {
        let db = Connection::open(&live).map_err(|e| e.to_string())?;
        db.backup(DatabaseName::Main, &recovery, None).map_err(|e| e.to_string())?;
        validate(&recovery)?;
        db.close().map_err(|(_, e)| e.to_string())?;
    }
    // Any surviving WAL indicates an unclosed writer: never discard it.
    let wal = PathBuf::from(format!("{}-wal", live.display()));
    if wal.exists() && fs::metadata(&wal).map_err(|e| e.to_string())?.len() > 0 { return Err("Database still has a live journal. Restart before restoring.".into()); }
    for suffix in ["-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", live.display()));
        if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    }
    replace(&staged, &live)?;
    state.staged = None;
    Ok(())
}

#[tauri::command(async)]
pub fn export_file(store: Store<'_>, name: String, bytes: Vec<u8>) -> Result<bool> {
    if name.chars().any(|character| character == '/' || character == '\\' || character == '\0') { return Err("Invalid export filename".into()); }
    let Some(path) = rfd::FileDialog::new().set_file_name(&name).save_file() else { return Ok(false); };
    protect_business_data(&path, &store.lock().map_err(|_| "Database lock failed")?.directory)?;
    write_atomic(&path, &bytes)?;
    Ok(true)
}

#[tauri::command(async)]
pub fn backup(store: Store<'_>, operation: String, schema_version: Option<u64>) -> Result<Value> {
    let mut state = store.lock().map_err(|_| "Database lock failed")?;
    let snapshot = state.directory.join("backup-snapshot.db");
    let staged = state.directory.join("restore-staged.db");
    let info = state.directory.join("backup-info.json");
    match operation.as_str() {
        "info" => Ok(fs::read(&info).ok().and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or(json!({ "lastBackupAt": null, "lastBackupName": null }))),
        "create" => {
            let schema = schema_version.ok_or("Schema version is required")?;
            let file_name = format!("Sellix_Backup_{}.sellix", chrono::Local::now().format("%Y-%m-%d_%H%M%S"));
            let Some(path) = rfd::FileDialog::new().add_filter("Sellix backup", &["sellix"]).set_file_name(file_name).save_file() else { return Ok(Value::Null); };
            protect_business_data(&path, &state.directory)?;
            let db = state.connection.as_ref().ok_or("Database is closed")?;
            if !db.is_autocommit() { return Err("A save is still in progress".into()); }
            clean(&snapshot);
            let result = (|| {
                db.backup(DatabaseName::Main, &snapshot, None).map_err(|e| e.to_string())?;
                validate(&snapshot)?;
                let created = now();
                let metadata = json!({ "app": "Sellix POS", "formatVersion": 1, "databaseVersion": schema, "appVersion": env!("CARGO_PKG_VERSION"), "createdAt": created });
                let bytes = encode(&metadata, &read_limited(&snapshot)?)?;
                if bytes.len() as u64 > MAX_FILE { return Err("Backup exceeds 512 MB. No file was written.".into()); }
                let (verified, contents) = decode(&bytes, schema)?;
                if verified != metadata || contents != read_limited(&snapshot)? { return Err("Backup verification failed".into()); }
                write_atomic(&path, &bytes)?;
                // The backup already succeeded; a preferences failure must not report it as failed.
                let _ = write_atomic(&info, json!({ "lastBackupAt": created, "lastBackupName": name(&path) }).to_string().as_bytes());
                Ok(json!({ "createdAt": created, "name": name(&path), "size": bytes.len() }))
            })();
            clean(&snapshot);
            result
        },
        "pick" => {
            state.staged = None;
            clean(&staged);
            let Some(path) = rfd::FileDialog::new().add_filter("Sellix backup", &["sellix"]).pick_file() else { return Ok(Value::Null); };
            let (metadata, bytes) = decode(&read_limited(&path)?, schema_version.ok_or("Schema version is required")?)?;
            write_atomic(&staged, &bytes)?;
            let (products, sales) = match validate(&staged) { Ok(v) => v, Err(e) => { clean(&staged); return Err(e); } };
            if let Err(error) = validate_schema(&staged, schema_version.unwrap_or(0)) { clean(&staged); return Err(error); }
            let candidate = json!({ "name": name(&path), "createdAt": metadata["createdAt"], "appVersion": metadata["appVersion"],
                "databaseVersion": metadata["databaseVersion"], "products": products, "sales": sales });
            state.staged = Some(candidate.clone());
            Ok(candidate)
        },
        "discard" => { state.staged = None; clean(&staged); Ok(Value::Null) },
        "apply" => {
            apply_restore(&mut state)?;
            Ok(Value::Null)
        },
        _ => Err("Unsupported backup operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_backup_roundtrip_rejects_tampering_and_newer_schema() {
        let metadata = json!({ "app": "Sellix POS", "formatVersion": 1, "databaseVersion": 9 });
        let mut encoded = encode(&metadata, b"test database bytes").unwrap();
        assert_eq!(decode(&encoded, 9).unwrap(), (metadata, b"test database bytes".to_vec()));
        assert!(decode(&encoded, 8).is_err());
        encoded[30] ^= 1;
        assert!(decode(&encoded, 9).is_err());
        assert!(decode(&encoded[..40], 9).is_err());
    }

    fn fixture(path: &Path, count: u64) {
        let db = Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE products(id INTEGER PRIMARY KEY); CREATE TABLE categories(id INTEGER PRIMARY KEY); CREATE TABLE sales(id INTEGER PRIMARY KEY); CREATE TABLE store_settings(id INTEGER PRIMARY KEY); CREATE TABLE sellix_schema(version INTEGER); INSERT INTO sellix_schema VALUES(9);").unwrap();
        for id in 0..count { db.execute("INSERT INTO sales VALUES(?)", [id]).unwrap(); }
    }

    #[test]
    fn restore_keeps_recovery_copy_and_rejects_corrupt_staging() {
        let directory = std::env::temp_dir().join(format!("sellix-restore-test-{}", rand::random::<u64>()));
        fs::create_dir_all(&directory).unwrap();
        let mut state = crate::database::Store::new(directory.clone());
        fixture(&state.path(), 2);
        let staged = directory.join("restore-staged.db");
        fixture(&staged, 1);
        state.staged = Some(json!({ "databaseVersion": 9 }));
        assert!(protect_business_data(&state.path(), &directory).is_err());
        apply_restore(&mut state).unwrap();
        assert_eq!(validate(&state.path()).unwrap(), (0, 1));
        let recovery = fs::read_dir(&directory).unwrap().filter_map(|v| v.ok()).find(|v| name(&v.path()).starts_with("before-restore-")).unwrap().path();
        assert_eq!(validate(&recovery).unwrap(), (0, 2));
        assert!(state.staged.is_none());
        fs::write(&staged, b"corrupt database").unwrap();
        state.staged = Some(json!({ "databaseVersion": 9 }));
        assert!(apply_restore(&mut state).is_err());
        assert_eq!(validate(&state.path()).unwrap(), (0, 1));
        fs::remove_dir_all(directory).unwrap();
    }
}
