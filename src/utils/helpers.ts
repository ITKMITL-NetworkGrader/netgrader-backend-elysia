export const getDateWithTimezone = (offsetHours: number) => {
    // DSEC-19: Clamp offset to valid UTC range [-12, +14]
    const clampedOffset = Math.max(-12, Math.min(14, offsetHours));
    const now = new Date();
    now.setUTCHours(now.getUTCHours() + clampedOffset);
    return now;
};
