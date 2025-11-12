/**
 * Update signature data when a signature is added
 * Works with nested structure where each signature has a fields array
 */
export const updateSignatureWithImage = (signatures, fieldIndex, imageUrl) => {
    return signatures.map((sig) => {
        // Check if this signature contains the field with the given index
        const fieldToUpdate = sig.fields?.find(f => f.index === fieldIndex);
        
        if (fieldToUpdate) {
            // Update the specific field within this signature
            return {
                ...sig,
                fields: sig.fields.map(field => 
                    field.index === fieldIndex 
                        ? { ...field, filled: true, imageUrl } 
                        : field
                )
            };
        }
        
        return sig;
    });
};

/**
 * Update signature data when a signature is deleted
 * Works with nested structure where each signature has a fields array
 */
export const deleteSignatureImage = (signatures, fieldIndex) => {
    return signatures.map((sig) => {
        // Check if this signature contains the field with the given index
        const fieldToDelete = sig.fields?.find(f => f.index === fieldIndex);
        
        if (fieldToDelete) {
            // Update the specific field within this signature
            return {
                ...sig,
                fields: sig.fields.map(field => 
                    field.index === fieldIndex 
                        ? { ...field, filled: false, imageUrl: null } 
                        : field
                )
            };
        }
        
        return sig;
    });
};
