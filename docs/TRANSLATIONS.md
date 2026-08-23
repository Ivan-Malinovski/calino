# Translations

Calino's English catalog is the source of truth. The shipped interface
languages are English (`en`), Danish (`da`), and German (`de`); language names
remain written in their own language so they can be found from any locale.

Translation catalogs live under `src/locales/<language>/`, with one JSON file
per namespace. Keep every namespace and key aligned with English. Missing keys
fall back to English at runtime, but catalog parity tests should remain clean.

## Translating a change

When adding or changing user-visible copy:

1. Update the matching English namespace first. Use a stable, descriptive key;
   translation keys are API and should not be renamed just to improve wording.
2. Translate the corresponding key in every shipped locale. If a translation
   must be deferred, leave the English fallback deliberately and mention it in
   the change description.
3. Preserve interpolation placeholders exactly, including names and plural
   suffixes. For example, `{{count}}`, `{{name}}`, `*_one`, and `*_other` must
   remain available in every catalog.
4. Preserve markup placeholders such as `<strong>` and `<link>`. Translate
   their surrounding prose, not the tag names.
5. Keep product names, provider names, URLs, file extensions, protocol names,
   and code-like examples unchanged unless the target language has an
   established localized form.
6. Run the catalog tests and the relevant unit/Playwright tests before opening
   the change.

The English source catalog is not a list of strings to translate mechanically.
Write natural copy for the target language, including correct capitalization,
punctuation, plurals, and accessible labels. Short labels, descriptions,
tooltips, button text, error messages, and `aria-label` values all need review.

## Adding a new language

Adding a language requires wiring it into both TypeScript and the bundled
catalogs. For a language code such as `fr`:

1. Add the code to `Language` in `src/types/index.ts`.
2. Add it to `SUPPORTED_LANGUAGES` and add an endonym to
   `LANGUAGE_OPTIONS` in `src/lib/languages.ts`.
3. Create `src/locales/fr/` with one file for every namespace in `NAMESPACES`:
   `common.json`, `calendar.json`, `settings.json`, `contacts.json`,
   `caldav.json`, `errors.json`, and `commands.json`.
4. Import the seven catalogs and register them in `resources` in
   `src/locales/index.ts`.
5. Import the `common` and `errors` catalogs and register them in
   `src/lib/i18nHeadless.ts`. The Android background-sync entry only loads
   those two namespaces.
6. Add the locale's Android resources under
   `android/app/src/main/res/values-<locale>/strings.xml`, translating the
   shortcut labels while leaving package, URL-scheme, and product identifiers
   unchanged.
7. Add or extend the language-switch Playwright coverage in
   `e2e/language-switch.spec.ts` when the new language has visible behavior
   that is not already covered.
8. Update this document and the changelog if the language is shipped to users.

Keep the directory and namespace names identical to English. Catalogs are
statically bundled so the app continues to work offline and in the Android
WebView; do not introduce a network translation backend.

## Validation

From the repository root, use:

```bash
pnpm exec vitest run src/locales/__tests__/catalogs.test.ts
pnpm typecheck
pnpm lint
pnpm test:run
pnpm exec playwright test e2e/language-switch.spec.ts
pnpm build
```

The catalog test checks that every locale has the same namespaces and keys as
English, that interpolation placeholders match, and that translated values are
not empty. `pnpm check` runs typecheck, lint, all unit tests, and the build in
one command. Playwright is required for user-visible behavior changes.

Natural-language event parsing is currently English-only. Translating the
interface does not translate date, time, recurrence, or task phrases entered
in the command palette.

This limitation is intentional: until a locale has matching chrono/NLP rules,
the UI hides the English-only natural-language affordances in non-English
languages. Do not translate the example phrase and imply that parsing works in
that language.
