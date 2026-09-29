package com.sellix.pos.backup;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Backup & restore of the local Sellix SQLite database as a single ".sellix" file.
 *
 * The live database is owned by @capacitor-community/sqlite (SQLCipher). This plugin never
 * opens that file while it is in use - a second SQLite library holding the same file open in
 * one process can corrupt it. Instead JS takes a consistent snapshot with `VACUUM INTO` on
 * the existing connection, and this plugin only touches that private copy. For a restore, JS
 * closes the connection first and then calls applyRestore().
 *
 * .sellix layout (formatVersion 1):
 *   "SELLIXBK" | version byte | 16-byte IV | AES-256-CTR( ZIP{ metadata.json, sellix.db } ) | HMAC-SHA256
 * The HMAC covers everything before it and is checked before anything is decrypted, so a
 * truncated, corrupted or edited file is rejected up front.
 *
 * NOTE: the keys are derived from a secret shipped inside the app. This keeps the database
 * unreadable to anyone who just opens the file and makes tampering detectable, but it is not
 * protection against someone who reverse-engineers the APK. Real confidentiality would need
 * a user-chosen backup password (PBKDF2 key) - a drop-in change to keys() below.
 */
@CapacitorPlugin(name = "SellixBackup")
public class SellixBackupPlugin extends Plugin {

    private static final String TAG = "SellixBackup";

    /** Must match the connection name in src/database/sqlite.ts (+ the plugin's "SQLite.db" suffix). */
    private static final String DB_FILE = "sellix_posSQLite.db";
    private static final String APP_NAME = "Sellix POS";
    private static final int FORMAT_VERSION = 1;
    private static final byte[] MAGIC = "SELLIXBK".getBytes(StandardCharsets.US_ASCII);
    private static final int IV_LENGTH = 16;
    private static final int MAC_LENGTH = 32;
    private static final int HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH;
    private static final String ENTRY_METADATA = "metadata.json";
    private static final String ENTRY_DATABASE = "sellix.db";
    private static final String KEY_SECRET = "sellix-pos/backup/v1/7c1f9e2a-43d8-4b6e-a0f5-2d9b8e61c4a7";
    private static final String[] REQUIRED_TABLES = { "users", "products", "categories", "sales", "store_settings" };

    private static final String PREFS = "sellix_backup";
    private static final String PREF_LAST_AT = "lastBackupAt";
    private static final String PREF_LAST_NAME = "lastBackupName";

    // Rejection codes; the rejection message itself is user-facing and shown as-is by JS.
    static final String E_NOT_SELLIX = "NOT_SELLIX_BACKUP";
    static final String E_CORRUPTED = "CORRUPTED";
    static final String E_UNSUPPORTED = "UNSUPPORTED_FORMAT";
    static final String E_NEWER_SCHEMA = "NEWER_SCHEMA";
    static final String E_STORAGE = "INSUFFICIENT_STORAGE";
    static final String E_NO_SNAPSHOT = "NO_SNAPSHOT";
    static final String E_NOTHING_STAGED = "NOTHING_STAGED";
    static final String E_IO = "IO_ERROR";

    /** Backup/restore I/O is serialized on one thread and never blocks the bridge. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final SecureRandom random = new SecureRandom();

    private static final class BackupException extends Exception {
        final String code;

        BackupException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /* ------------------------------------------------------------------
       PATHS
    ------------------------------------------------------------------ */

