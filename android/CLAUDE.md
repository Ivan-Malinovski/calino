# Android (Capacitor) wrapper

This directory is a generated Capacitor Gradle project — a thin native shell that loads
the same web app built from `../src`. There is **one codebase**, not two: editing
`src/` changes both the web app and the Android app. See root `capacitor.config.ts`
for the Capacitor config (`appId: calino.malinov.ski`, `webDir: 'dist'`).

Native code only needs to be touched for things the web platform genuinely cannot do
(OS notifications, home-screen shortcuts, status bar, haptics, hardware back button).
Everything else is plain React work in `src/`.

## Local build environment (this machine — Bazzite, not portable, not committed)

- Dedicated Distrobox container **`android-sdk`** (Fedora 41), isolated from the host
  image and from the user's other `dev` distrobox.
- Inside: JDK 17 + JDK 21 (Gradle/AGP needs 21 — fails with "invalid source release: 21"
  on JDK 17 alone), Android SDK cmdline-tools, `platform-tools`,
  `build-tools;36.0.0`/`35.0.0`, `platforms;android-36` (matches
  `android/variables.gradle`'s `compileSdkVersion 36`).
- `ANDROID_HOME`/`PATH` set in the container's `~/.bashrc`.
- Project directory is visible inside the container via Distrobox's shared home mount.
- `adb` is exported to the **host** via `distrobox-export --bin` (`~/.local/bin/adb`) —
  run `adb` directly from the host shell, no need to enter the container for it.

## Build / install workflow

1. On host: `pnpm build && npx cap sync android` — copies the fresh web bundle and any
   plugin config into the native project.
2. Build APK inside the container:
   `distrobox enter android-sdk -- bash -c 'cd /var/home/ivan/dev/calino/android && ./gradlew assembleDebug'`
   (or `installDebug` to build + push to a connected device in one step).
3. Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Install: `adb -s <device-id> install -r <apk-path>` (device-id needed if the same
   phone shows up twice in `adb devices` — see below).

For fast iteration without a rebuild/reinstall cycle each time, point
`capacitor.config.ts`'s `server.url` at a running `pnpm dev` server (LAN IP) — the
installed APK then behaves like a browser tab pointed at that URL and hot-reloads.
Revert before committing/shipping — the app should load the bundled `dist/` in normal use.

## Phone connection: wireless ADB (no cable)

Uses Android's **Wireless debugging** (Developer options), paired once then reconnected:

1. Phone: Developer options → Wireless debugging → "Pair device with pairing code" →
   shows a pairing IP:port + 6-digit code.
2. `adb pair <pairing-ip:port> <code>`
3. The main Wireless debugging screen shows a **different** IP:port for regular
   connections — `adb connect <connect-ip:port>`.
4. The same device often shows up twice in `adb devices` (direct IP:port, and mDNS as
   `adb-<guid>._adb-tls-connect._tcp`) — use `adb -s <ip:port>` to disambiguate.
5. The connect IP:port changes if the wireless debugging session resets or the phone's
   IP changes — re-pair if `adb connect` stalls or fails.

## Debugging

- `chrome://inspect` remote DevTools has been unreliable (reported empty Console/Network
  on this device). Prefer `adb logcat`: Capacitor forwards all WebView `console.*` calls
  to logcat tagged `Capacitor/Console`:
  ```
  adb logcat -v time "Capacitor:V" "Capacitor/Console:V" "chromium:V" "*:S"
  ```

## Release builds

- Signing key: `android/keystore/calino-release.jks` (PKCS12, self-signed, 10000-day
  validity), password + alias in `android/keystore.properties` — both gitignored, never
  commit them. `android/app/build.gradle` reads `keystore.properties` if present and
  signs the `release` build type with it; without the file, `assembleRelease` produces
  an **unsigned** APK.
- `versionCode`/`versionName` are derived from the root `package.json` `version` field
  at Gradle configure time (`versionCode = major*1000000 + minor*1000 + patch`) — bump
  the version there (e.g. via `scripts/release.sh`), don't hand-edit `build.gradle`.
- Local signed build: `distrobox enter android-sdk -- bash -c 'cd /var/home/ivan/dev/calino/android && ./gradlew assembleRelease'`
  → `android/app/build/outputs/apk/release/app-release.apk`.
- **CI**: `.github/workflows/android.yml` builds and signs the release APK and attaches
  it to the GitHub Release on every `vX.Y.Z` tag push (same trigger `docker.yml` uses,
  and the same tag `scripts/release.sh` creates the release from). The keystore and its
  passwords live as repo secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) — `ANDROID_KEYSTORE_BASE64` is
  `base64 -w0 android/keystore/calino-release.jks`. Losing the keystore means all future
  releases sign with a different key and can't upgrade-in-place over past installs, so
  back it up somewhere durable outside this repo (password manager, etc.).
- Distributed via GitHub Releases only for now (no Play Store yet).

## Known OS-level gotchas (not code bugs)

- **OEM battery optimization** (MIUI, Oppo/Realme/Honor, etc.) can silently kill
  background alarms/notifications even when correctly scheduled via AlarmManager. Fix is
  a phone-side setting (set the app's battery/power mode to "No restrictions"), not code.
- A fresh install/reinstall resets Android's OS-level permission grants (e.g.
  `POST_NOTIFICATIONS`) independent of the app's own persisted settings — always check
  real permission state before relying on it, don't just trust an app setting.
- AlarmManager does not guarantee sub-minute precision; a 10-20s delay on a scheduled
  notification is normal, not a bug.
