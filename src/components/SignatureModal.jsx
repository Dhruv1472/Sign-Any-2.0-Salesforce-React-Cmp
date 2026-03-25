import React, { useState } from "react";
import DrawSignature from "./signature-tabs/DrawSignature";
import TypeSignature from "./signature-tabs/TypeSignature";
import "./SignatureModal.css";

const TABS = {
    DRAW: "draw",
    TYPE: "type",
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
 * @param {Object} pdfPageFormat - PDF page dimensions {width, height}
 */
const SignatureModal = ({ isOpen, onClose, onSave, signature, title = "Create Signature", adminProperties = null, pdfPageFormat = { width: 595, height: 842 } }) => {
    const [activeTab, setActiveTab] = useState(TABS.DRAW);
    const [signatureData, setSignatureData] = useState(null);
    const [clearTrigger, setClearTrigger] = useState(0);

    // Parse admin properties
    const hidePenAndErase = adminProperties?.MVSA2__Hide_Pen_And_Erase__c || false;
    const hideUndoRedo = adminProperties?.MVSA2__Hide_Undo_Redo__c || false;
    const hideBrushSize = adminProperties?.MVSA2__Hide_Brush_Size__c || false;
    const defaultBrushSize = adminProperties?.MVSA2__Default_Brush_Size__c ? adminProperties?.MVSA2__Default_Brush_Size__c : 2;

    const hideAvailableFonts = adminProperties?.MVSA2__Hide_Available_Fonts__c || false;
    const hideBoldOption = adminProperties?.MVSA2__Hide_Bold_Option__c || false;
    const hideItalicOption = adminProperties?.MVSA2__Hide_Italic_Option__c || false;
    const hideFontSizeOption = adminProperties?.MVSA2__Hide_Font_Size_Option__c || false;
    const defaultFontSize = adminProperties?.MVSA2__Default_Font_Size__c ? adminProperties?.MVSA2__Default_Font_Size__c : 48;
    const defaultFontStyle = adminProperties?.MVSA2__Default_Font_Style__c || "Artecallya";
    const availableFonts = adminProperties?.MVSA2__Available_Fonts__c
        ? adminProperties.MVSA2__Available_Fonts__c.split(",")
            .map((f) => f.trim())
            .filter((f) => f.length > 0)
        : ["Artecallya", "Maytra", "Mr Dafoe", "Mr DeHaviland", "The signature", "Monsieur La Doulaise", "Mrs Saint Delafield", "Barokah", "Bettina", "High Summit"];

    // Calculate aspect ratio from signature dimensions (width / height)
    // widthPercent and heightPercent are relative to page dimensions, so we need to account for page aspect ratio
    // Formula: (widthPercent/100 * pageWidth) / (heightPercent/100 * pageHeight) = (widthPercent * pageWidth) / (heightPercent * pageHeight)
    const pageAspectRatio = pdfPageFormat.width / pdfPageFormat.height;
    const signatureAspectRatio = signature?.widthPercent && signature?.heightPercent
        ? (signature.widthPercent / signature.heightPercent) * pageAspectRatio
        : 1.65;

    // Smart sizing based on aspect ratio threshold (1.65)
    // Wide boxes (ratio > 1.65): Fix width at 547px, adjust height
    // Tall boxes (ratio < 1.65): Fix height at 274px, adjust width
    const THRESHOLD_RATIO = 1.6594202899;
    const MAX_WIDTH = 453;
    const MAX_HEIGHT = 274;

    let canvasWidth, canvasHeight;
    if (signatureAspectRatio > THRESHOLD_RATIO) {
        // Wide box: fix width, calculate height
        canvasWidth = MAX_WIDTH;
        canvasHeight = MAX_WIDTH / signatureAspectRatio;
    } else {
        // Tall box: fix height, calculate width
        canvasHeight = MAX_HEIGHT;
        canvasWidth = MAX_HEIGHT * signatureAspectRatio;
    }

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
                    <div className="signature-modal-header-content">
                        <img src="./src/assets/Sign Any Favicon.png" alt="Sign Any Logo" className="signature-modal-logo" />
                        <div className="signature-modal-header-text">
                            <h2>{title}</h2>
                        </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="signature-modal-close" onClick={handleClose}>
                            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" strokeWidth="0.5" />
                        </svg>
                </div>

                <div className="signature-modal-body">
                    <div className="signature-tabs-slider">
                        <button className={`signature-tab ${activeTab === TABS.DRAW ? "active" : ""}`} onClick={() => setActiveTab(TABS.DRAW)}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pen-fill" viewBox="0 0 16 16">
                                <path d="m13.498.795.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001" />
                            </svg>
                            Draw
                        </button>
                        <button className={`signature-tab ${activeTab === TABS.TYPE ? "active" : ""}`} onClick={() => setActiveTab(TABS.TYPE)}>
                            <svg xmlns="http://www.w3.org/2000/svg" style={{ marginTop: "2px" }} fill="currentColor" viewBox="0 0 24 24" height="24" width="24">
                                <g id="keyboard-setting-bolt">
                                    <path fill="currentColor" d="M22 14.5v5L17.5 22 13 19.5v-5l4.5 -2.5zm-4.5 0.5c-1.1046 0 -2 0.8954 -2 2s0.8954 2 2 2 2 -0.8954 2 -2 -0.8954 -2 -2 -2m1.5 -5h-2V6H4v7h7v2H2V4h17zM7 12H5v-2h2zm6 0H8v-2h5zM7 9H5V7h2zm3 0H8V7h2zm3 0h-2V7h2zm3 0h-2V7h2z" stroke-width="1"></path>
                                </g>
                            </svg>
                            Type
                        </button>
                        <div className="signature-tabs-slider-indicator" data-active={activeTab}></div>
                    </div>

                    <div className="signature-modal-content">
                        {activeTab === TABS.DRAW && <DrawSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} hidePen={hidePenAndErase} hideEraser={hidePenAndErase} hideUndo={hideUndoRedo} hideRedo={hideUndoRedo} hideBrushSize={hideBrushSize} defaultPenSize={defaultBrushSize} aspectRatio={signatureAspectRatio} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />}
                        {activeTab === TABS.TYPE && <TypeSignature onChange={handleSignatureChange} clearTrigger={clearTrigger} defaultValue={signature?.defaultValue || ""} maxTextLength={signature?.maxLength || 50} hideBold={hideBoldOption} hideItalic={hideItalicOption} hideFontStyle={hideAvailableFonts} hideFontSize={hideFontSizeOption} defaultFontStyle={defaultFontStyle} defaultFontSize={defaultFontSize} availableFonts={availableFonts} aspectRatio={signatureAspectRatio} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />}
                    </div>
                </div>

                <div className="signature-modal-footer">
                    <button className="signature-btn-cancel" onClick={handleClose}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" strokeWidth="0.5" />
                        </svg>
                        Cancel
                    </button>
                    <button className="signature-btn-clear" onClick={handleClear} disabled={!signatureData}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828l6.879-6.879zm2.121.707a1 1 0 0 0-1.414 0L4.16 7.547l5.293 5.293 4.633-4.633a1 1 0 0 0 0-1.414l-3.879-3.879zM8.746 13.547 3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293l.16-.16z" />
                        </svg>
                        Clear
                    </button>
                    <button className="signature-btn-save" onClick={handleSave} disabled={!signatureData}>
                        <svg width="24" height="24" viewBox="0 0 14 14" fill="currentColor">
                            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" strokeWidth="0.8" stroke="currentColor" />
                        </svg>
                        Save Signature
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignatureModal;
