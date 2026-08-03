package calino.malinov.ski;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/**
 * Periodic background CalDAV refresh, so the mirror holds events Calino has
 * never seen in the foreground.
 *
 * <p>Without this the mirror only ever contains what the app knew last time it
 * was open: the OS reliably alarms whatever is in {@link android.provider.CalendarContract},
 * but an event someone added on another device never gets there. This worker
 * closes that gap.
 *
 * <h3>Why a WebView</h3>
 *
 * Calino's CalDAV engine is TypeScript in {@code src/}, and there is deliberately
 * one codebase for web and Android — reimplementing CalDAV and iCalendar parsing
 * in Java would mean two engines to keep in step. So the worker runs the real
 * engine instead, in a bare WebView.
 *
 * <p>It cannot use Capacitor to do that: {@code Bridge} requires an
 * {@code AppCompatActivity} (see its constructor), a worker has none, and
 * Android 10+ forbids starting an activity from the background. So the page is
 * served and driven by hand here, and the two native capabilities the sync
 * needs — DAV HTTP and the provider write — are exposed as a plain
 * {@code @JavascriptInterface} instead of Capacitor plugins. {@code src/headless.ts}
 * is the other half; {@code src/lib/webFetch.ts} routes through this bridge when
 * it is present.
 *
 * <p>The page is served at {@code https://localhost}, byte for byte the origin
 * Capacitor uses, which is the entire reason this works: same origin means the
 * same {@code localStorage}, so the worker reads the accounts, credentials and
 * calendar visibility the app already stored, with no separate copy to keep in
 * sync.
 *
 * <h3>What it must not do</h3>
 *
 * The headless page is <em>read-only</em> with respect to app state. It never
 * writes {@code localStorage}. If it did, it would race the foreground app,
 * whose zustand store holds its own in-memory copy and rehydrates only at
 * startup — a background write would either be clobbered on the next foreground
 * save or clobber a change the user just made. Instead the worker fetches and
 * writes only the provider, and the app re-mirrors from its own state when it
 * next opens. The two converge because the mirror is derived state, reconciled
 * by content hash.
 *
 * <p>Its reconcile is also {@code partial} (see {@link CalendarMirrorWriter}):
 * it refreshes only the CalDAV calendars it actually fetched, and leaves rows
 * from webcal subscriptions — which it does not sync — alone rather than
 * deleting them as absent.
 */
public class HeadlessSyncWorker extends Worker {

    private static final String TAG = "CalinoHeadlessSync";
    private static final String WORK_NAME = "calino-background-sync";

    /**
     * WorkManager's floor is 15 minutes and it batches work across the system
     * anyway, so this is a hint rather than a schedule. Hourly keeps the mirror
     * fresh enough for reminders without waking the radio all day.
     */
    static final long DEFAULT_INTERVAL_MINUTES = 60;

    /**
     * Budget for the whole pass. WorkManager allows ten minutes before it kills
     * the worker; stopping short of that lets us tear the WebView down cleanly
     * and log a timeout instead of dying mid-write.
     */
    private static final long TIMEOUT_MINUTES = 5;

    /** Origin Capacitor serves the app from — must match for shared storage. */
    private static final String ORIGIN = "https://localhost";
    private static final String ENTRY_URL = ORIGIN + "/headless.html";
    /** Where `npx cap sync` puts the built web bundle inside assets. */
    private static final String ASSET_ROOT = "public";

    public HeadlessSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---------------------------------------------------------------- scheduling

    static void schedule(Context context, long intervalMinutes) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            HeadlessSyncWorker.class,
            Math.max(intervalMinutes, PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS / 60000),
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .build();

        // UPDATE rather than KEEP so a changed interval takes effect without
        // losing the existing schedule's elapsed time.
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    // ---------------------------------------------------------------- the pass

