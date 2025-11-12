/**
 * Update signature data when a signature is added
 */
export const updateSignatureWithImage = (signatures, index, imageUrl) => {
    return signatures.map((sig) => (sig.index === index ? { ...sig, signed: true, imageUrl } : sig));
};

/**
 * Update signature data when a signature is deleted
 */
export const deleteSignatureImage = (signatures, index) => {
    return signatures.map((sig) => (sig.index === index ? { ...sig, signed: false, imageUrl: null } : sig));
};
