import React from "react";
import SignatureButton from "./SignatureButton";
import FieldButton from "./FieldButton";
import "./SignatureOverlay.css";

/**
 * SignatureOverlay Component
 * Renders signature buttons/images and field inputs overlaid on a PDF page
 * Handles nested field structure where both signatures and text fields are grouped by signer
 *
 * @param {number} pageNumber - The page number (1-indexed)
 * @param {Array} signatures - Array of signature configurations for this page
 * @param {Function} onSign - Callback when sign button is clicked
 * @param {Function} onFieldClick - Callback when field button is clicked
 * @param {Function} onFieldSave - Callback when inline field is saved
 * @param {Function} onDelete - Callback when delete is clicked
 * @param {Function} onFieldDelete - Callback when field delete is clicked
 * @param {boolean} isSubmitted - Whether document has been submitted
 * @param {Set} sessionSignedKeys - Set of signature keys signed in current session
 * @param {Set} sessionFilledKeys - Set of field keys filled in current session
 * @param {number} canvasScale - Scale factor for responsive sizing
 */
const SignatureOverlay = ({ pageNumber, priority, signatures, onSign, onFieldClick, onFieldSave, onDelete, onFieldDelete, isSubmitted, sessionSignedKeys, sessionFilledKeys, canvasScale = 1 }) => {
    // Filter signatures for this page
    // Show: 1. Current priority fields (editable), 2. Lower priority filled fields (read-only, already signed)
    const pageSignatures = signatures
        .filter((sig) => {
            // Show current priority fields OR lower priority fields that are already filled
            const isCurrentPriority = sig.priority == priority;
            const isLowerPriority = sig.priority < priority;

            if (!isCurrentPriority && !isLowerPriority) {
                return false; // Don't show higher priority fields
            }

            return sig?.fields?.some((field) => {
                if (field.pageNumber !== pageNumber) return false;

                // For current priority: show all fields
                if (isCurrentPriority) return true;

                // For lower priority: only show if filled (already signed)
                return isLowerPriority && field.filled;
            });
        })
        .reduce((arr, sig) => {
            const isCurrentPriority = sig.priority == priority;
            const fields = sig.fields
                .filter((f) => {
                    if (f.pageNumber !== pageNumber) return false;
                    // Current priority: include all fields
                    if (isCurrentPriority) return true;
                    // Lower priority: only include filled fields
                    return f.filled;
                })
                .map((f) => ({
                    ...f,
                    _parentSigner: sig,
                    // Mark lower priority fields as disabled (read-only)
                    disabled: !isCurrentPriority || isSubmitted,
                }));
            return [...arr, ...fields];
        }, []);

    if (pageSignatures.length === 0) {
        return null;
    }

    return (
        <div className="signature-overlay">
            {pageSignatures.map((field) => {
                // Determine if this is a signature or text field
                const fieldType = (field.type || "").toLowerCase();
                const isSignatureField = fieldType === "signature";
                const isTextField = ["text", "date", "number", "initials", "checkbox"].includes(fieldType);

                // Create unique key using priority + field index + field type
                // This prevents duplicate keys when multiple signers have fields with same index
                const parentPriority = field._parentSigner?.priority ?? priority;
                const uniqueKey = `${parentPriority}-${field.index}-${fieldType}`;

                // Show delete button only if field was signed/filled in current session
                const canDelete = !isSubmitted && (isSignatureField ? sessionSignedKeys.has(field.index) : sessionFilledKeys?.has(field.index));

                return (
                    <div key={uniqueKey} className={isSignatureField ? "signature-position" : "field-position"} style={{ position: "absolute", left: `${field.xPercent}%`, top: `${field.yPercent}%`, width: `${field.widthPercent}%`, height: `${field.heightPercent}%` }}>
                        {isSignatureField ? <SignatureButton signature={{ ...field, disabled: field.disabled }} onSign={onSign} onDelete={onDelete} canDelete={canDelete} canvasScale={canvasScale} /> : isTextField ? <FieldButton field={{ ...field, fieldType: fieldType }} onFieldClick={onFieldClick} onSave={onFieldSave} onDelete={onFieldDelete} canDelete={canDelete} disabled={field.disabled} canvasScale={canvasScale} /> : null}
                    </div>
                );
            })}
        </div>
    );
};

export default SignatureOverlay;
