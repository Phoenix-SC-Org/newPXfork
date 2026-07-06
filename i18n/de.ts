// Deutsches Wörterbuch (natural keys: der Key ist der englische Originaltext).
//
// Regeln:
// - Nur ANZEIGE-Texte übersetzen. Niemals: Service-Actions (auth:*, admin:*,
//   hr:* …), Permission-Keys, Enum-Werte, DB-Namen, localStorage-Keys,
//   CSS-Klassen, Routen/URLs, data-testid, Logmeldungen, SQL, JSON-Keys.
// - Mehrdeutige kurze Begriffe als Kontext-Objekt anlegen:
//     'Order': { marketplace: 'Bestellung', government: 'Anordnung' }
//   Abruf via t('Order', { context: 'marketplace' }). '_' = Default-Kontext.
// - Fehlt ein Eintrag, zeigt die App automatisch Englisch (Fallback).
// - Diese Datei bewusst OHNE Imports halten — scripts/i18n-check.mjs lädt sie
//   direkt per Node-Type-Stripping.

export const de: Record<string, string | Record<string, string>> = {
    // --- Login ---
    'Operations Terminal': 'Einsatz-Terminal',
    'Continue with Discord': 'Mit Discord fortfahren',
    'Try Again': 'Erneut versuchen',
    'Login failed': 'Anmeldung fehlgeschlagen',
    'First time? After Discord auth you’ll link your RSI handle.': 'Zum ersten Mal hier? Nach der Discord-Anmeldung verknüpfst du dein RSI-Handle.',
    'System Online': 'System online',
    'Dismiss': 'Schließen',

    // --- Header / Navigation ---
    'Global Search...': 'Globale Suche...',
    'Open menu': 'Menü öffnen',
    'Close menu': 'Menü schließen',
    'Radio': 'Funk',
    'Unavailable': 'Nicht verfügbar',
    'Toggle Radio': 'Funk ein-/ausblenden',
    'Radio unavailable — LiveKit not configured by your organization admin': 'Funk nicht verfügbar — LiveKit wurde vom Administrator eurer Organisation nicht konfiguriert',
    'Signed in as': 'Angemeldet als',
    'My Account': 'Mein Konto',
    'Admin Console': 'Admin-Konsole',
    'My Service Record': 'Meine Dienstakte',
    'Job Gazette': 'Stellenanzeiger',
    'Audio Volume': 'Lautstärke',
    'Test Audio': 'Audio testen',
    'Disconnect': 'Abmelden',

    // --- Allgemein ---
    'Switch language': 'Sprache wechseln',
};
