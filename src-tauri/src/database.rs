use crate::{Result, Store as SharedStore};
use rusqlite::{params_from_iter, types::{Value as SqlValue, ValueRef}, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};

pub struct Store {
    pub directory: PathBuf,
    pub connection: Option<Connection>,
    pub staged: Option<Value>,
}

impl Store {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, connection: None, staged: None }
    }
    pub fn path(&self) -> PathBuf { self.directory.join("sellix_posSQLite.db") }
    pub fn open(&mut self) -> Result<()> {
        if self.connection.is_none() {
            let db = Connection::open(self.path()).map_err(|e| e.to_string())?;
            db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
            db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
                .map_err(|e| e.to_string())?;
            self.connection = Some(db);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct Statement {
    statement: String,
    #[serde(default)]
    values: Vec<Value>,
}

fn parameters(values: Vec<Value>) -> Result<Vec<SqlValue>> {
    values.into_iter().map(|value| Ok(match value {
        Value::Null => SqlValue::Null,
        Value::Bool(v) => SqlValue::Integer(i64::from(v)),
        Value::Number(v) => if let Some(n) = v.as_i64() { SqlValue::Integer(n) }
            else { SqlValue::Real(v.as_f64().ok_or("Invalid number")?) },
        Value::String(v) => SqlValue::Text(v),
        _ => return Err("SQL parameters must be scalar values".into()),
    })).collect()
}

pub fn atomic<T>(db: &Connection, enabled: bool, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    if enabled {
        if !db.is_autocommit() { return Err("Another database transaction is active".into()); }
        db.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    }
    match operation() {
        Ok(result) => {
            if enabled {
                if let Err(error) = db.execute_batch("COMMIT") {
                    let _ = db.execute_batch("ROLLBACK");
                    return Err(error.to_string());
                }
            }
            Ok(result)
        },
        Err(error) => {
            if enabled { let _ = db.execute_batch("ROLLBACK"); }
            Err(error)
        }
    }
}

#[tauri::command(async)]
pub fn database(store: SharedStore<'_>, operation: String, statement: Option<String>,
    values: Option<Vec<Value>>, statements: Option<Vec<Statement>>, transaction: Option<bool>) -> Result<Value> {
    let mut state = store.lock().map_err(|_| "Database lock failed")?;
    if operation == "open" { state.open()?; return Ok(Value::Null); }
    if operation == "close" {
        if let Some(db) = state.connection.take() {
            if !db.is_autocommit() { state.connection = Some(db); return Err("A save is still in progress".into()); }
            if let Err((db, error)) = db.close() { state.connection = Some(db); return Err(error.to_string()); }
        }
        return Ok(Value::Null);
    }
    let db = state.connection.as_ref().ok_or("Database is closed. Restart Sellix.")?;
    let sql = statement.unwrap_or_default();
    let args = parameters(values.unwrap_or_default())?;
    let changes = || json!({ "changes": { "changes": db.changes(), "lastId": db.last_insert_rowid() } });
    match operation.as_str() {
        "query" => {
            let mut query = db.prepare(&sql).map_err(|e| e.to_string())?;
            if !query.readonly() { return Err("A query cannot change data".into()); }
            let names: Vec<String> = query.column_names().iter().map(|v| v.to_string()).collect();
            let mut rows = query.query(params_from_iter(args)).map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let mut object = serde_json::Map::new();
                for (index, name) in names.iter().enumerate() {
                    let value = match row.get_ref(index).map_err(|e| e.to_string())? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(v) => json!(v),
                        ValueRef::Real(v) => json!(v),
                        ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                        ValueRef::Blob(v) => json!(v),
                    };
                    object.insert(name.clone(), value);
                }
                result.push(Value::Object(object));
            }
            Ok(json!({ "values": result }))
        },
        "run" | "execute" | "set" => atomic(db, transaction.unwrap_or(true), || {
            match operation.as_str() {
                "run" => { db.execute(&sql, params_from_iter(args)).map_err(|e| e.to_string())?; },
                "execute" => db.execute_batch(&sql).map_err(|e| e.to_string())?,
                _ => for entry in statements.unwrap_or_default() {
                    db.execute(&entry.statement, params_from_iter(parameters(entry.values)?)).map_err(|e| e.to_string())?;
                }
            }
            Ok(changes())
        }),
        "active" => Ok(json!({ "result": !db.is_autocommit() })),
        "begin" | "commit" | "rollback" => {
            let sql = match operation.as_str() { "begin" => "BEGIN IMMEDIATE", "commit" => "COMMIT", _ => "ROLLBACK" };
            db.execute_batch(sql).map_err(|e| e.to_string())?;
            Ok(changes())
        },
        _ => Err("Unsupported database operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_transaction_retains_stock_and_has_no_sale() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE stock(qty INTEGER CHECK(qty>=0)); INSERT INTO stock VALUES(2); CREATE TABLE sales(id INTEGER PRIMARY KEY);").unwrap();
        let result = atomic(&db, true, || {
            db.execute_batch("INSERT INTO sales VALUES(1); UPDATE stock SET qty=-1;").map_err(|e| e.to_string())
        });
        assert!(result.is_err());
        assert!(db.is_autocommit());
        assert_eq!(db.query_row("SELECT qty FROM stock", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(db.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}
