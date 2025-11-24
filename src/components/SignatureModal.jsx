import React, { useState } from "react";
import DrawSignature from "./signature-tabs/DrawSignature";
import TypeSignature from "./signature-tabs/TypeSignature";
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
 * @param {Object} adminProperties - Admin configuration properties
 */
const SignatureModal = ({ isOpen, onClose, onSave, signature, title = "Create Signature", adminProperties = null }) => {
    const [activeTab, setActiveTab] = useState(TABS.DRAW);
    const [signatureData, setSignatureData] = useState(null);
    const [clearTrigger, setClearTrigger] = useState(0);

    // Parse admin properties
    const hidePenAndErase = adminProperties?.Hide_Pen_And_Erase__c || false;
    const hideUndoRedo = adminProperties?.Hide_Undo_Redo__c || false;
    const hideBrushSize = adminProperties?.Hide_Brush_Size__c || false;
    const defaultBrushSize = hideBrushSize && adminProperties?.Default_Brush_Size__c ? adminProperties?.Default_Brush_Size__c : 2;
    
    const hideAvailableFonts = adminProperties?.Hide_Available_Fonts__c || false;
    const hideBoldOption = adminProperties?.Hide_Bold_Option__c || false;
    const hideItalicOption = adminProperties?.Hide_Italic_Option__c || false;
    const hideFontSizeOption = adminProperties?.Hide_Font_Size_Option__c || false;
    const defaultFontSize = hideFontSizeOption && adminProperties?.Default_Font_Size__c ? adminProperties?.Default_Font_Size__c : 48;
    const defaultFontStyle = adminProperties?.Default_Font_Style__c || "Brush Script MT";
    const availableFonts = hideAvailableFonts && adminProperties?.Available_Fonts__c 
        ? adminProperties.Available_Fonts__c.split(',').map(f => f.trim()).filter(f => f.length > 0)
        : ["Brush Script MT", "Lucida Handwriting", "Courier New", "Dancing Script", "Great Vibes"];

    if (!isOpen) return null;

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
                    <svg width="32" height="32" viewBox="0 0 24 24" className="signature-modal-close" onClick={handleClose}>
                        <path d="M7 7L17 17M7 17L17 7" stroke="#5F5F5F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>

                <div className="signature-modal-body">
                    <div className="signature-tabs-slider">
                        <button className={`signature-tab ${activeTab === TABS.DRAW ? "active" : ""}`} onClick={() => setActiveTab(TABS.DRAW)}>
                            Draw
                        </button>
                        <button className={`signature-tab ${activeTab === TABS.TYPE ? "active" : ""}`} onClick={() => setActiveTab(TABS.TYPE)}>
                            Type
                        </button>
                        <div className="signature-tabs-slider-indicator" data-active={activeTab}></div>
                    </div>

                    <div className="signature-modal-content">
                        {activeTab === TABS.DRAW && (
                            <DrawSignature 
                                onChange={handleSignatureChange} 
                                clearTrigger={clearTrigger}
                                hidePen={hidePenAndErase}
                                hideEraser={hidePenAndErase}
                                hideUndo={hideUndoRedo}
                                hideRedo={hideUndoRedo}
                                hideBrushSize={hideBrushSize}
                                defaultPenSize={defaultBrushSize}
                            />
                        )}
                        {activeTab === TABS.TYPE && (
                            <TypeSignature 
                                onChange={handleSignatureChange} 
                                clearTrigger={clearTrigger} 
                                defaultValue={signature?.defaultValue || ""} 
                                maxTextLength={signature?.maxLength || 50}
                                hideBold={hideBoldOption}
                                hideItalic={hideItalicOption}
                                hideFontStyle={hideAvailableFonts}
                                hideFontSize={hideFontSizeOption}
                                defaultFontStyle={defaultFontStyle}
                                defaultFontSize={defaultFontSize}
                                availableFonts={availableFonts}
                            />
                        )}
                    </div>
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
