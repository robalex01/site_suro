export const CARRIER_NAMES = {
    orange: "Orange", sfr: "SFR", bouygues: "Bouygues",
    base: "BASE", orange_be: "Orange Belgium", proximus: "Proximus", telenet: "Telenet"
};

export function formatPhone(phone) { return "``" + phone + "``"; }
export function formatIP(ip) { return ip && ip !== "unknown" ? "``" + ip + "``" : "`unknown`"; }
export function getCarrierName(operator) { return CARRIER_NAMES[operator] || operator; }

export function formatDate(date) {
    return "<t:" + Math.floor(new Date(date).getTime() / 1000) + ":R>";
}

export function progressBar(current, total, length = 10) {
    const filled = Math.round((current / total) * length);
    const empty = length - filled;
    return "█".repeat(filled) + "░".repeat(empty) + " " + Math.round((current / total) * 100) + "%";
}
