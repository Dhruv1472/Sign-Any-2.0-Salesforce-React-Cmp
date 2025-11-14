import React, { useState, useRef, useEffect } from "react";
import "./TypeSignature.css";

/**
 * TypeSignature Component
 * Text-based signature with font selection
 *
 * @param {Function} onChange - Callback when signature is typed (receives base64 image)
 * @param {number} clearTrigger - Trigger to clear the text
 * @param {string} signatureType - Type of signature: signature, text, or initials
 * @param {boolean} hideBold - If true, hide bold button
 * @param {boolean} hideItalic - If true, hide italic button
 * @param {boolean} hideFontStyle - If true, hide font family selector
 * @param {boolean} hideFontSize - If true, hide font size selector
 * @param {Array<string>} availableFonts - Array of font names to show in selector
 * @param {string} defaultFontStyle - Default font family
 * @param {number} defaultFontSize - Default font size
 * @param {number} minFontSize - Minimum font size
 * @param {number} maxFontSize - Maximum font size
 * @param {number} fontSizeStep - Step increment for font sizes
 * @param {number} maxTextLength - Maximum number of characters allowed
 */
const TypeSignature = ({ onChange, clearTrigger, defaultValue = "", signatureType = "signature", hideBold = false, hideItalic = false, hideFontStyle = false, hideFontSize = false, availableFonts = ["Brush Script MT", "Lucida Handwriting", "Courier New", "Dancing Script", "Great Vibes"], defaultFontStyle = "Brush Script MT", defaultFontSize = 48, minFontSize = 2, maxFontSize = 100, fontSizeStep = 2, maxTextLength = 50 }) => {
    const [text, setText] = useState(defaultValue || "");
    const [selectedFont, setSelectedFont] = useState(defaultFontStyle);
    const [isBold, setIsBold] = useState(false);
    const [isItalic, setIsItalic] = useState(false);
    const [fontSize, setFontSize] = useState(defaultFontSize);
    const canvasRef = useRef(null);

    const fonts = availableFonts;

    // Generate font size options based on min, max, and step
    const fontSizes = Array.from({ length: Math.floor((maxFontSize - minFontSize) / fontSizeStep) + 1 }, (_, i) => minFontSize + i * fontSizeStep);

    // Clear text when clearTrigger changes
    useEffect(() => {
        if (clearTrigger > 0) {
            setText(defaultValue || "");
            setIsBold(false);
            setIsItalic(false);
            setFontSize(defaultFontSize);
            setSelectedFont(defaultFontStyle);
        }
    }, [clearTrigger, defaultFontSize, defaultFontStyle, defaultValue]);

    useEffect(() => {
        if (!text.trim()) {
            if (onChange) onChange(null);
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        // Set text styles first to measure accurately
        const fontStyle = isItalic ? "italic" : "normal";
        const fontWeight = isBold ? "bold" : "normal";
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${selectedFont}", cursive`;

        // Measure text to get actual dimensions
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;
        const textHeight = fontSize * 1.5; // Approximate height with some padding

        // Add padding to ensure nothing gets cut off
        const padding = 20;
        canvas.width = Math.max(textWidth + padding * 2, 200);
        canvas.height = Math.max(textHeight + padding * 2, 100);

        // Clear canvas
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Re-apply text styles after canvas resize (resize clears the context)
        ctx.fillStyle = "#000000";
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${selectedFont}", cursive`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Draw text at center
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        // Get image data and notify parent
        if (onChange) {
            onChange(canvas.toDataURL("image/png"));
        }
    }, [text, selectedFont, isBold, isItalic, fontSize, onChange]);

    const handleTextChange = (e) => {
        const newText = e.target.value;
        if (newText.length <= maxTextLength) {
            setText(newText);
        }
    };

    const handleFontChange = (e) => {
        setSelectedFont(e.target.value);
    };

    // Get placeholder text based on signature type
    const getPlaceholder = () => {
        if (signatureType === "text") return "Enter text here";
        if (signatureType === "initials") return "Enter initials here";
        return "Type your name here";
    };

    // Check if all styling controls are hidden (simplified mode)
    const isSimplifiedMode = hideBold && hideItalic && hideFontStyle && hideFontSize;

    return (
        <div className="type-signature-container">
            <div className={isSimplifiedMode ? "type-signature-restricted" : "type-signature-top-header"}>
                {isSimplifiedMode ? (
                    // Simplified mode - Only text input
                    <div className="type-signature-input-section">
                        <input id="signature-text" type="text" className="type-signature-input type-signature-input-large" value={text} onChange={handleTextChange} placeholder={getPlaceholder()} autoFocus maxLength={maxTextLength} />
                        {signatureType === "initials" && text.length > 0 && maxTextLength <= 10 && (
                            <div className="type-signature-hint">
                                <small>Initials are typically 2-3 characters</small>
                            </div>
                        )}
                    </div>
                ) : (
                    // Full mode with conditional controls
                    <>
                        <div className="left-section">
                            {/* Text Input */}
                            <div className="type-signature-input-section">
                                <input id="signature-text" type="text" className="type-signature-input" value={text} onChange={handleTextChange} placeholder={getPlaceholder()} autoFocus maxLength={maxTextLength} />
                                {maxTextLength && maxTextLength < 100 && (
                                    <div className="type-signature-char-counter" style={{ fontSize: '11px', color: '#666', marginTop: '4px', textAlign: 'right' }}>
                                        {text.length} / {maxTextLength} characters
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="right-section">
                            {/* Bold Button */}
                            {!hideBold && (
                                <button className={`type-signature-style-btn ${isBold ? "active" : ""}`} onClick={() => setIsBold(!isBold)} title="Bold">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M4 2h5.5C11.43 2 13 3.57 13 5.5c0 1.25-.66 2.35-1.65 2.97C12.61 9.09 14 10.8 14 12.5 14 14.43 12.43 16 10.5 16H4V2zm5.5 5C10.88 7 12 5.88 12 4.5S10.88 2 9.5 2H5v5h4.5zM5 8v6h5.5c1.38 0 2.5-1.12 2.5-2.5S11.88 8 10.5 8H5z" />
                                    </svg>
                                </button>
                            )}

                            {/* Italic Button */}
                            {!hideItalic && (
                                <button className={`type-signature-style-btn ${isItalic ? "active" : ""}`} onClick={() => setIsItalic(!isItalic)} title="Italic">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M7 2.5v1h3.5l-4 9H3v1h6.5v-1H6l4-9h3.5v-1H7z" />
                                    </svg>
                                </button>
                            )}

                            {/* Font Family Select */}
                            {!hideFontStyle && (
                                <div className="type-signature-font-section">
                                    <select id="signature-font" className="type-signature-font-select" value={selectedFont} onChange={handleFontChange}>
                                        {fonts.map((font) => (
                                            <option key={font} value={font}>
                                                {font}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Font Size Select */}
                            {!hideFontSize && (
                                <div className="type-signature-size-section">
                                    <select id="signature-size" className="type-signature-size-select" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
                                        {fontSizes.map((size) => (
                                            <option key={size} value={size}>
                                                {size}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className="type-signature-preview-section">
                <div className="type-signature-preview">
                    {text ? (
                        <span
                            className="type-signature-preview-text"
                            style={{
                                fontFamily: `"${selectedFont}", ${hideFontStyle ? "sans-serif" : "cursive"}`,
                                fontWeight: isBold ? "bold" : "normal",
                                fontStyle: isItalic ? "italic" : "normal",
                                fontSize: `${fontSize}px`,
                            }}>
                            {text}
                        </span>
                    ) : (
                        <span className="type-signature-preview-placeholder">Your {signatureType} will appear here</span>
                    )}
                </div>
            </div>

            {/* Hidden canvas for image generation */}
            <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
    );
};

export default TypeSignature;