    private File workDir() {
        File dir = new File(getContext().getCacheDir(), "sellix-backup");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File snapshotFile() { return new File(workDir(), "snapshot.db"); }
    private File incomingFile() { return new File(workDir(), "incoming.sellix"); }
    private File stagedFile() { return new File(workDir(), "staged.db"); }
    private File verifyFile() { return new File(workDir(), "verify.db"); }
    private File liveDbFile() { return getContext().getDatabasePath(DB_FILE); }

    /* ------------------------------------------------------------------
       STATUS
    ------------------------------------------------------------------ */

    @PluginMethod
    public void getInfo(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("lastBackupAt", prefs.getString(PREF_LAST_AT, null));
        result.put("lastBackupName", prefs.getString(PREF_LAST_NAME, null));
        call.resolve(result);
    }

    /** Returns a fresh path for JS to `VACUUM INTO` (it refuses to overwrite an existing file). */
    @PluginMethod
    public void prepareSnapshot(PluginCall call) {
        File target = snapshotFile();
        deleteDatabaseFiles(target);

        // VACUUM output is at most the size of the live file; the .sellix build needs roughly one more copy.
        long needed = liveDbFile().length() * 2 + 1024 * 1024;
        if (workDir().getUsableSpace() < needed) {
            call.reject("Not enough free storage on this device to create the backup.", E_STORAGE);
            return;
        }
        JSObject result = new JSObject();
        result.put("path", target.getAbsolutePath());
        call.resolve(result);
    }

    /* ------------------------------------------------------------------
       BACKUP
    ------------------------------------------------------------------ */

    @PluginMethod
    public void pickBackupLocation(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // octet-stream keeps the ".sellix" name as typed (a known MIME type would get its own extension).
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("fileName", "Sellix_Backup.sellix"));
        startActivityForResult(call, intent, "backupLocationResult");
    }

    @ActivityCallback
    private void backupLocationResult(PluginCall call, ActivityResult result) {
        Uri uri = pickedUri(result);
        JSObject out = new JSObject();
        if (uri == null) {
            out.put("cancelled", true);
        } else {
            out.put("cancelled", false);
            out.put("uri", uri.toString());
            out.put("name", displayName(uri));
        }
        call.resolve(out);
    }

