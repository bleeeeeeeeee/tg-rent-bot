class DateParser {
    /**
     * Parse an input string into a Date object.
     * Supported formats:
     *   - ISO / RFC date strings (e.g. "2026-02-24T15:30" or "2026-02-24 15:30")
     *   - YYYY-MM-DD HH:mm
     *   - DD.MM.YYYY HH:mm (common in Russian locales)
     * Returns null if the string could not be interpreted or the date is invalid.
     */
    static parse(text) {
        if (!text || typeof text !== 'string') return null;
        const trimmed = text.trim();

        // try native Date parsing first
        let date = new Date(trimmed);
        if (!isNaN(date)) {
            return date;
        }

        // try custom dd.mm.yyyy hh:mm
        const ru = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})$/);
        if (ru) {
            const [, d, m, y, h, min] = ru;
            date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
            if (!isNaN(date)) return date;
        }

        // try alternative ISO with space instead of T
        const iso = trimmed.replace(' ', 'T');
        date = new Date(iso);
        if (!isNaN(date)) {
            return date;
        }

        return null;
    }
}

module.exports = DateParser;