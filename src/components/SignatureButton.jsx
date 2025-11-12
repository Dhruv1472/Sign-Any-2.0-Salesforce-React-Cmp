import React from "react";
import "./SignatureButton.css";

/**
 * SignatureButton Component
 * Renders either a signature button or an existing signature image
 *
 * @param {Object} signature - Signature configuration object
 * @param {Function} onSign - Callback when sign button is clicked
 * @param {Function} onDelete - Callback when delete button is clicked
 * @param {boolean} canDelete - Whether the delete button should be shown
 */
const SignatureButton = ({ signature, onSign, onDelete, canDelete = false }) => {
    const { key, buttonName, width, signed, imageUrl, disabled } = signature;

    const handleSignClick = () => {
        if (!disabled && onSign) {
            onSign(signature);
        }
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        if (onDelete) {
            onDelete(signature);
        }
    };

    // If signature is already signed, show the image
    if (signed && imageUrl) {
        return (
            <div className={`signature-image-container ${signed ? "signed" : ""}`}>
                <img src={imageUrl} alt={`Signature-${key}`} className="signature-image" style={{ width: `${width}px` }} />
                {canDelete && (
                    <button className="signature-delete-btn" onClick={handleDeleteClick} title="Delete signature">
                        ×
                    </button>
                )}
            </div>
        );
    }

    // Otherwise show the sign button
    return (
        <button className="signature-button" onClick={handleSignClick} disabled={disabled} data-key={key}>
            {buttonName || "Sign Here"}
        </button>
    );
};

export default SignatureButton;
