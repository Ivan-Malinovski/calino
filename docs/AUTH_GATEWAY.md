# DAV behind an authentication gateway

This only applies if your CalDAV/CardDAV server sits behind an access gateway such as Pangolin or Cloudflare Access. If you connect directly to a normal DAV server, you can ignore this page.

In the account form, add the headers required by your gateway. The self-hosted `/setup` generator has the same fields and encrypts each value in the generated `calino.config.json`.

| Gateway | Header names to configure |
| --- | --- |
| Pangolin | `P-Access-Token-Id`, `P-Access-Token` |
| Cloudflare Access | `CF-Access-Client-Id`, `CF-Access-Client-Secret` |

Configure the gateway to answer cross-origin `OPTIONS` preflight requests from your Calino origin **without requiring the access-token headers**. The browser's preflight contains the header *names*, not their secret values. Its response must include those names in `Access-Control-Allow-Headers`, allow DAV methods such as `PROPFIND` and `REPORT`, and provide the usual CORS origin response. Calino then sends the configured values on the actual DAV requests. If preflight is blocked, browser JavaScript cannot work around it.

Use the final HTTPS DAV URL, including a trailing slash if the server requires one. Custom headers work with direct DAV connections only; remove the optional CORS proxy URL. Requests carrying custom headers stop on redirects, and Calino refuses to send them to a different origin. Values are masked in the UI and stored with account credentials using the app's existing local obfuscation, which is not strong protection against someone with access to the browser storage and app bundle.