    @NonNull
    @Override
    public Result doWork() {
        Log.i(TAG, "Background sync starting");
        if (!hasCalendarPermission(getApplicationContext())) {
            // The user revoked it since the setting was turned on. Nothing to
            // write, and nothing we can do about it from the background.
            Log.i(TAG, "Calendar permission not granted; skipping background sync");
            return Result.success();
        }

        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> failure = new AtomicReference<>(null);
        AtomicReference<WebView> webViewRef = new AtomicReference<>(null);
        Handler main = new Handler(Looper.getMainLooper());

        // A WebView must be created and destroyed on the main thread, but
        // doWork() runs off it — hence the hop out and the latch back.
        main.post(() -> {
            try {
                webViewRef.set(createWebView(done, failure));
                webViewRef.get().loadUrl(ENTRY_URL);
            } catch (Throwable t) {
                failure.set("Could not start headless WebView: " + t.getMessage());
                done.countDown();
            }
        });

        boolean finished;
        try {
            finished = done.await(TIMEOUT_MINUTES, TimeUnit.MINUTES);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            finished = false;
        }

        main.post(() -> {
            WebView webView = webViewRef.getAndSet(null);
            if (webView != null) {
                webView.loadUrl("about:blank");
                webView.destroy();
            }
        });

        if (!finished) {
            Log.w(TAG, "Background sync timed out after " + TIMEOUT_MINUTES + " minutes");
            return Result.retry();
        }
        String error = failure.get();
        if (error != null) {
            Log.w(TAG, "Background sync failed: " + error);
            // Almost always a transient network or server problem; the next
            // period would retry anyway, but backing off gets there sooner.
            return Result.retry();
        }
        return Result.success();
    }

    static boolean hasCalendarPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR)
            == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private WebView createWebView(CountDownLatch done, AtomicReference<String> failure) {
        WebView webView = new WebView(getApplicationContext());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // localStorage is where the accounts, credentials and calendar
        // visibility live — the whole point of matching Capacitor's origin.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request);
            }
        });

        webView.addJavascriptInterface(new Bridge(done, failure), "CalinoHeadless");
        return webView;
    }

    /**
     * Serves the bundled web build for {@code https://localhost/...}. This is
     * what gives the page Capacitor's origin without Capacitor.
     *
     * <p>Anything off that origin is refused rather than passed through: all
     * the traffic this page legitimately makes goes over the JS bridge, so a
     * request reaching the network here would mean the page loaded something it
     * should not have.
     */
    private WebResourceResponse serveAsset(WebResourceRequest request) {
        if (!ORIGIN.equals(
            request.getUrl().getScheme() + "://" + request.getUrl().getAuthority()
        )) {
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, null);
        }

        String path = request.getUrl().getPath();
        if (path == null || path.equals("/")) path = "/headless.html";

        try {
            InputStream stream = getApplicationContext().getAssets().open(ASSET_ROOT + path);
            String mimeType = URLConnection.guessContentTypeFromName(path);
            if (mimeType == null) mimeType = "application/octet-stream";
            // guessContentTypeFromName has no idea about ES modules, and a
            // WebView refuses to execute a script served as anything else.
            if (path.endsWith(".js") || path.endsWith(".mjs")) mimeType = "text/javascript";
            if (path.endsWith(".css")) mimeType = "text/css";
            return new WebResourceResponse(mimeType, "UTF-8", stream);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
        }
    }

    // ---------------------------------------------------------------- JS bridge

    /**
     * The two native capabilities the headless sync needs, plus a way to say it
     * is done. Methods are invoked on the WebView's JavaScript thread, not the
     * main thread, so blocking here is safe and keeps the JS side simple —
     * {@code davRequest} is a synchronous call returning the response as JSON.
     */
    private final class Bridge {
        private final CountDownLatch done;
        private final AtomicReference<String> failure;

        Bridge(CountDownLatch done, AtomicReference<String> failure) {
            this.done = done;
            this.failure = failure;
        }

        @JavascriptInterface
        public String davRequest(String optionsJson) {
            JSONObject result = new JSONObject();
            try {
                result.put("ok", true);
                result.put("response", DavHttp.request(new JSONObject(optionsJson)));
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"error\":\"request failed\"}";
                }
            }
            return result.toString();
        }

        @JavascriptInterface
        public String mirrorSync(String payloadJson) {
            try {
                JSONObject payload = new JSONObject(payloadJson);
                CalendarMirrorWriter.Result result = new CalendarMirrorWriter(getApplicationContext())
                    .sync(
                        payload.getJSONArray("calendars"),
                        payload.getJSONArray("events"),
                        // Authoritative only for the calendars it fetched.
                        true
                    );
                return result.toJson().toString();
            } catch (Exception e) {
                Log.w(TAG, "Mirror write failed", e);
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }

        @JavascriptInterface
        public void log(String message) {
            Log.i(TAG, message);
        }

        @JavascriptInterface
        public void finish(String error) {
            if (error != null && !error.isEmpty()) failure.set(error);
            done.countDown();
        }
    }
}
