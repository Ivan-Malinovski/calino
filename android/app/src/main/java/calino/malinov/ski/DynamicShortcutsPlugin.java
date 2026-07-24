package calino.malinov.ski;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;

/**
 * Shows or hides the "Photo import" home-screen shortcut as a dynamic
 * shortcut, rather than a static one declared in shortcuts.xml, so it only
 * appears once AI photo import is actually configured (an API key is set) —
 * see aiVisionSettingsStore.ts, which calls setAiPhotoImportEnabled()
 * whenever the key is set or cleared, and App.tsx, which syncs it on launch.
 */
@CapacitorPlugin(name = "DynamicShortcuts")
public class DynamicShortcutsPlugin extends Plugin {
    private static final String SHORTCUT_ID = "ai-photo-import";

    @PluginMethod
    public void setAiPhotoImportEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Context context = getContext();

        if (enabled) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("calino.malinov.ski://ai-photo-import"));
            intent.setClass(context, MainActivity.class);

            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, SHORTCUT_ID)
                .setShortLabel(context.getString(R.string.shortcut_ai_photo_short))
                .setLongLabel(context.getString(R.string.shortcut_ai_photo_long))
                .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_ai_photo))
                .setIntent(intent)
                .build();

            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);
        } else {
            ShortcutManagerCompat.removeDynamicShortcuts(context, Collections.singletonList(SHORTCUT_ID));
        }

        call.resolve();
    }
}
