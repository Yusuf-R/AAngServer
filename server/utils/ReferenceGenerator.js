import crypto from 'crypto';

class ReferenceGenerator {
    /**
     * Generate a unique transfer reference
     * Format: aang-pay-{timestamp}-{random}
     * Example: aang-pay-1732708441-x7k9m2n4
     */
    static generateTransferReference() {
        const timestamp = Math.floor(Date.now() / 1000);
        const randomPart = crypto.randomBytes(4).toString('hex');
        return `aang-pay-${timestamp}-${randomPart}`;
    }

    /**
     * Generate a unique transaction reference
     */
    static generateTransactionReference() {
        const timestamp = Date.now();
        const randomPart = crypto.randomBytes(6).toString('hex');
        return `aang-txn-${timestamp}-${randomPart}`;
    }

    /**
     * Validate reference format
     */
    static isValidTransferReference(reference) {
        if (!reference || typeof reference !== 'string') return false;

        // Check format: aang-pay-{timestamp}-{hex}
        const pattern = /^aang-pay-\d{10}-[a-f0-9]{8}$/;
        return pattern.test(reference);
    }
}

export default ReferenceGenerator;