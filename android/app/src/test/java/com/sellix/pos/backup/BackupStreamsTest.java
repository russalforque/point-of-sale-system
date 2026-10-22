package com.sellix.pos.backup;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import org.junit.Test;

public class BackupStreamsTest {
    @Test
    public void copiesEmptyAndExactLimitWithoutTruncation() throws Exception {
        byte[] bytes = new byte[140_000];
        Arrays.fill(bytes, (byte) 37);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        BackupStreams.copyLimited(new ByteArrayInputStream(new byte[0]), output, 0);
        BackupStreams.copyLimited(new ByteArrayInputStream(bytes), output, bytes.length);
        assertArrayEquals(bytes, output.toByteArray());
    }

    @Test
    public void rejectsUnknownLengthStreamsBeforeWritingBeyondTheLimit() {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        InputStream unknownLength = new ByteArrayInputStream(new byte[140_001]) {
            @Override public int available() { return 0; }
        };
        assertThrows(IOException.class, () -> BackupStreams.copyLimited(unknownLength, output, 140_000));
        assertTrue(output.size() <= 140_000);
    }

    @Test
    public void rejectsExpandedZipDataEvenWhenTheArchiveIsSmall() throws Exception {
        ByteArrayOutputStream archive = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(archive)) {
            zip.putNextEntry(new ZipEntry("sellix.db"));
            zip.write(new byte[200_000]);
            zip.closeEntry();
        }
        assertTrue(archive.size() < 2_000);
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive.toByteArray()))) {
            zip.getNextEntry();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            assertThrows(IOException.class, () -> BackupStreams.copyLimited(zip, output, 100_000));
            assertTrue(output.size() <= 100_000);
        }
    }
}
