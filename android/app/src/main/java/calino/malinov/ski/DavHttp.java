package calino.malinov.ski;

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
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The actual WebDAV-capable HTTP client, kept free of Capacitor types.
 *
 * <p>{@link DavHttpPlugin} exposes this over the Capacitor bridge for the
 * foreground app, and {@link HeadlessSyncWorker} calls it directly from its
 * JavaScript interface — background sync has no bridge to go through (see the
 * class comment there). Both paths must behave identically, which is why the
 * logic lives here rather than in either caller.
 */
final class DavHttp {

    private static final int TIMEOUT_SECONDS = 30;

    // Redirects are followed natively: .well-known discovery depends on
    // landing on the redirect target, and unlike the webview we can read the
    // final URL back off the response.
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    private DavHttp() {}

    /**
     * Performs one request.
     *
     * @param options {@code url}, {@code method}, {@code headers}, {@code body}
     * @return {@code status}, {@code statusText}, {@code url} (post-redirect),
     *     {@code headers}, {@code body}
     * @throws IllegalArgumentException for a malformed URL or unusable method,
     *     which callers surface as a rejected call rather than a network error
     * @throws IOException for a network-level failure, matching what
     *     {@code fetch()} reports for the same thing
     */
    static JSONObject request(JSONObject options) throws JSONException, IOException {
        String url = options.optString("url", "");
        if (url.isEmpty()) throw new IllegalArgumentException("url is required");

        String method = options.optString("method", "GET");
        Request.Builder builder = new Request.Builder().url(url);

        JSONObject headers = options.optJSONObject("headers");
        String contentType = null;
        if (headers != null) {
            for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
                String key = keys.next();
                String value = headers.optString(key, null);
                if (value == null) continue;
                builder.header(key, value);
                if ("content-type".equalsIgnoreCase(key)) {
                    contentType = value;
                }
            }
        }

        String body = options.isNull("body") ? null : options.optString("body", null);
        RequestBody requestBody = null;
        if (body != null) {
            MediaType mediaType = contentType != null ? MediaType.parse(contentType) : null;
            requestBody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), mediaType);
        } else if (requiresBody(method)) {
            // OkHttp rejects a null body on POST/PUT/etc; an empty one is the
            // faithful equivalent of fetch() with no body.
            requestBody = RequestBody.create(new byte[0], null);
        }

        builder.method(method.toUpperCase(), requestBody);

        try (Response response = CLIENT.newCall(builder.build()).execute()) {
            JSONObject responseHeaders = new JSONObject();
            Headers rawHeaders = response.headers();
            for (int i = 0; i < rawHeaders.size(); i++) {
                // Lowercase to match the webview's Headers semantics. Repeated
                // headers collapse to the last value; DAV responses don't rely
                // on multi-value headers.
                responseHeaders.put(rawHeaders.name(i).toLowerCase(), rawHeaders.value(i));
            }

            ResponseBody responseBody = response.body();
            String text = responseBody != null ? responseBody.string() : "";

            JSONObject result = new JSONObject();
            result.put("status", response.code());
            result.put("statusText", response.message());
            // The post-redirect URL — discovery compares this against the
            // requested one to detect a .well-known bounce.
            result.put("url", response.request().url().toString());
            result.put("headers", responseHeaders);
            result.put("body", text);
            return result;
        }
    }

    private static boolean requiresBody(String method) {
        String m = method.toUpperCase();
        return m.equals("POST") || m.equals("PUT") || m.equals("PATCH") || m.equals("PROPPATCH");
    }
}
