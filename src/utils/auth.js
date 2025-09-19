/**
 * Generate a masked password hint for display (e.g., Ro****ia)
 * @param {string} password - The raw password string
 * @param {number} visibleStart - Number of visible characters at the start
 * @param {number} visibleEnd - Number of visible characters at the end
 * @returns {string} masked hint (e.g., "Ad****23")
 */
const generatePasswordHint = (password, visibleStart = 2, visibleEnd = 2) => {
    if (typeof password !== 'string') return '';
    const totalLength = password.length;

    // If password is too short to mask
    if (totalLength <= visibleStart + visibleEnd) {
        return '*'.repeat(totalLength); // mask everything
    }

    const start = password.substring(0, visibleStart);
    const end = password.substring(totalLength - visibleEnd);
    const maskedMiddle = '*'.repeat(totalLength - visibleStart - visibleEnd);

    return `${start}${maskedMiddle}${end}`;
};

module.exports = {
    generatePasswordHint
};
