package ru.oldgold.game;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Save JSON through Android's Storage Access Framework, without storage permissions. */
@CapacitorPlugin(name = "OldGoldFiles")
public class OldGoldFilesPlugin extends Plugin {
    private volatile boolean exporting = false;

    @PluginMethod
    public void saveFile(PluginCall call) {
        if (exporting) { call.reject("An export is already open", "BUSY"); return; }
        String data = call.getString("data");
        String name = call.getString("name", "oldgold-save.json");
        if (data == null) { call.reject("Missing file content", "INVALID_DATA"); return; }
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (name.length() > 120) name = name.substring(0, 115) + ".json";
        File pending = null;
        try {
            // Keep the large JSON out of Capacitor's saved Activity state Bundle.
            // The temporary file also survives process recreation while picking a destination.
            File dir = new File(getContext().getCacheDir(), "oldgold-exports");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("Cannot create export cache");
            pending = File.createTempFile("oldgold-", ".json", dir);
            try (OutputStream out = new FileOutputStream(pending)) { out.write(data.getBytes(StandardCharsets.UTF_8)); }
            call.getData().remove("data");
            call.getData().put("exportFile", pending.getName());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, name);
            exporting = true;
            final File ready = pending;
            getBridge().executeOnMainThread(() -> {
                try { startActivityForResult(call, intent, "fileChosen"); }
                catch (Exception e) {
                    exporting = false;
                    ready.delete();
                    call.reject("Unable to open file destination", "EXPORT_FAILED", e);
                }
            });
        } catch (Exception e) {
            exporting = false;
            if (pending != null) pending.delete();
            call.reject("Unable to open file destination", "EXPORT_FAILED", e);
        }
    }

    private File pendingFile(PluginCall call) throws java.io.IOException {
        String name = call.getString("exportFile", "");
        if (!name.matches("oldgold-[A-Za-z0-9_-]+\\.json")) throw new java.io.IOException("Invalid export cache reference");
        File dir = new File(getContext().getCacheDir(), "oldgold-exports").getCanonicalFile();
        File file = new File(dir, name).getCanonicalFile();
        if (!dir.equals(file.getParentFile())) throw new java.io.IOException("Invalid export cache path");
        return file;
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) { exporting = false; return; }
        // Document providers can perform slow I/O. Do not block Android's UI thread.
        getBridge().execute(() -> {
            File pending = null;
            try {
                pending = pendingFile(call);
                Uri uri = result.getData() == null ? null : result.getData().getData();
                if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
                    JSObject answer = new JSObject(); answer.put("saved", false); answer.put("cancelled", true);
                    call.resolve(answer);
                    return;
                }
                try (FileInputStream input = new FileInputStream(pending);
                     OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("Cannot open destination");
                    byte[] buffer = new byte[16384];
                    int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                    output.flush();
                }
                JSObject answer = new JSObject(); answer.put("saved", true); answer.put("cancelled", false);
                call.resolve(answer);
            } catch (Exception e) {
                call.reject("Unable to write file", "EXPORT_FAILED", e);
            } finally {
                if (pending != null) pending.delete();
                exporting = false;
            }
        });
    }
}
