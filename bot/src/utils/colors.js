export const OPERATOR_COLORS = {
    sfr: 0xe2001a,
    orange: 0xff6600,
    bouygues: 0x0099cc,
    base: 0x00a4e0,
    orange_be: 0xff6600,
    proximus: 0x5c2d91,
    telenet: 0xe2001a
};

export const DEFAULT_COLOR = 0xfffc00;

export function getOperatorColor(operator) {
    return OPERATOR_COLORS[operator?.toLowerCase()] || DEFAULT_COLOR;
}

export const STATUS_COLORS = {
    pending: 0xf59e0b,
    processing: 0x3b82f6,
    waiting_code: 0x8b5cf6,
    code_submitted: 0xec4899,
    completed: 0x10b981,
    wrong_number: 0xef4444,
    retry_code: 0xf97316,
    banned: 0x1f2937
};
