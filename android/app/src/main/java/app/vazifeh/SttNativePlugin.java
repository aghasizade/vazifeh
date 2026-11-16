package app.vazifeh;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

import androidx.core.content.FileProvider;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Small bridge for what the web app cannot do itself: the battery-saver exemption and opening links outside.
@CapacitorPlugin(name = "SttNative")
public class SttNativePlugin extends Plugin {

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("ignoring", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("manufacturer", Build.MANUFACTURER);
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("no url");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // In-app update: downloads the APK from the company server into the cache and opens Android's installer.
    // Works without a browser; the first time Android asks to allow installs from this app.
    // Up to 1.0.9 a cut-off download, or a second tap overwriting the file the installer was reading, made Android
    // say "package appears to be invalid". Now: one download at a time, into a new file each time, checked for its
    // full size and that Android can read it as our app, and retried once before giving up.
    private static final AtomicBoolean updating = new AtomicBoolean(false);

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("no url");
            return;
        }
        if (!updating.compareAndSet(false, true)) {
            call.reject("busy", "BUSY");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File apk = null;
                Exception last = null;
                for (int attempt = 0; attempt < 2 && apk == null; attempt++) {
                    try {
                        apk = download(url, dir);
                    } catch (Exception e) {
                        last = e;
                    }
                }
                if (apk == null) throw last != null ? last : new Exception("download failed");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject("download failed: " + e.getMessage());
            } finally {
                updating.set(false);
            }
        }).start();
    }

    // One attempt: a fresh .part file, renamed to .apk only when it is complete and Android can parse it.
    private File download(String url, File dir) throws Exception {
        HttpURLConnection conn = null;
        String name = "update-" + System.currentTimeMillis();
        File part = new File(dir, name + ".part");
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            // The size check needs the bytes as stored, not a compressed transfer.
            conn.setRequestProperty("Accept-Encoding", "identity");
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            long total = conn.getContentLengthLong();
            long loaded = 0;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                long lastSent = 0;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                    loaded += n;
                    // The page shows a percentage on the update button; a few updates a second are plenty.
                    long now = System.currentTimeMillis();
                    if (now - lastSent > 200) {
                        lastSent = now;
                        sendProgress(loaded, total);
                    }
                }
                out.getFD().sync();
            }
            if (total > 0 && loaded != total) throw new Exception("incomplete: " + loaded + " of " + total);
            PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(part.getAbsolutePath(), 0);
            if (info == null || !getContext().getPackageName().equals(info.packageName)) throw new Exception("not a valid update file");
            File apk = new File(dir, name + ".apk");
            if (!part.renameTo(apk)) throw new Exception("could not save the update");
            sendProgress(loaded, loaded);
            return apk;
        } catch (Exception e) {
            part.delete();
            throw e;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void sendProgress(long loaded, long total) {
        JSObject progress = new JSObject();
        progress.put("loaded", loaded);
        progress.put("total", total);
        notifyListeners("updateProgress", progress);
    }

    @PluginMethod
    public void checkNow(PluginCall call) {
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(NotificationWorker.class).build());
        call.resolve();
    }
}
