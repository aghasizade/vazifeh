package app.vazifeh;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;

import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    // While the app is on screen its live connection shows notifications; the background check stays quiet.
    static volatile boolean inForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SttNativePlugin.class);
        super.onCreate(savedInstanceState);
        createChannel(this);
        rememberLink(getIntent());
        scheduleBackgroundCheck(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        rememberLink(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        inForeground = false;
    }

    // A tapped notification carries the page to open; the web app picks it up from storage.
    private void rememberLink(Intent intent) {
        if (intent == null) return;
        String link = intent.getStringExtra("link");
        if (link != null && !link.isEmpty()) {
            getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString("stt_pending_link", link).apply();
        }
    }

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(NotificationWorker.CHANNEL, "وظایف و پیام‌ها", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("تسک جدید، پیام، درخواست تأیید و یادآوری‌ها");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    // Android runs periodic work at most every 15 minutes; it survives reboots and app restarts.
    static void scheduleBackgroundCheck(Context context) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(NotificationWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("stt-notifications", ExistingPeriodicWorkPolicy.KEEP, request);
    }
}