    /** Packs the snapshot taken by JS into the picked document, then re-reads and verifies it. */
    @PluginMethod
    public void writeBackup(PluginCall call) {
        String uriString = call.getString("uri");
        Integer schemaVersion = call.getInt("schemaVersion");
        if (uriString == null || schemaVersion == null) {
            call.reject("Missing backup destination.");
            return;
        }
        io.execute(() -> {
            Uri uri = Uri.parse(uriString);
            File snapshot = snapshotFile();
            try {
                if (!snapshot.exists() || snapshot.length() == 0) {
                    throw new BackupException(E_NO_SNAPSHOT, "The database snapshot could not be created.");
                }
                validateDatabase(snapshot);

                String createdAt = isoNow();
                JSONObject metadata = new JSONObject();
                metadata.put("formatVersion", FORMAT_VERSION);
                metadata.put("app", APP_NAME);
                metadata.put("appVersion", appVersion());
                metadata.put("databaseVersion", schemaVersion);
                metadata.put("createdAt", createdAt);
                metadata.put("databaseSize", snapshot.length());

                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("Could not open the selected location.");
                    writeSellix(out, metadata, snapshot);
                }

                // Verify what actually landed in storage, not what we meant to write.
                readSellix(uri, verifyFile(), Integer.MAX_VALUE);
                validateDatabase(verifyFile());

                String name = displayName(uri);
                getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(PREF_LAST_AT, createdAt)
                    .putString(PREF_LAST_NAME, name)
                    .apply();

                JSObject out = new JSObject();
                out.put("createdAt", createdAt);
                out.put("name", name);
                out.put("size", documentSize(uri));
                call.resolve(out);
            } catch (Exception e) {
                Log.e(TAG, "Backup failed", e);
                // Don't leave a half-written file behind that looks like a usable backup.
                try {
                    DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
                } catch (Exception ignored) {
                    // Provider may not support delete; the file then fails validation on restore.
                }
                reject(call, e);
            } finally {
                deleteDatabaseFiles(snapshot);
                deleteDatabaseFiles(verifyFile());
            }
        });
    }

    /* ------------------------------------------------------------------
       RESTORE
    ------------------------------------------------------------------ */

    @PluginMethod
    public void pickRestoreFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // ".sellix" has no registered MIME type; the file is identified by its content instead.
        intent.setType("*/*");
        startActivityForResult(call, intent, "restoreFileResult");
    }

    @ActivityCallback
    private void restoreFileResult(PluginCall call, ActivityResult result) {
        Uri uri = pickedUri(result);
        if (uri == null) {
            JSObject out = new JSObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        int maxSchemaVersion = call.getInt("maxSchemaVersion", Integer.MAX_VALUE);
        io.execute(() -> {
            try {
                deleteDatabaseFiles(stagedFile());
                JSONObject metadata = readSellix(uri, stagedFile(), maxSchemaVersion);
                long[] counts = validateDatabase(stagedFile());

                JSObject out = new JSObject();
                out.put("cancelled", false);
                out.put("name", displayName(uri));
                out.put("createdAt", metadata.optString("createdAt", null));
                out.put("appVersion", metadata.optString("appVersion", null));
                out.put("databaseVersion", metadata.optInt("databaseVersion"));
                out.put("products", counts[0]);
                out.put("sales", counts[1]);
                call.resolve(out);
            } catch (Exception e) {
                Log.e(TAG, "Restore validation failed", e);
                deleteDatabaseFiles(stagedFile());
                reject(call, e);
            } finally {
                deleteQuietly(incomingFile());
            }
        });
    }

    /**
     * Swaps the validated staged database in for the live one. JS must have closed its SQLite
     * connection first. The live file is only ever replaced by one atomic rename, so a failure
     * (or the app being killed) at any point leaves either the old or the new database intact.
     */
    @PluginMethod
    public void applyRestore(PluginCall call) {
        io.execute(() -> {
            File staged = stagedFile();
            File live = liveDbFile();
            File temp = new File(live.getPath() + ".restoring");
            try {
                if (!staged.exists() || staged.length() == 0) {
                    throw new BackupException(E_NOTHING_STAGED, "Select a backup file to restore first.");
                }
                if (live.getParentFile() != null && live.getParentFile().getUsableSpace() < staged.length() + 1024 * 1024) {
                    throw new BackupException(E_STORAGE, "Not enough free storage on this device to restore this backup.");
                }

                // Copy next to the live file first (same filesystem), so the swap is one rename.
                copyFile(staged, temp);
                deleteQuietly(new File(live.getPath() + "-wal"));
                deleteQuietly(new File(live.getPath() + "-shm"));
                deleteQuietly(new File(live.getPath() + "-journal"));
                if (!temp.renameTo(live)) {
                    throw new IOException("Could not replace the database file.");
                }

                deleteDatabaseFiles(staged);
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Restore failed", e);
                deleteQuietly(temp);
                reject(call, e);
            }
        });
    }

    /** Drops a staged restore the user declined. */
    @PluginMethod
    public void discardRestore(PluginCall call) {
        deleteDatabaseFiles(stagedFile());
        call.resolve();
    }

    /* ------------------------------------------------------------------
       .sellix FORMAT
    ------------------------------------------------------------------ */

    private SecretKeySpec[] keys() throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] enc = sha.digest(("enc:" + KEY_SECRET).getBytes(StandardCharsets.UTF_8));
        byte[] mac = sha.digest(("mac:" + KEY_SECRET).getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec[] { new SecretKeySpec(enc, "AES"), new SecretKeySpec(mac, "HmacSHA256") };
    }

    private void writeSellix(OutputStream destination, JSONObject metadata, File database) throws Exception {
        SecretKeySpec[] keys = keys();
        byte[] iv = new byte[IV_LENGTH];
        random.nextBytes(iv);

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(keys[1]);
        Cipher cipher = Cipher.getInstance("AES/CTR/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, keys[0], new IvParameterSpec(iv));

        OutputStream buffered = new BufferedOutputStream(destination, 64 * 1024);
        MacOutputStream macOut = new MacOutputStream(buffered, mac);
        macOut.write(MAGIC);
        macOut.write(FORMAT_VERSION);
        macOut.write(iv);

        CipherOutputStream encrypted = new CipherOutputStream(new NonClosingOutputStream(macOut), cipher);
        try (ZipOutputStream zip = new ZipOutputStream(encrypted)) {
            zip.putNextEntry(new ZipEntry(ENTRY_METADATA));
            zip.write(metadata.toString(2).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry(ENTRY_DATABASE));
            try (InputStream in = new FileInputStream(database)) {
                copy(in, zip);
            }
            zip.closeEntry();
        }
        buffered.write(mac.doFinal());
        buffered.flush();
    }

    /**
     * Authenticates, decrypts and unpacks a .sellix document, writing its database to dbOut.
     * Returns the metadata after checking it belongs to a backup this app can restore.
     */
    private JSONObject readSellix(Uri uri, File dbOut, int maxSchemaVersion) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        File incoming = incomingFile();
        deleteQuietly(incoming);
        // SAF streams can't seek, and the MAC must be checked before decrypting, so work from a local copy.
        try (InputStream in = resolver.openInputStream(uri); OutputStream out = new FileOutputStream(incoming)) {
            if (in == null) throw new IOException("Could not open the selected file.");
            copy(in, out);
        }

        long total = incoming.length();
        if (total < HEADER_LENGTH + MAC_LENGTH) {
            throw new BackupException(E_NOT_SELLIX, "This file isn't a Sellix backup.");
        }

        byte[] header = new byte[HEADER_LENGTH];
        byte[] storedMac = new byte[MAC_LENGTH];
        try (FileInputStream in = new FileInputStream(incoming)) {
            readFully(in, header);
            in.getChannel().position(total - MAC_LENGTH);
            readFully(in, storedMac);
        }
        if (!Arrays.equals(Arrays.copyOfRange(header, 0, MAGIC.length), MAGIC)) {
            throw new BackupException(E_NOT_SELLIX, "This file isn't a Sellix backup.");
        }
        int version = header[MAGIC.length] & 0xFF;
        if (version > FORMAT_VERSION) {
            throw new BackupException(E_UNSUPPORTED, "This backup was made by a newer version of Sellix. Update the app, then try again.");
        }

        SecretKeySpec[] keys = keys();
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(keys[1]);
        try (InputStream in = new BufferedInputStream(new FileInputStream(incoming))) {
            byte[] buffer = new byte[64 * 1024];
            long remaining = total - MAC_LENGTH;
            while (remaining > 0) {
                int read = in.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) throw new IOException("Unexpected end of file.");
                mac.update(buffer, 0, read);
                remaining -= read;
            }
        }
        if (!MessageDigest.isEqual(mac.doFinal(), storedMac)) {
            throw new BackupException(E_CORRUPTED, "This backup file is damaged or incomplete and can't be used.");
        }

        Cipher cipher = Cipher.getInstance("AES/CTR/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, keys[0], new IvParameterSpec(Arrays.copyOfRange(header, MAGIC.length + 1, HEADER_LENGTH)));

        JSONObject metadata = null;
        boolean hasDatabase = false;
        deleteDatabaseFiles(dbOut);
        try (FileInputStream raw = new FileInputStream(incoming)) {
            raw.getChannel().position(HEADER_LENGTH);
            InputStream body = new LimitedInputStream(new BufferedInputStream(raw), total - HEADER_LENGTH - MAC_LENGTH);
            try (ZipInputStream zip = new ZipInputStream(new CipherInputStream(body, cipher))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    if (ENTRY_METADATA.equals(entry.getName())) {
                        ByteArrayOutputStream json = new ByteArrayOutputStream();
                        copy(zip, json);
                        metadata = new JSONObject(json.toString("UTF-8"));
                    } else if (ENTRY_DATABASE.equals(entry.getName())) {
                        try (OutputStream out = new FileOutputStream(dbOut)) {
                            copy(zip, out);
                        }
                        hasDatabase = true;
                    }
                }
            }
        } finally {
            deleteQuietly(incoming);
        }

        if (metadata == null || !hasDatabase) {
            throw new BackupException(E_CORRUPTED, "This backup file is incomplete and can't be used.");
        }
        if (!APP_NAME.equals(metadata.optString("app"))) {
            throw new BackupException(E_NOT_SELLIX, "This file isn't a Sellix backup.");
        }
        if (metadata.optInt("formatVersion", Integer.MAX_VALUE) > FORMAT_VERSION) {
            throw new BackupException(E_UNSUPPORTED, "This backup was made by a newer version of Sellix. Update the app, then try again.");
        }
        if (metadata.optInt("databaseVersion", Integer.MAX_VALUE) > maxSchemaVersion) {
            throw new BackupException(E_NEWER_SCHEMA, "This backup was made by a newer version of Sellix. Update the app, then try again.");
        }
        return metadata;
    }

    /**
     * Opens a private (never the live) database copy, runs integrity_check and confirms it has
     * the Sellix tables. Returns { products, sales } row counts.
     */
    private long[] validateDatabase(File file) throws BackupException {
        SQLiteDatabase db = null;
        try {
            // Read-write so a WAL-mode header can be handled; this is our own throwaway copy.
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE);
            try (Cursor c = db.rawQuery("PRAGMA integrity_check", null)) {
                if (!c.moveToFirst() || !"ok".equalsIgnoreCase(c.getString(0))) {
                    throw new BackupException(E_CORRUPTED, "The database in this backup is damaged and can't be restored.");
                }
            }
            for (String table : REQUIRED_TABLES) {
                try (Cursor c = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", new String[] { table })) {
                    if (!c.moveToFirst()) {
                        throw new BackupException(E_NOT_SELLIX, "This file doesn't contain Sellix data.");
                    }
                }
            }
            return new long[] { count(db, "products"), count(db, "sales") };
        } catch (BackupException e) {
            throw e;
        } catch (Exception e) {
            throw new BackupException(E_CORRUPTED, "The database in this backup is damaged and can't be restored.");
        } finally {
            if (db != null) db.close();
        }
    }

    private static long count(SQLiteDatabase db, String table) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + table, null)) {
            return c.moveToFirst() ? c.getLong(0) : 0;
        }
    }

    /* ------------------------------------------------------------------
       HELPERS
    ------------------------------------------------------------------ */

    private static Uri pickedUri(ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) return null;
        return result.getData().getData();
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            // Fall through to the URI's last segment.
        }
        return uri.getLastPathSegment();
    }

    private long documentSize(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception ignored) {
            // Size is informational only.
        }
        return -1;
    }

    private String appVersion() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static void reject(PluginCall call, Exception e) {
        if (e instanceof BackupException) {
            call.reject(e.getMessage(), ((BackupException) e).code);
        } else if (isOutOfSpace(e)) {
            call.reject("Not enough free storage to complete this. Free up some space and try again.", E_STORAGE);
        } else {
            call.reject("Something went wrong reading or writing the backup file.", E_IO);
        }
    }

    private static boolean isOutOfSpace(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String message = t.getMessage();
            if (message != null && (message.contains("ENOSPC") || message.contains("No space left"))) return true;
        }
        return false;
    }

    private static void copyFile(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); FileOutputStream out = new FileOutputStream(to)) {
            copy(in, out);
            out.getFD().sync();
        }
        if (to.length() != from.length()) throw new IOException("Copy was incomplete.");
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
    }

    private static void readFully(InputStream in, byte[] target) throws IOException {
        int offset = 0;
        while (offset < target.length) {
            int read = in.read(target, offset, target.length - offset);
            if (read < 0) throw new IOException("Unexpected end of file.");
            offset += read;
        }
    }

    /** Removes a temp database together with any -journal / -wal / -shm left by validation. */
    private static void deleteDatabaseFiles(File file) {
        if (file != null && !SQLiteDatabase.deleteDatabase(file) && file.exists()) Log.w(TAG, "Could not delete " + file);
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) Log.w(TAG, "Could not delete " + file);
    }

    /** Feeds every byte written into the MAC. */
    private static final class MacOutputStream extends OutputStream {
        private final OutputStream out;
        private final Mac mac;

        MacOutputStream(OutputStream out, Mac mac) {
            this.out = out;
            this.mac = mac;
        }

        @Override public void write(int b) throws IOException {
            mac.update((byte) b);
            out.write(b);
        }

        @Override public void write(byte[] b, int off, int len) throws IOException {
            mac.update(b, off, len);
            out.write(b, off, len);
        }

        @Override public void flush() throws IOException { out.flush(); }
    }

    /** Lets the zip/cipher streams finish without closing the destination before the MAC is appended. */
    private static final class NonClosingOutputStream extends OutputStream {
        private final OutputStream out;

        NonClosingOutputStream(OutputStream out) { this.out = out; }

        @Override public void write(int b) throws IOException { out.write(b); }
        @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); }
        @Override public void flush() throws IOException { out.flush(); }
        @Override public void close() throws IOException { out.flush(); }
    }

    /** Stops reading before the trailing MAC. */
    private static final class LimitedInputStream extends InputStream {
        private final InputStream in;
        private long remaining;

        LimitedInputStream(InputStream in, long limit) {
            this.in = in;
            this.remaining = limit;
        }

        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read();
            if (b >= 0) remaining--;
            return b;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int read = in.read(b, off, (int) Math.min(len, remaining));
            if (read > 0) remaining -= read;
            return read;
        }

        @Override public void close() throws IOException { in.close(); }
    }
}
