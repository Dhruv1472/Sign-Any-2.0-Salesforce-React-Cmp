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
 * @param {boolean} hasStoredSignature - Whether there's a stored signature to reuse
 * @param {Function} onReuseSignature - Callback when reusing stored signature
 */
const SignatureButton = ({ signature, onSign, onDelete, canDelete = false, canvasScale = 1, hasStoredSignature = false, onReuseSignature }) => {
    const { key, buttonName, width, signed, filled, imageUrl, disabled, timeStamp, timestamp, _parentSigner } = signature;

    const handleSignClick = (e) => {
        e.stopPropagation();
        if (!disabled && onSign) {
            onSign(signature);
        }
    };
    
    const handleReuseClick = (e) => {
        e.stopPropagation();
        if (!disabled && onReuseSignature) {
            onReuseSignature(signature);
        }
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        if (onDelete) {
            onDelete(signature);
        }
    };

    // Check both 'signed' (old structure) and 'filled' (new nested structure)
    const isCompleted = signed || filled;

    // Get signer info and timestamp
    const signerName = _parentSigner?.name || signature.name || "";
    const signatureTimestamp = timeStamp || timestamp || "";

    // If signature is already signed/filled, show the image
    if (isCompleted && imageUrl) {
        return (
            <>
                <div className={`signature-image-container ${isCompleted ? "signed" : ""}`}>
                    <img src={imageUrl} alt={`Signature-${key}`} className="signature-image" style={{ width: `${width}px` }} draggable="false" />
                    {canDelete && (
                        <button className="signature-delete-btn" onClick={handleDeleteClick} title="Delete signature" style={{ top: `${4 * canvasScale}px`, right: `${4 * canvasScale}px`, width: `${24 * canvasScale}px`, height: `${24 * canvasScale}px`, fontSize: `${16 * canvasScale}px` }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <path d="M7 7L17 17M7 17L17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        </button>
                    )}
                </div>
                {(signerName || signatureTimestamp) && (
                    <div className="signature-footer" style={{ marginTop: `${2 * canvasScale}px`, paddingTop: `${2 * canvasScale}px`, paddingBottom: `${2 * canvasScale}px`, maxWidth: `${width}px` }}>
                        <div className="signature-footer-text" style={{ fontSize: `${9.85 * canvasScale + 0.52}px`}}>
                            {signerName && <span className="signature-footer-name">{signerName}</span>}
                            {signerName && signatureTimestamp && <span className="signature-footer-separator"> | </span>}
                            {signatureTimestamp && <span className="signature-footer-timestamp">{signatureTimestamp}</span>}
                        </div>
                    </div>
                )}
            </>
        );
    }

    // Otherwise show the sign button (split if stored signature available)
    if (hasStoredSignature && !disabled) {
        return (
            <div className="signature-button-split-container" data-key={key}>
                <button
                    className="signature-button signature-button-reuse"
                    onClick={handleReuseClick}
                    title="Use stored signature"
                    style={{
                        padding: `${8 * canvasScale}px ${8 * canvasScale}px`,
                        borderWidth: `${2 * canvasScale}px`,
                        fontSize: `${14 * canvasScale}px`,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                    }}>
                    <svg width={`${16 * canvasScale}px`} height={`${16 * canvasScale}px`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                </button>
                <button
                    className="signature-button signature-button-new"
                    onClick={handleSignClick}
                    title="Create new signature"
                    style={{
                        padding: `${8 * canvasScale}px ${16 * canvasScale}px`,
                        borderWidth: `${2 * canvasScale}px`,
                        fontSize: `${14 * canvasScale}px`,
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                    }}>
                    {buttonName || "Sign Here"}
                </button>
            </div>
        );
    }
    
    return (
        <button
            className="signature-button"
            onClick={handleSignClick}
            disabled={disabled}
            data-key={key}
            style={{
                padding: `${8 * canvasScale}px ${16 * canvasScale}px`,
                borderWidth: `${2 * canvasScale}px`,
                fontSize: `${14 * canvasScale}px`,
            }}>
            {buttonName || "Sign Here"}
        </button>
    );
};

export default SignatureButton;
