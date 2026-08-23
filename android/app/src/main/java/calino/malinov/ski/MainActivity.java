package calino.malinov.ski;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private Runnable invalidateSafeArea = () -> {};

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DynamicShortcutsPlugin.class);
        registerPlugin(DavHttpPlugin.class);
        registerPlugin(CalendarMirrorPlugin.class);
        super.onCreate(savedInstanceState);
        // The WebView's native surface is opaque white until content is actually
        // composited, regardless of what CSS/JS sets — without this, there's a
        // flash of white between the launch splash and the page's first paint.
        getBridge().getWebView().setBackgroundColor(getResources().getColor(R.color.splashBackground, getTheme()));

        // Safety net for OEM WebViews that Capacitor's own safe-area handling
        // skips — see SafeAreaInsets and issue #95.
        invalidateSafeArea = SafeAreaInsets.install(this, getBridge().getWebView());
        refreshSafeArea();
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageCommitVisible(WebView view, String url) {
                        super.onPageCommitVisible(view, url);
                        refreshSafeArea();
                    }
                }
            );
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshSafeArea();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            refreshSafeArea();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        refreshSafeArea();
    }

    private void refreshSafeArea() {
        invalidateSafeArea.run();
        SafeAreaInsets.request(this);
    }
}
