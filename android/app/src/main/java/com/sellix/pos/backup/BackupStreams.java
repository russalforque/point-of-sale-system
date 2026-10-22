package com.sellix.pos.backup;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Bounds actual streamed bytes, including providers and ZIP entries with no declared size. */
final class BackupStreams {
    private BackupStreams() {}

    static void copyLimited(InputStream input, OutputStream output, long maximum) throws IOException {
        if (maximum < 0) throw new IllegalArgumentException("A non-negative limit is required.");
        byte[] buffer = new byte[64 * 1024];
        long copied = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (read > maximum - copied) {
                throw new IOException("This backup exceeds the supported file size.");
            }
            output.write(buffer, 0, read);
            copied += read;
        }
    }
}
