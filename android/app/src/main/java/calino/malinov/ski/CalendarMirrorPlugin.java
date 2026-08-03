package calino.malinov.ski;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.CalendarContract;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

/**
 * Capacitor bridge for the calendar mirror. The reconcile itself lives in
 * {@link CalendarMirrorWriter}, shared with {@link HeadlessSyncWorker}; this
 * class only handles permissions, the bridge plumbing, and scheduling the
 * background refresh.
 *
 * <p>See {@code src/lib/calendarMirror.ts} for the JS side and
 * {@code android/CLAUDE.md} for why the mirror is not a sync adapter.
 */
@CapacitorPlugin(
    name = "CalendarMirror",
    permissions = {
        @Permission(
            alias = CalendarMirrorPlugin.CALENDAR_PERMISSION,
            strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }
        )
    }
)
public class CalendarMirrorPlugin extends Plugin {
    static final String CALENDAR_PERMISSION = "calendar";

    // ---------------------------------------------------------------- permissions

    @PluginMethod
    public void checkCalendarPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(CALENDAR_PERMISSION) == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void requestCalendarPermission(PluginCall call) {
        if (getPermissionState(CALENDAR_PERMISSION) == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(CALENDAR_PERMISSION, call, "calendarPermissionCallback");
    }

    @PermissionCallback
    private void calendarPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(CALENDAR_PERMISSION) == PermissionState.GRANTED);
        call.resolve(result);
    }

    /**
     * Whether any installed app can present calendar events.
     *
     * <p>This matters because the provider stores reminders but does not post
     * notifications for them: in AOSP it is the calendar <em>app</em> that
     * receives the provider's reminder broadcast and raises the notification.
     * On a device with no calendar app, handing reminders to the provider would
     * silently drop them, so the JS side keeps its own {@code LocalNotifications}
     * scheduling when this returns false.
     */
    @PluginMethod
    public void hasCalendarApp(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI);
        List<?> handlers = getContext()
            .getPackageManager()
            .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);

        JSObject result = new JSObject();
        result.put("present", !handlers.isEmpty());
        call.resolve(result);
    }

    // ---------------------------------------------------------------- sync

    /**
     * Reconciles the mirror against the given calendars and events. Both lists
     * are the complete desired state — anything of ours not present is removed.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        if (getPermissionState(CALENDAR_PERMISSION) != PermissionState.GRANTED) {
            call.reject("Calendar permission not granted");
            return;
        }

        if (call.getArray("calendars") == null || call.getArray("events") == null) {
            call.reject("sync() requires 'calendars' and 'events'");
            return;
        }

        try {
            CalendarMirrorWriter.Result result = new CalendarMirrorWriter(getContext())
                .sync(call.getArray("calendars"), call.getArray("events"), false);
            call.resolve(JSObject.fromJSONObject(result.toJson()));
        } catch (Exception e) {
            call.reject("Calendar mirror sync failed: " + e.getMessage(), e);
        }
    }

    /** Removes every calendar (and thus every event) the mirror created. */
    @PluginMethod
    public void clear(PluginCall call) {
        if (getPermissionState(CALENDAR_PERMISSION) != PermissionState.GRANTED) {
            // Nothing we could have written without the permission, so this is
            // a success, not an error — it keeps "turn the setting off" simple
            // on the JS side.
            call.resolve();
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("removed", new CalendarMirrorWriter(getContext()).clear());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Calendar mirror clear failed: " + e.getMessage(), e);
        }
    }

    // ---------------------------------------------------------------- background

    /**
     * Starts the periodic background refresh. Without it the mirror only ever
     * holds what Calino knew the last time it was open, so an event created on
     * another device never alarms — see {@link HeadlessSyncWorker}.
     */
    @PluginMethod
    public void scheduleBackgroundSync(PluginCall call) {
        try {
            Integer requested = call.getInt("intervalMinutes");
            long minutes = requested == null || requested <= 0
                ? HeadlessSyncWorker.DEFAULT_INTERVAL_MINUTES
                : requested;
            HeadlessSyncWorker.schedule(getContext(), minutes);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule background sync: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void cancelBackgroundSync(PluginCall call) {
        try {
            HeadlessSyncWorker.cancel(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not cancel background sync: " + e.getMessage(), e);
        }
    }
}
