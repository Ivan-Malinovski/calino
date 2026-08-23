package calino.malinov.ski;

import android.app.Activity;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.Locale;

/**
 * Writes the real window insets into the `--safe-area-inset-*` CSS variables.
 *
 * Capacitor's built-in SystemBars plugin already does this, but only down a
 * code path gated on `WebViewCompat.getCurrentWebViewPackage()` returning a
 * numeric major version >= 140. On OEM-forked Android that ships its own
 * WebView build (issue #95: Huawei/EMUI) that lookup can return null or a
 * version string whose first segment doesn't parse, and the variables are then
 * never set at all — so `--safe-area-top` resolves to its 0px fallback and the
 * header renders underneath the status bar.
 *
 * This listener asks the OS the one question that every Android build answers
 * correctly ("how much of my window is covered by system UI?") and publishes
 * the answer, with no version sniffing in between.
 *
 * It is deliberately additive: it attaches to the activity's content view,
 * which is the *parent* of the CoordinatorLayout that SystemBars attaches to,
 * and returns the insets unmodified so that SystemBars still receives the real
 * values and keeps doing its own padding and keyboard correction. On devices
 * where SystemBars already works, both write the same numbers.
 */
final class SafeAreaInsets {

    private SafeAreaInsets() {}

    /**
     * @return a callback that forgets the last written values, so the next
     *     inset dispatch re-injects them. Call it after a navigation: the
     *     variables live in an inline style on `<html>`, which the new
     *     document doesn't inherit.
     */
    static Runnable install(Activity activity, WebView webView) {
        View content = activity.findViewById(android.R.id.content);
        if (content == null || webView == null) {
            return () -> {};
        }

        // Remembered so a burst of inset dispatches doesn't turn into a burst
        // of evaluateJavascript calls.
        final int[] last = { -1, -1, -1, -1 };

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets statusBars = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets navigationBars = insets.getInsets(
                WindowInsetsCompat.Type.navigationBars() | WindowInsetsCompat.Type.displayCutout()
            );

            // The keyboard is handled natively (Keyboard.resize = Native
            // resizes the WebView window itself), so the gesture-bar inset is
            // already gone from the visible viewport while the IME is up.
            // Reporting it again would double-pad the bottom.
            int bottom = insets.isVisible(WindowInsetsCompat.Type.ime()) ? 0 : navigationBars.bottom;

            float density = activity.getResources().getDisplayMetrics().density;
            int top = (int) (statusBars.top / density);
            int right = (int) (Math.max(statusBars.right, navigationBars.right) / density);
            int bottomDp = (int) (bottom / density);
            int left = (int) (Math.max(statusBars.left, navigationBars.left) / density);

            if (top != last[0] || right != last[1] || bottomDp != last[2] || left != last[3]) {
                last[0] = top;
                last[1] = right;
                last[2] = bottomDp;
                last[3] = left;
                webView.evaluateJavascript(script(top, right, bottomDp, left), null);
            }

            // Untouched — SystemBars listens further down the hierarchy and
            // still needs to see the real insets.
            return insets;
        });

        // Request immediately as well as from MainActivity lifecycle hooks.
        // Some OEMs dispatch the first insets before the WebView has attached,
        // leaving the listener with no later callback until the window changes.
        ViewCompat.requestApplyInsets(content);

        return () -> {
            last[0] = -1;
            last[1] = -1;
            last[2] = -1;
            last[3] = -1;
        };
    }

    static void request(Activity activity) {
        View content = activity.findViewById(android.R.id.content);
        if (content != null) {
            ViewCompat.requestApplyInsets(content);
        }
    }

    private static String script(int top, int right, int bottom, int left) {
        return String.format(
            Locale.US,
            "try {" +
            "  var s = document.documentElement.style;" +
            "  s.setProperty('--safe-area-inset-top', '%dpx');" +
            "  s.setProperty('--safe-area-inset-right', '%dpx');" +
            "  s.setProperty('--safe-area-inset-bottom', '%dpx');" +
            "  s.setProperty('--safe-area-inset-left', '%dpx');" +
            "} catch (e) { console.error('safe-area injection failed', e); }",
            top,
            right,
            bottom,
            left
        );
    }
}
