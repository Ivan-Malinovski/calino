# Android (Capacitor) wrapper

The Android project is a tracked Capacitor/Gradle shell around the web app. It
loads the bundle built from `src/`, so there is one product implementation, not
separate web and Android calendar code. Native Java is used only where Android
provides capabilities the browser cannot: notifications, calendar mirroring,
background sync, shortcuts, status-bar/insets, haptics, and share intents.

The root [`capacitor.config.ts`](../capacitor.config.ts) defines app id
`calino.malinov.ski` and `webDir: 'dist'`. Capacitor-generated files can be
refreshed by `npx cap sync android`; preserve the custom code under
`android/app/src/main/java/calino/malinov/ski/` and the native scripts when
resolving sync changes.

## Prerequisites

For a normal Android build, use JDK 21, Android SDK platform/build tools for
API 36, and the SDK platform tools (`adb`). The Gradle wrapper and Android
Gradle Plugin versions are pinned in this directory, so do not rely on a
system Gradle installation.

On the original development machine these tools are inside a Distrobox named
`android-sdk`; that is a local convenience, not a repository requirement. A
different machine may use a regular JDK/Android SDK installation or its own
container. The repository path is intentionally not assumed below; replace
`<repo>` with the checkout path when using Distrobox.

## Build and install

From the repository root, build the web bundle and sync it into Android:

```bash
pnpm build
npx cap sync android
```

Then build from `android/` with the Gradle wrapper:

```bash
cd android
./gradlew assembleDebug
```

On a machine using the local Distrobox, the equivalent is:

```bash
distrobox enter android-sdk -- bash -lc 'cd <repo>/android && ./gradlew assembleDebug'
```

The debug APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. Install it with an
explicit device when more than one device is listed:

```bash
adb devices
adb -s <device-id> install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm cap:run` / `npx cap run android` is valid when Java, the Android SDK, and
a usable device target are available on the host. On the original machine the
manual workflow above is more reliable because Java is container-only and
wireless ADB mDNS names have caused Capacitor CLI target-parsing failures.

For rapid UI iteration, temporarily set `server.url` in
`capacitor.config.ts` to a reachable `pnpm dev` URL (use
`CALINO_DEV_HOST=0.0.0.0` when LAN access is required). Revert that change
before committing or shipping so the app uses the bundled `dist/` files.

## Debug and release variants

The debug build has `applicationIdSuffix ".debug"` and
`versionNameSuffix "-debug"`, so it installs beside the release app as
`calino.malinov.ski.debug` / “Calino Debug”. The separate application id also
separates WebView localStorage, settings, and credentials.

Debug launcher resources live under `android/app/src/debug/res/` and are
intentionally distinguishable from release resources. If the release icon
changes, regenerate the debug icon variants with:

```bash
android/scripts/gen-debug-icons.sh
```

That script requires ImageMagick and only writes debug resources.

The release version name and version code come from the root `package.json`
version at Gradle configuration time. Do not hand-edit `android/app/build.gradle`
for a version bump. The code is derived as
`major * 1_000_000 + minor * 1_000 + patch`; prerelease suffixes do not affect
the numeric code.

## Signing and releases

`assembleRelease` is signed only when the gitignored
`android/keystore.properties` points to the release keystore. Without that
file it produces an unsigned APK. Never commit the keystore or its passwords.

For a local signed build:

```bash
cd android
./gradlew assembleRelease
```

The output is
`android/app/build/outputs/apk/release/app-release.apk`.

The `v*` tag workflow in
[`.github/workflows/android.yml`](../.github/workflows/android.yml)
builds the web app, syncs Capacitor, signs the release with repository secrets,
and attaches the APK to the GitHub Release. APKs are currently distributed
through GitHub Releases, not Google Play. Back up the release keystore outside
the repository; losing it prevents future APKs from upgrading existing
release installs.

Because debug and release now use different application ids, they can coexist.
An old pre-split debug APK may still use the plain
`calino.malinov.ski` id; uninstall that legacy package before installing a
release APK if Android reports a signature/package conflict:

```bash
adb -s <device-id> uninstall calino.malinov.ski
```

## Wireless ADB

With Android Developer options → Wireless debugging enabled:

```bash
adb pair <pairing-ip:port> <six-digit-code>
adb connect <connect-ip:port>
adb devices
```

The pairing endpoint and regular connection endpoint are different. If the
same phone appears more than once, use its direct `ip:port` device id with
`adb -s`. The address can change when wireless debugging or the phone's
network resets.

## Debugging

`chrome://inspect` may be useful for WebView inspection, but if it does not
show reliable console/network output, use logcat:

```bash
adb -s <device-id> logcat -v time "Capacitor:V" "Capacitor/Console:V" "chromium:V" "*:S"
```

## Calendar mirror and background sync

The optional `enableCalendarMirror` setting exports Calino events one way into
Android `CalendarContract`. It does not sync Android calendar edits back into
Calino and does not touch the user's Google/Exchange rows. The mirror is
implemented by `CalendarMirrorPlugin` and `CalendarMirrorWriter`; the
`_SYNC_ID` and account-name scoping are its ownership boundary.

The mirror exists mainly to let an installed calendar app raise reliable OS
reminders. If no calendar app is available, Calino keeps its own local
notification scheduling instead. VTODO and VJOURNAL items remain in Calino
because `CalendarContract` is an event/reminder provider, not their source of
truth. Detached recurrence instances are flattened for the read-only mirror.

`HeadlessSyncWorker` is a WorkManager job, normally hourly with network
required, that refreshes the mirror while the app is closed. It runs the same
TypeScript CalDAV/iCalendar engine in the second Vite entry
`headless.html`, inside a bare WebView at `https://localhost` so it shares the
foreground app's localStorage. It writes the Android provider, not the app's
foreground Zustand/localStorage state. Its reconcile is partial: it only
authoritatively refreshes calendars it fetched and refuses to replace data
with an empty result when nothing was fetched.

When changing this path, keep these invariants intact:

- the headless page must remain at `https://localhost`;
- the headless page must not write localStorage;
- the native bridge must remain limited to the DAV HTTP and provider operations
  it actually needs;
- mirror ownership must stay scoped to Calino's account name and sync ids.

## Common device-side gotchas

- A mirrored calendar can exist in `CalendarContract` while being hidden by the
  calendar app's own display list. Check the provider before diagnosing a
  sync failure:

  ```bash
  adb shell "content query --uri content://com.android.calendar/calendars --projection _id:name:visible:sync_events"
  ```

- WorkManager periodic work has a system-enforced minimum interval and is not a
  precise alarm. A forced job can still be delayed by the OS.
- OEM battery optimization (notably MIUI, Oppo/Realme, Honor, and similar
  devices) can suspend background work and notifications. Set Calino to “No
  restrictions” when testing those paths.
- Reinstalling resets Android permission grants independently of Calino's
  stored settings. Check the actual notification/calendar permission state.
- AlarmManager notifications are not guaranteed to fire at the exact second;
  a small delay is normal.
