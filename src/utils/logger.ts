/**
 * Logger utility with automatic timestamps
 * Provides log, warn, error methods that prepend ISO timestamps
 */

const formatTimestamp = (): string => {
    return new Date().toLocaleString('sv-SE', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(' ', 'T') + '+07:00';
};

export const logger = {
    log: (...args: any[]) => {
        console.log(`[${formatTimestamp()}]`, ...args);
    },
    warn: (...args: any[]) => {
        console.warn(`[${formatTimestamp()}]`, ...args);
    },
    error: (...args: any[]) => {
        console.error(`[${formatTimestamp()}]`, ...args);
    },
    info: (...args: any[]) => {
        console.log(`[${formatTimestamp()}] [INFO]`, ...args);
    },
    debug: (...args: any[]) => {
        if (process.env.DEBUG === 'true') {
            console.log(`[${formatTimestamp()}] [DEBUG]`, ...args);
        }
    }
};

// Optionally override global console for automatic timestamps everywhere
export const enableGlobalTimestamps = () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
        originalLog(`[${formatTimestamp()}]`, ...args);
    };
    console.warn = (...args: any[]) => {
        originalWarn(`[${formatTimestamp()}]`, ...args);
    };
    console.error = (...args: any[]) => {
        originalError(`[${formatTimestamp()}]`, ...args);
    };
};
