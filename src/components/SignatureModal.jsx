import React, { useState } from "react";
import DrawSignature from "./signature-tabs/DrawSignature";
import TypeSignature from "./signature-tabs/TypeSignature";
import UploadSignature from "./signature-tabs/UploadSignature";
import "./SignatureModal.css";

const TABS = {
    DRAW: "draw",
    TYPE: "type",
    UPLOAD: "upload",
};

/**
 * SignatureModal Component
 * Modal for capturing signatures with three tabs: Draw, Type, Upload
 *
 * @param {boolean} isOpen - Controls modal visibility
 * @param {Function} onClose - Callback when modal is closed
 * @param {Function} onSave - Callback when signature is saved (receives base64 image)
 * @param {Object} signature - Signature configuration object
 * @param {string} title - Modal title (default: "Create Signature")
 */
const SignatureModal = ({ isOpen, onClose, onSave, signature, title = "Create Signature" }) => {
    const [activeTab, setActiveTab] = useState(TABS.DRAW);
    const [signatureData, setSignatureData] = useState(null);
    const [clearTrigger, setClearTrigger] = useState(0);

    if (!isOpen) return null;

    // Get signature type (signature, text, or initials)
    const signatureType = signature?.type || "signature";
    const isTextOrInitials = signatureType === "text" || signatureType === "initials";

    const handleSave = () => {
        if (signatureData && onSave) {
            onSave(signatureData, signature, activeTab);
            handleClose();
        }
    };

    const handleClose = () => {
        setSignatureData(null);
        setActiveTab(TABS.DRAW);
        setClearTrigger(0);
        if (onClose) onClose();
    };

    const handleClear = () => {
        setSignatureData(null);
        setClearTrigger((prev) => prev + 1);
    };

    const handleSignatureChange = (data) => {
        setSignatureData(data);
    };

    return (
        <div className="signature-modal-overlay" onClick={handleClose}>
            <div className="signature-modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="signature-modal-header">
                    <h2>{title}</h2>
                    <button className="signature-modal-close" onClick={handleClose}>
                        ×
                    </button>
                </div>

                {!isTextOrInitials && (
                    <div className="signature-modal-tabs">
                        <div className="signature-tabs-slider">
                            <button className={`signature-tab ${activeTab === TABS.DRAW ? "active" : ""}`} onClick={() => setActiveTab(TABS.DRAW)}>
                                Draw
                            </button>
                            <button className={`signature-tab ${activeTab === TABS.TYPE ? "active" : ""}`} onClick={() => setActiveTab(TABS.TYPE)}>
                                Type
                            </button>
                            <button className={`signature-tab ${activeTab === TABS.UPLOAD ? "active" : ""}`} onClick={() => setActiveTab(TABS.UPLOAD)}>
                                Upload
                            </button>
                            <div className="signature-tabs-slider-indicator" data-active={activeTab}></div>
                        </div>
                    </div>
                )}

                <div className="signature-modal-content">
                    {isTextOrInitials ? (
                        <TypeSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} signatureType={signatureType} hideBold={true} hideItalic={true} hideFontStyle={true} hideFontSize={true} availableFonts={["Arial", "Courier New", "Times New Roman", "Verdana"]} defaultFontStyle="Arial" defaultFontSize={48} minFontSize={24} maxFontSize={48} fontSizeStep={4} maxTextLength={signatureType === "initials" ? 5 : 50} />
                    ) : (
                        <>
                            {activeTab === TABS.DRAW && <DrawSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} />}
                            {activeTab === TABS.TYPE && <TypeSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} signatureType={signatureType} defaultValue={signature?.defaultValue || ""} maxTextLength={signature?.maxLength || 50} />}
                            {activeTab === TABS.UPLOAD && <UploadSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} />}
                        </>
                    )}
                </div>

                <div className="signature-modal-footer">
                    <button className="signature-btn-cancel" onClick={handleClose}>
                        Cancel
                    </button>
                    <button className="signature-btn-clear" onClick={handleClear} disabled={!signatureData}>
                        Clear
                    </button>
                    <button className="signature-btn-save" onClick={handleSave} disabled={!signatureData}>
                        Save Signature
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignatureModal;
