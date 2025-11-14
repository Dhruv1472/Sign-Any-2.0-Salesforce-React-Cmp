import React from "react";
import SignatureButton from "./SignatureButton";
import "./SignatureOverlay.css";

/**
 * SignatureOverlay Component
 * Renders signature buttons/images overlaid on a PDF page
 *
 * @param {number} pageNumber - The page number (1-indexed)
 * @param {Array} signatures - Array of signature configurations for this page
 * @param {Function} onSign - Callback when sign button is clicked
 * @param {Function} onDelete - Callback when delete is clicked
 * @param {boolean} isSubmitted - Whether document has been submitted
 * @param {Set} sessionSignedKeys - Set of signature keys signed in current session
 * @param {Object} canvasDimensions - Canvas width and height for positioning
 */
const SignatureOverlay = ({ pageNumber, priority, signatures, onSign, onDelete, isSubmitted, sessionSignedKeys, canvasDimensions }) => {
    // Filter signatures for this page and exclude hidden ones
    const pageSignatures = signatures
        .filter((sig) => {
            if (sig.priority != priority) {
                return false;
            }
            return sig?.fields?.some((field) => field.pageNumber === pageNumber );
        })
        .reduce((arr, sig) => {
            const fields = sig.fields.filter((f) => f.pageNumber === pageNumber ).map(f => ({...f,_parentSigner: sig}));
            return [...arr, ...fields];
        }, []);

    if (pageSignatures.length === 0) {
        return null;
    }

    return (
        <div className="signature-overlay">
            {pageSignatures.map((field, idx) => {
                // Use field.index as key, fallback to index if not available
                const uniqueKey = field.index ?? `field-${pageNumber}-${idx}`;
                
                // Show delete button only if:
                // 1. Document hasn't been submitted AND
                // 2. Signature was signed in current session (not pre-existing)
                const canDelete = !isSubmitted && sessionSignedKeys.has(field.index);

                return (
                    <div
                        key={uniqueKey}
                        className="signature-position"
                        style={{
                            position: "absolute",
                            left: `${field.xPercent}%`,
                            top: `${field.yPercent}%`,
                            width: `${field.widthPercent}%`,
                            height: `${field.heightPercent}%`,
                        }}>
                        <SignatureButton signature={{ ...field, disabled: isSubmitted }} onSign={onSign} onDelete={onDelete} canDelete={canDelete} />
                    </div>
                );
            })}
        </div>
    );
};

export default SignatureOverlay;
