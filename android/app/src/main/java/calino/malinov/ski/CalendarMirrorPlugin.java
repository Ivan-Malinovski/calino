package calino.malinov.ski;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.CalendarContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Mirrors Calino's CalDAV events into Android's calendar provider, one-way and
 * read-only, so that the OS owns reminder alarms and so the events are visible
 * to calendar widgets, Wear OS, Android Auto and anything else reading
 * {@link CalendarContract}.
 *
 * <p>The mirror is deliberately <em>not</em> a sync adapter: there is no account
 * authenticator and nothing ever flows back. We write with
 * {@code CALLER_IS_SYNCADAPTER=true} purely because the provider only allows
 * that caller to create calendars and to set the columns we need
 * (ACCOUNT_TYPE, OWNER_ACCOUNT, CALENDAR_ACCESS_LEVEL). The calendars use
 * {@link CalendarContract#ACCOUNT_TYPE_LOCAL}, the documented account type for
 * device-local calendars that no sync adapter owns.
 *
 * <p>Ownership is tracked entirely through {@code _SYNC_ID}: a mirrored calendar
 * carries Calino's calendar id, a mirrored event carries Calino's event id. We
 * only ever read, update or delete rows inside calendars we created under our
 * own account name, so a bug here cannot touch the user's Google or Exchange
 * data.
 *
 * <p>{@code SYNC_DATA1} holds a content hash computed on the JS side (see
 * {@code src/lib/calendarMirror.ts}) so reconcile can skip unchanged events
 * instead of rewriting the whole mirror on every sync — rewriting churns the
 * provider's alarm scheduling for events that did not change.
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

    /** Account name for every calendar we create. Also our ownership marker. */
    private static final String ACCOUNT_NAME = "Calino";

    /**
     * The provider rejects oversized transactions, and a first sync can produce
     * thousands of operations, so batches are chunked. Each event contributes
     * one insert plus one op per reminder, so this stays well under the limit.
     */
    private static final int BATCH_SIZE = 400;

    private static final String[] CALENDAR_PROJECTION = {
        CalendarContract.Calendars._ID,
        CalendarContract.Calendars._SYNC_ID,
        CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
        CalendarContract.Calendars.CALENDAR_COLOR,
    };

    private static final String[] EVENT_PROJECTION = {
        CalendarContract.Events._ID,
        CalendarContract.Events._SYNC_ID,
        CalendarContract.Events.SYNC_DATA1,
        CalendarContract.Events.CALENDAR_ID,
    };

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

        JSArray calendarsInput = call.getArray("calendars");
        JSArray eventsInput = call.getArray("events");
        if (calendarsInput == null || eventsInput == null) {
            call.reject("sync() requires 'calendars' and 'events'");
            return;
        }

        try {
            Map<String, Long> calendarIds = reconcileCalendars(calendarsInput);
            int[] counts = reconcileEvents(eventsInput, calendarIds);

            JSObject result = new JSObject();
            result.put("calendars", calendarIds.size());
            result.put("written", counts[0]);
            result.put("removed", counts[1]);
            call.resolve(result);
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
            int removed = getContext()
                .getContentResolver()
                .delete(syncAdapterUri(CalendarContract.Calendars.CONTENT_URI), ownCalendarSelection(), null);
            JSObject result = new JSObject();
            result.put("removed", removed);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Calendar mirror clear failed: " + e.getMessage(), e);
        }
    }

    // ---------------------------------------------------------------- calendars

    /**
     * Creates, updates and deletes mirrored calendars so they match the input.
     *
     * @return Calino calendar id → provider calendar row id, for the event pass.
     */
    private Map<String, Long> reconcileCalendars(JSArray input) throws Exception {
        Map<String, JSONObject> desired = new HashMap<>();
        for (int i = 0; i < input.length(); i++) {
            JSONObject calendar = input.getJSONObject(i);
            desired.put(calendar.getString("id"), calendar);
        }

        Map<String, Long> resolved = new HashMap<>();
        ContentResolver resolver = getContext().getContentResolver();

        try (Cursor cursor = resolver.query(
            syncAdapterUri(CalendarContract.Calendars.CONTENT_URI),
            CALENDAR_PROJECTION,
            ownCalendarSelection(),
            null,
            null
        )) {
            while (cursor != null && cursor.moveToNext()) {
                long rowId = cursor.getLong(0);
                String syncId = cursor.getString(1);
                JSONObject wanted = syncId == null ? null : desired.get(syncId);

                if (wanted == null) {
                    resolver.delete(
                        ContentUris.withAppendedId(
                            syncAdapterUri(CalendarContract.Calendars.CONTENT_URI),
                            rowId
                        ),
                        null,
                        null
                    );
                    continue;
                }

                // Name and colour are the only mutable fields; rewrite them
                // only when they actually drifted.
                String name = wanted.getString("name");
                int color = parseColor(wanted.optString("color", null));
                if (!name.equals(cursor.getString(2)) || color != cursor.getInt(3)) {
                    ContentValues values = new ContentValues();
                    values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, name);
                    values.put(CalendarContract.Calendars.NAME, name);
                    values.put(CalendarContract.Calendars.CALENDAR_COLOR, color);
                    resolver.update(
                        ContentUris.withAppendedId(
                            syncAdapterUri(CalendarContract.Calendars.CONTENT_URI),
                            rowId
                        ),
                        values,
                        null,
                        null
                    );
                }

                resolved.put(syncId, rowId);
            }
        }

        for (Map.Entry<String, JSONObject> entry : desired.entrySet()) {
            if (resolved.containsKey(entry.getKey())) continue;
            resolved.put(entry.getKey(), insertCalendar(entry.getKey(), entry.getValue()));
        }

        return resolved;
    }

    private long insertCalendar(String calinoId, JSONObject calendar) throws Exception {
        String name = calendar.getString("name");

        ContentValues values = new ContentValues();
        values.put(CalendarContract.Calendars._SYNC_ID, calinoId);
        values.put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT_NAME);
        values.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        values.put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT_NAME);
        values.put(CalendarContract.Calendars.NAME, name);
        values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, name);
        values.put(CalendarContract.Calendars.CALENDAR_COLOR, parseColor(calendar.optString("color", null)));
        // Read-only: Calino stays the single writer, and calendar apps will not
        // offer to edit events they cannot push back to the CalDAV server.
        values.put(
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.CAL_ACCESS_READ
        );
        values.put(CalendarContract.Calendars.VISIBLE, 1);
        values.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        values.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, java.util.TimeZone.getDefault().getID());
        // Without an explicit allow-list some calendar apps refuse to surface
        // our reminder rows at all.
        values.put(
            CalendarContract.Calendars.ALLOWED_REMINDERS,
            String.valueOf(CalendarContract.Reminders.METHOD_ALERT)
        );
        values.put(CalendarContract.Calendars.ALLOWED_AVAILABILITY, "0,1");
        values.put(CalendarContract.Calendars.ALLOWED_ATTENDEE_TYPES, "0,1,2");

        Uri inserted = getContext()
            .getContentResolver()
            .insert(syncAdapterUri(CalendarContract.Calendars.CONTENT_URI), values);
        if (inserted == null) throw new IllegalStateException("Could not create calendar '" + name + "'");
        return ContentUris.parseId(inserted);
    }

    // ---------------------------------------------------------------- events

    /** @return {written, removed} */
    private int[] reconcileEvents(JSArray input, Map<String, Long> calendarIds) throws Exception {
        Map<String, JSONObject> desired = new HashMap<>();
        for (int i = 0; i < input.length(); i++) {
            JSONObject event = input.getJSONObject(i);
            // An event in a calendar we did not mirror has nowhere to go.
            if (calendarIds.containsKey(event.getString("calendarId"))) {
                desired.put(event.getString("id"), event);
            }
        }

        if (calendarIds.isEmpty()) return new int[] { 0, 0 };

        List<ContentProviderOperation> ops = new ArrayList<>();
        Set<String> upToDate = new HashSet<>();
        int removed = 0;

        Uri eventsUri = syncAdapterUri(CalendarContract.Events.CONTENT_URI);
        try (Cursor cursor = getContext().getContentResolver().query(
            eventsUri,
            EVENT_PROJECTION,
            CalendarContract.Events.CALENDAR_ID + " IN (" + joinIds(calendarIds.values()) + ")",
            null,
            null
        )) {
            while (cursor != null && cursor.moveToNext()) {
                long rowId = cursor.getLong(0);
                String syncId = cursor.getString(1);
                String hash = cursor.getString(2);
                long calendarRowId = cursor.getLong(3);

                JSONObject wanted = syncId == null ? null : desired.get(syncId);
                Long wantedCalendar = wanted == null
                    ? null
                    : calendarIds.get(wanted.getString("calendarId"));

                boolean unchanged = wanted != null
                    && wantedCalendar != null
                    && wantedCalendar == calendarRowId
                    && wanted.getString("hash").equals(hash);

                if (unchanged) {
                    upToDate.add(syncId);
                    continue;
                }

                // Changed events are deleted and re-inserted rather than
                // updated: the reminder rows hang off the event id and would
                // otherwise need their own diff for no practical gain.
                ops.add(
                    ContentProviderOperation
                        .newDelete(ContentUris.withAppendedId(eventsUri, rowId))
                        .build()
                );
                if (wanted == null) removed++;
            }
        }

        int written = 0;
        for (Map.Entry<String, JSONObject> entry : desired.entrySet()) {
            if (upToDate.contains(entry.getKey())) continue;
            appendEventInsert(ops, entry.getKey(), entry.getValue(), calendarIds);
            written++;
            if (ops.size() >= BATCH_SIZE) flush(ops);
        }
        flush(ops);

        return new int[] { written, removed };
    }

    private void appendEventInsert(
        List<ContentProviderOperation> ops,
        String calinoId,
        JSONObject event,
        Map<String, Long> calendarIds
    ) throws Exception {
        int eventOpIndex = ops.size();

        ContentProviderOperation.Builder builder = ContentProviderOperation
            .newInsert(syncAdapterUri(CalendarContract.Events.CONTENT_URI))
            .withValue(CalendarContract.Events._SYNC_ID, calinoId)
            .withValue(CalendarContract.Events.SYNC_DATA1, event.getString("hash"))
            .withValue(CalendarContract.Events.DIRTY, 0)
            .withValue(
                CalendarContract.Events.CALENDAR_ID,
                calendarIds.get(event.getString("calendarId"))
            )
            .withValue(CalendarContract.Events.TITLE, event.optString("title", ""))
            .withValue(CalendarContract.Events.DTSTART, event.getLong("start"))
            .withValue(CalendarContract.Events.ALL_DAY, event.optBoolean("allDay", false) ? 1 : 0)
            .withValue(CalendarContract.Events.EVENT_TIMEZONE, event.getString("timezone"))
            .withValue(
                CalendarContract.Events.ACCESS_LEVEL,
                CalendarContract.Events.ACCESS_DEFAULT
            );

        String description = event.optString("description", null);
        if (description != null && !description.isEmpty()) {
            builder.withValue(CalendarContract.Events.DESCRIPTION, description);
        }
        String location = event.optString("location", null);
        if (location != null && !location.isEmpty()) {
            builder.withValue(CalendarContract.Events.EVENT_LOCATION, location);
        }

        builder.withValue(
            CalendarContract.Events.AVAILABILITY,
            "transparent".equals(event.optString("transparency", null))
                ? CalendarContract.Events.AVAILABILITY_FREE
                : CalendarContract.Events.AVAILABILITY_BUSY
        );

        String rrule = event.optString("rrule", null);
        if (rrule != null && !rrule.isEmpty()) {
            // The provider requires recurring events to carry DURATION and to
            // leave DTEND null; setting both is rejected.
            builder.withValue(CalendarContract.Events.RRULE, rrule);
            builder.withValue(CalendarContract.Events.DURATION, event.getString("duration"));
            String exdate = event.optString("exdate", null);
            if (exdate != null && !exdate.isEmpty()) {
                builder.withValue(CalendarContract.Events.EXDATE, exdate);
            }
        } else {
            builder.withValue(CalendarContract.Events.DTEND, event.getLong("end"));
        }

        JSONArray reminders = event.optJSONArray("reminders");
        int reminderCount = reminders == null ? 0 : reminders.length();
        builder.withValue(CalendarContract.Events.HAS_ALARM, reminderCount > 0 ? 1 : 0);
        ops.add(builder.build());

        for (int i = 0; i < reminderCount; i++) {
            ops.add(
                ContentProviderOperation
                    .newInsert(syncAdapterUri(CalendarContract.Reminders.CONTENT_URI))
                    // Back-reference: the event row id does not exist until the
                    // batch is applied.
                    .withValueBackReference(CalendarContract.Reminders.EVENT_ID, eventOpIndex)
                    .withValue(CalendarContract.Reminders.MINUTES, reminders.getInt(i))
                    .withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                    .build()
            );
        }
    }

    private void flush(List<ContentProviderOperation> ops) throws Exception {
        if (ops.isEmpty()) return;
        ContentProviderResult[] results = getContext()
            .getContentResolver()
            .applyBatch(CalendarContract.AUTHORITY, new ArrayList<>(ops));
        if (results.length != ops.size()) {
            throw new IllegalStateException(
                "Calendar provider applied " + results.length + " of " + ops.size() + " operations"
            );
        }
        ops.clear();
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Tags a URI as a sync-adapter call. Required to create calendars, to set
     * the sync columns we key ownership off, and so deletes actually remove
     * rows instead of tombstoning them as {@code DELETED=1}.
     */
    private static Uri syncAdapterUri(Uri uri) {
        return uri
            .buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();
    }

    /** Restricts every query and delete to calendars this plugin created. */
    private static String ownCalendarSelection() {
        return CalendarContract.Calendars.ACCOUNT_NAME + " = '" + ACCOUNT_NAME + "' AND "
            + CalendarContract.Calendars.ACCOUNT_TYPE + " = '" + CalendarContract.ACCOUNT_TYPE_LOCAL + "'";
    }

    private static String joinIds(Iterable<Long> ids) {
        StringBuilder joined = new StringBuilder();
        for (Long id : ids) {
            if (joined.length() > 0) joined.append(',');
            joined.append(id);
        }
        return joined.toString();
    }

    private static int parseColor(String hex) {
        if (hex == null || hex.isEmpty()) return Color.GRAY;
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return Color.GRAY;
        }
    }
}
