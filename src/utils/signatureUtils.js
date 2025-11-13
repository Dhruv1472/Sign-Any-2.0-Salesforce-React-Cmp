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
 */
export const updateSignatureWithImage = (signatures, index, imageUrl, expectedType) => {
    const expected = normalizeType(expectedType);
    return signatures.map((sig) => {
        const sigType = normalizeType(sig.type);
        const typeMatches = expected ? sigType === expected : true;
        if (sig.index === index && isSignatureEntry(sig) && typeMatches) {
            return { ...sig, signed: true, imageUrl };
        }
        return sig;
    });
};

/**
 * Update signature data when a signature is deleted
 * Only updates entries that are signatures; optionally restrict by expectedType
 */
export const deleteSignatureImage = (signatures, index, expectedType) => {
    const expected = normalizeType(expectedType);
    return signatures.map((sig) => {
        const sigType = normalizeType(sig.type);
        const typeMatches = expected ? sigType === expected : true;
        if (sig.index === index && isSignatureEntry(sig) && typeMatches) {
            return { ...sig, signed: false, imageUrl: null };
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