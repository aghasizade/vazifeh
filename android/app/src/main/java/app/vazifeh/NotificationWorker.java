package app.vazifeh;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

// Background check for new notifications, without Google's push service: asks the company server
// what arrived since the last one shown and puts it in the notification shade.
public class NotificationWorker extends Worker {
    static final String CHANNEL = "tasks";

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String server = prefs.getString("stt_server", "");
        String token = prefs.getString("stt_token", "");
        if (server.isEmpty() || token.isEmpty() || MainActivity.inForeground) return Result.success();
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return Result.success();
        long after = 0;
        try { after = Long.parseLong(prefs.getString("stt_last_notification", "0")); } catch (NumberFormatException ignored) { }

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(server + "/api/notifications/since?after=" + after).openConnection();
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            if (conn.getResponseCode() != 200) return Result.success();
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONArray list = new JSONObject(body.toString()).optJSONArray("notifications");
            if (list == null) return Result.success();
            long max = after;
            MainActivity.createChannel(context);
            // Alarms the app scheduled on this phone itself have already rung at their minute: skip the server's copy.
            String scheduledAlarms = "\n" + prefs.getString("stt_alarm_keys", "") + "\n";
            for (int i = 0; i < list.length(); i++) {
                JSONObject n = list.getJSONObject(i);
                long id = n.getLong("id");
                max = Math.max(max, id);
                if ("alarm".equals(n.optString("type")) && scheduledAlarms.contains("\n" + n.optString("key") + "\n")) continue;
                show(context, (int) (id % Integer.MAX_VALUE), n.optString("title"), n.optString("body"), n.optString("link"));
            }
            prefs.edit().putString("stt_last_notification", String.valueOf(max)).apply();
        } catch (Exception e) {
            // No network or server down: try again at the next run.
        } finally {
            if (conn != null) conn.disconnect();
        }
        return Result.success();
    }

    private void show(Context context, int id, String title, String body, String link) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("link", link);
        PendingIntent pending = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFFC97422)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending);
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission was revoked.
        }
    }
}
