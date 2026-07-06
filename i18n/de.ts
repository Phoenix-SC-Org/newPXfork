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
    'Confirm': 'Bestätigen',
    'Cancel': 'Abbrechen',
    'Close': 'Schließen',
    'Minimize': 'Minimieren',
    'Restore: {title}': 'Wiederherstellen: {title}',
    'View details': 'Details anzeigen',
    'Loading Module': 'Modul wird geladen',

    // --- Sidebar-Navigation ---
    'Dashboard': 'Übersicht',
    'Service Requests': 'Serviceanfragen',
    'Dispatch Console': 'Leitstelle',
    'Operations Center': 'Einsatzzentrale',
    'Caution Notes': 'Warnvermerke',
    'Intelligence Hub': 'Aufklärungszentrale',
    'Alliances': 'Allianzen',
    'Duty Roster': 'Dienstplan',
    'Org Chart': 'Organigramm',
    'Leaderboard': 'Bestenliste',
    'HR Hub': 'Personalzentrale',
    'Fleet Manager': 'Flottenverwaltung',
    'Government': 'Regierung',
    'Finances': 'Finanzen',
    'Quartermaster': 'Quartiermeister',
    'Warehouse': 'Lager',
    'Marketplace': 'Marktplatz',
    'Org Wiki': 'Org-Wiki',
    'External Tools': 'Externe Tools',
    'Radio Control': 'Funkverwaltung',
    'Help & Docs': 'Hilfe & Doku',

    // --- Sidebar-Gruppen & Footer ---
    'Command & Ops': 'Führung & Einsatz',
    'Org Management': 'Org-Verwaltung',
    'Economy': 'Wirtschaft',
    'Resources': 'Ressourcen',
    'System': 'System',
    'Expand Sidebar': 'Seitenleiste ausklappen',
    'Collapse Sidebar': 'Seitenleiste einklappen',
    'ISSUE EAM': 'EAM AUSLÖSEN',
    'Status Control': 'Statuskontrolle',
    'Go On Duty': 'In den Dienst gehen',
    'Go Off Duty': 'Außer Dienst gehen',
    'ON DUTY': 'IM DIENST',
    'OFF DUTY': 'AUSSER DIENST',
    'UPDATING...': 'AKTUALISIERE...',
    'Idle Timeout: {mins}m': 'Inaktivitäts-Timeout: {mins} min',
    'Install App': 'App installieren',

    // --- Benachrichtigungen / Alerts ---
    'Notifications': 'Benachrichtigungen',
    'Alerts': 'Meldungen',
    'Attention Required': 'Handlungsbedarf',
    'All clear': 'Alles erledigt',
    '{count} item': '{count} Eintrag',
    '{count} items': '{count} Einträge',
    '{count} critical': '{count} kritisch',
    'Nothing requires your attention.': 'Nichts erfordert deine Aufmerksamkeit.',

    // --- Announcements (Notice) ---
    // Enum-Werte bleiben englisch im Datenmodell; hier nur die ANZEIGE.
    'Information': { announcement: 'Information' },
    'Warning': { announcement: 'Warnung' },
    'Danger': { announcement: 'Gefahr' },
    'EXPIRED': 'ABGELAUFEN',
    'EXPIRES IN {time}': 'LÄUFT AB IN {time}',

    // --- Push-Banner / Wartung ---
    'Secure Comms Available': 'Sicherer Kommunikationskanal verfügbar',
    'Enable push notifications to receive mission alerts while off-duty.': 'Aktiviere Push-Benachrichtigungen, um Einsatzmeldungen auch außer Dienst zu erhalten.',
    'Enable Uplink': 'Uplink aktivieren',
    'Maintenance Mode': 'Wartungsmodus',
    'The dashboard is currently undergoing scheduled maintenance. Please check back shortly.': 'Das Dashboard wird derzeit planmäßig gewartet. Bitte schau in Kürze wieder vorbei.',
    'System Offline': 'System offline',
    'Admin Access': 'Admin-Zugang',
};
