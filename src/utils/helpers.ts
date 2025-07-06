export const getDateWithTimezone = (offsetHours: number) => {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() + offsetHours);
    return now;
};