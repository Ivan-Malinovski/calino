package ski.malinov.calino;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView's native surface is opaque white until content is actually
        // composited, regardless of what CSS/JS sets — without this, there's a
        // flash of white between the launch splash and the page's first paint.
        getBridge().getWebView().setBackgroundColor(getResources().getColor(R.color.splashBackground, getTheme()));
    }
}
