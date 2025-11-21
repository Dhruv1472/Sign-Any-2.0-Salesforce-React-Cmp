const SIGNATURE_TYPES = new Set(["signature"]);
const FIELD_TYPES = new Set(["text", "date", "number", "email", "checkbox", "initials"]);

const normalizeType = (value) => (typeof value === "string" ? value.toLowerCase() : "");

export const isSignatureEntry = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    const t = normalizeType(entry.type);
    if (SIGNATURE_TYPES.has(t)) return true;
    if (FIELD_TYPES.has(t) || FIELD_TYPES.has(normalizeType(entry.fieldType))) return false;
    // Backward-compat: no explicit fieldType and unknown type → treat as signature
    return !entry.fieldType;
};

export const isFieldEntry = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    const t = normalizeType(entry.fieldType || entry.type);
    return FIELD_TYPES.has(t);
};

/**
 * Update signature data when a signature is added
 * Only updates entries that are signatures; optionally restrict by expectedType
 * Now supports nested fields structure and metadata storage
 */
export const updateSignatureWithImage = (signatures, index, imageUrl, expectedType, signerObject = null, metadata = {}) => {
    const expected = normalizeType(expectedType);
    return signatures.map((sig) => {
        // Check if this signature has the index directly
        const sigType = normalizeType(sig.type);
        const typeMatches = expected ? sigType === expected : true;
        if (sig.index === index && isSignatureEntry(sig) && typeMatches) {
            return { ...sig, signed: true, imageUrl, ...metadata };
        }
        
        // Check if this signature has fields array with the matching index
        if (sig.fields && Array.isArray(sig.fields)) {
            const hasMatchingField = sig.fields.some(field => field.index === index);
            if (hasMatchingField) {
                // If signerObject is provided, verify this is the correct signer
                // by matching priority or email
                let isCorrectSigner = true;
                if (signerObject) {
                    // Match by priority (strict equality) or by email
                    isCorrectSigner = (sig.priority === signerObject.priority) || (sig.email === signerObject.email);
                }
                
                if (isCorrectSigner) {
                    return {
                        ...sig,
                        fields: sig.fields.map(field => 
                            field.index === index 
                                ? { ...field, filled: true, imageUrl, ...metadata } 
                                : field
                        )
                    };
                }
            }
        }
        
        return sig;
    });
};

/**
 * Update signature data when a signature is deleted
 * Only updates entries that are signatures; optionally restrict by expectedType
 * Now supports nested fields structure
 */
export const deleteSignatureImage = (signatures, index, expectedType, signerObject = null) => {
    const expected = normalizeType(expectedType);
    return signatures.map((sig) => {
        // Check if this signature has the index directly
        const sigType = normalizeType(sig.type);
        const typeMatches = expected ? sigType === expected : true;
        if (sig.index === index && isSignatureEntry(sig) && typeMatches) {
            return { ...sig, signed: false, imageUrl: null };
        }
        
        // Check if this signature has fields array with the matching index
        if (sig.fields && Array.isArray(sig.fields)) {
            const hasMatchingField = sig.fields.some(field => field.index === index);
            if (hasMatchingField) {
                // If signerObject is provided, verify this is the correct signer
                // by matching priority or email
                let isCorrectSigner = true;
                if (signerObject) {
                    // Match by priority (strict equality) or by email
                    isCorrectSigner = (sig.priority === signerObject.priority) || (sig.email === signerObject.email);
                }
                
                if (isCorrectSigner) {
                    return {
                        ...sig,
                        fields: sig.fields.map(field => 
                            field.index === index 
                                ? { ...field, filled: false, imageUrl: null } 
                                : field
                        )
                    };
                }
            }
        }
        
        return sig;
    });
};

/**
 * Update field data when a field value is added
 * Only updates entries that are fields; optionally restrict by expectedFieldType
 */
export const updateFieldWithValue = (fields, index, value, expectedFieldType) => {
    const expected = normalizeType(expectedFieldType);
    return fields.map((field) => {
        const fType = normalizeType(field.fieldType || field.type);
        const typeMatches = expected ? fType === expected : true;
        if (field.index === index && isFieldEntry(field) && typeMatches) {
            return { ...field, filled: true, value };
        }
        return field;
    });
};

/**
 * Update field data when a field value is deleted
 * Only updates entries that are fields; optionally restrict by expectedFieldType
 */
export const deleteFieldValue = (fields, index, expectedFieldType) => {
    const expected = normalizeType(expectedFieldType);
    return fields.map((field) => {
        const fType = normalizeType(field.fieldType || field.type);
        const typeMatches = expected ? fType === expected : true;
        if (field.index === index && isFieldEntry(field) && typeMatches) {
            return { ...field, filled: false, value: null };
        }
        return field;
    });
};

/**
 * Update nested field value within signatureData structure
 * This handles text/date/number/email/checkbox fields that are nested within signer objects
 */
export const updateNestedFieldValue = (signatures, index, value, expectedFieldType, signerObject = null) => {
    const expected = normalizeType(expectedFieldType);
    return signatures.map((sig) => {
        // Check if this signature has fields array with the matching index
        if (sig.fields && Array.isArray(sig.fields)) {
            const hasMatchingField = sig.fields.some(field => field.index === index);
            if (hasMatchingField) {
                // If signerObject is provided, verify this is the correct signer
                let isCorrectSigner = true;
                if (signerObject) {
                    isCorrectSigner = (sig.priority === signerObject.priority) || (sig.email === signerObject.email);
                }
                
                if (isCorrectSigner) {
                    return {
                        ...sig,
                        fields: sig.fields.map(field => {
                            const fType = normalizeType(field.fieldType || field.type);
                            const typeMatches = expected ? fType === expected : true;
                            if (field.index === index && isFieldEntry(field) && typeMatches) {
                                return { ...field, filled: true, value };
                            }
                            return field;
                        })
                    };
                }
            }
        }
        return sig;
    });
};

/**
 * Delete nested field value within signatureData structure
 * This handles text/date/number/email/checkbox fields that are nested within signer objects
 */
export const deleteNestedFieldValue = (signatures, index, expectedFieldType, signerObject = null) => {
    const expected = normalizeType(expectedFieldType);
    return signatures.map((sig) => {
        // Check if this signature has fields array with the matching index
        if (sig.fields && Array.isArray(sig.fields)) {
            const hasMatchingField = sig.fields.some(field => field.index === index);
            if (hasMatchingField) {
                // If signerObject is provided, verify this is the correct signer
                let isCorrectSigner = true;
                if (signerObject) {
                    isCorrectSigner = (sig.priority === signerObject.priority) || (sig.email === signerObject.email);
                }
                
                if (isCorrectSigner) {
                    return {
                        ...sig,
                        fields: sig.fields.map(field => {
                            const fType = normalizeType(field.fieldType || field.type);
                            const typeMatches = expected ? fType === expected : true;
                            if (field.index === index && isFieldEntry(field) && typeMatches) {
                                return { ...field, filled: false, value: null };
                            }
                            return field;
                        })
                    };
                }
            }
        }
        return sig;
    });
};