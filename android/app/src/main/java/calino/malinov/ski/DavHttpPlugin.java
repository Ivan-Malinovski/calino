package calino.malinov.ski;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import org.json.JSONObject;

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
 * The request itself lives in {@link DavHttp}, shared with the background sync
 * worker; this class is only the bridge exposure. The JS side is
 * src/lib/webFetch.ts, which adapts the result back into a Response. Bodies are
 * DAV XML and iCalendar text, so they cross the bridge as strings — no
 * streaming or binary support here, deliberately.
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        try {
            JSONObject result = DavHttp.request(call.getData());
            call.resolve(JSObject.fromJSONObject(result));
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage(), e);
        } catch (IOException e) {
            // Network-level failure. webFetch.ts turns this back into a
            // rejected promise, matching how fetch() reports the same thing.
            call.reject(e.getMessage() != null ? e.getMessage() : "Network request failed", e);
        } catch (Exception e) {
            call.reject("DAV request failed: " + e.getMessage(), e);
        }
    }
}
