package calino.malinov.ski;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Native HTTP for CalDAV/CardDAV, so DAV sync works against servers that send
 * no CORS headers at all.
 *
 * Neither of the two paths Capacitor already offers can carry a WebDAV
 * request. The webview's own fetch is bound by CORS (origin is
 * https://localhost on device), and CapacitorHttp hands requests to
 * HttpURLConnection, whose setRequestMethod() rejects every verb outside the
 * JDK's fixed list — PROPFIND, REPORT, PROPPATCH, MKCALENDAR, MKCOL, COPY and
 * MOVE all throw ProtocolException. OkHttp has no such whitelist, so this
 * plugin exists purely to be the third path.
 *
 * The JS side is src/lib/webFetch.ts, which adapts the result back into a
 * Response. Bodies are DAV XML and iCalendar text, so they cross the bridge as
 * strings — no streaming or binary support here, deliberately.
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {

    private static final int TIMEOUT_SECONDS = 30;

    // Redirects are followed natively: .well-known discovery depends on
    // landing on the redirect target, and unlike the webview we can read the
    // final URL back off the response.
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String method = call.getString("method", "GET");

        Request.Builder builder;
        try {
            builder = new Request.Builder().url(url);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid URL: " + url, e);
            return;
        }

        JSObject headers = call.getObject("headers", new JSObject());
        String contentType = null;
        for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
            String key = keys.next();
            String value = headers.getString(key);
            if (value == null) continue;
            builder.header(key, value);
            if ("content-type".equalsIgnoreCase(key)) {
                contentType = value;
            }
        }

        String body = call.getString("body");
        RequestBody requestBody = null;
        if (body != null) {
            MediaType mediaType = contentType != null ? MediaType.parse(contentType) : null;
            requestBody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), mediaType);
        } else if (requiresBody(method)) {
            // OkHttp rejects a null body on POST/PUT/etc; an empty one is the
            // faithful equivalent of fetch() with no body.
            requestBody = RequestBody.create(new byte[0], null);
        }

        try {
            builder.method(method.toUpperCase(), requestBody);
        } catch (IllegalArgumentException e) {
            call.reject("Unsupported method: " + method, e);
            return;
        }

        try (Response response = client.newCall(builder.build()).execute()) {
            JSObject responseHeaders = new JSObject();
            Headers rawHeaders = response.headers();
            for (int i = 0; i < rawHeaders.size(); i++) {
                // Lowercase to match the webview's Headers semantics. Repeated
                // headers collapse to the last value; DAV responses don't rely
                // on multi-value headers.
                responseHeaders.put(rawHeaders.name(i).toLowerCase(), rawHeaders.value(i));
            }

            ResponseBody responseBody = response.body();
            String text = responseBody != null ? responseBody.string() : "";

            JSObject result = new JSObject();
            result.put("status", response.code());
            result.put("statusText", response.message());
            // The post-redirect URL — discovery compares this against the
            // requested one to detect a .well-known bounce.
            result.put("url", response.request().url().toString());
            result.put("headers", responseHeaders);
            result.put("body", text);
            call.resolve(result);
        } catch (IOException e) {
            // Network-level failure. webFetch.ts turns this back into a
            // rejected promise, matching how fetch() reports the same thing.
            call.reject(e.getMessage() != null ? e.getMessage() : "Network request failed", e);
        }
    }

    private static boolean requiresBody(String method) {
        String m = method.toUpperCase();
        return m.equals("POST") || m.equals("PUT") || m.equals("PATCH") || m.equals("PROPPATCH");
    }
}
