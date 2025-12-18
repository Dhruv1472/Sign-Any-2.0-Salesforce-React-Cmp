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
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 */
const TypeSignature = ({ onChange, clearTrigger, defaultValue = "", hideBold = false, hideItalic = false, hideFontStyle = false, hideFontSize = false, availableFonts = ["Artecallya", "Maytra", "Mr Dafoe", "Mr DeHaviland", "The signature", "Monsieur La Doulaise", "Mrs Saint Delafield", "Barokah", "Bettina", "High Summit"], defaultFontStyle = "Artecallya", defaultFontSize = 48, minFontSize = 2, maxFontSize = 100, fontSizeStep = 2, maxTextLength = 50, aspectRatio = 4, canvasWidth = 547, canvasHeight = 274 }) => {
    const [text, setText] = useState(defaultValue || "");
    const [selectedFont, setSelectedFont] = useState(defaultFontStyle);
    const [isBold, setIsBold] = useState(false);
    const [isItalic, setIsItalic] = useState(false);
    const [fontSize, setFontSize] = useState(defaultFontSize);
    const [fontsLoaded, setFontsLoaded] = useState(false);
    const canvasRef = useRef(null);
    const previewRef = useRef(null); // Reference to the preview container

    const fonts = availableFonts;

    // Generate font size options based on min, max, and step
    const fontSizes = Array.from({ length: Math.floor((maxFontSize - minFontSize) / fontSizeStep) + 1 }, (_, i) => minFontSize + i * fontSizeStep);

    // Wait for fonts to be fully loaded
    useEffect(() => {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                setFontsLoaded(true);
            });
        } else {
            // Fallback for browsers without FontFaceSet API
            setFontsLoaded(true);
        }
    }, []);

    // Clear text when clearTrigger changes
    useEffect(() => {
        if (clearTrigger > 0) {
            setText("");
            setIsBold(false);
            setIsItalic(false);
            setFontSize(defaultFontSize);
            setSelectedFont(defaultFontStyle);
        }
    }, [clearTrigger, defaultFontSize, defaultFontStyle]);

    useEffect(() => {
        if (!text.trim()) {
            if (onChange) onChange(null);
            return;
        }

        // Wait for fonts to be loaded before generating canvas
        if (!fontsLoaded) return;

        const canvas = canvasRef.current;
        const previewContainer = previewRef.current;

        if (!canvas || !previewContainer) return;

        // Additional check: ensure the specific font is loaded
        const fontLoadCheck = async () => {
            try {
                if (document.fonts && document.fonts.check) {
                    const fontStyle = isItalic ? "italic" : "normal";
                    const fontWeight = isBold ? "bold" : "normal";
                    const actualFontSize = adjustedFontSize(selectedFont, fontSize);
                    const fontString = `${fontStyle} ${fontWeight} ${actualFontSize}px "${selectedFont}"`;
                    
                    // Check if font is loaded, if not wait for it
                    if (!document.fonts.check(fontString)) {
                        await document.fonts.load(fontString);
                        // Small delay to ensure font is fully rendered
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }
            } catch (error) {
                console.warn("Font loading check failed:", error);
                // Continue anyway after small delay
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };

        fontLoadCheck().then(() => {
            // Get the actual rendered dimensions of the preview container
            const previewRect = previewContainer.getBoundingClientRect();
            const previewWidth = previewRect.width;
            const previewHeight = previewRect.height;

            const ctx = canvas.getContext("2d");

            // Set canvas to exact same size as preview container
            canvas.width = previewWidth;
            canvas.height = previewHeight;

            // Clear canvas with transparent background
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Set text styles - use the exact same font size as preview
            const fontStyle = isItalic ? "italic" : "normal";
            const fontWeight = isBold ? "bold" : "normal";
            const actualFontSize = adjustedFontSize(selectedFont, fontSize);
            ctx.font = `${fontStyle} ${fontWeight} ${actualFontSize}px "${selectedFont}", cursive`;
            ctx.fillStyle = "#000000";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            // The text will naturally wrap in the span based on container width
            // We need to replicate that wrapping behavior in canvas
            const maxWidth = previewWidth - 4; // Account for padding (12px each side)
            const words = text.split(" ");
            const lines = [];
            let currentLine = "";

            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine + (currentLine ? " " : "") + words[i];
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = words[i];
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) {
                lines.push(currentLine);
            }

            // Calculate line height and center the text block vertically
            const lineHeight = actualFontSize * 1.2;
            const totalTextHeight = lines.length * lineHeight;
            const startY = (previewHeight - totalTextHeight) / 2 + lineHeight / 2;

            // Draw each line
            lines.forEach((line, index) => {
                const y = startY + index * lineHeight;
                ctx.fillText(line, previewWidth / 2, y);
            });

            // Get image data and notify parent
            if (onChange) {
                onChange(canvas.toDataURL("image/png"));
            }
        });
    }, [text, selectedFont, isBold, isItalic, fontSize, onChange, aspectRatio, fontsLoaded]);

    const adjustedFontSize = (selectedFont, fontSize) => {
        switch (selectedFont) {
            case "Barokah":
                return fontSize / 2.4;
            case "Bettina":
                return fontSize / 1.7;
            default:
                return fontSize;
        }
    };

    const handleTextChange = (e) => {
        const newText = e.target.value;
        if (newText.length <= maxTextLength) {
            setText(newText);
        }
    };

    const handleFontChange = (e) => {
        setSelectedFont(e.target.value);
    };

    return (
        <div className="type-signature-container">
            <div className="type-signature-top-header">
                <div className="left-section">
                    {/* Text Input */}
                    <div className="type-signature-input-section">
                        <input id="signature-text" type="text" className="type-signature-input" value={text} onChange={handleTextChange} placeholder="Type your name here" autoFocus maxLength={maxTextLength} />
                        {maxTextLength && maxTextLength < 100 && (
                            <div className={`type-signature-char-counter ${text.length == maxTextLength ? "red" : ""}`}>
                                {text.length} / {maxTextLength} characters
                            </div>
                        )}
                    </div>
                </div>

                <div className="right-section">
                    {/* Font Family Select */}
                    {!hideFontStyle && (
                        <div className="type-signature-font-section" style={{ flex: 1 }}>
                            <select id="signature-font" className="type-signature-font-select" value={selectedFont} onChange={handleFontChange}>
                                {fonts.map((font) => (
                                    <option key={font} value={font}>
                                        {font}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="type-signature-style-row">
                        {/* Bold Button */}
                        {!hideBold && (
                            <button className={`type-signature-style-btn ${isBold ? "active" : ""}`} onClick={() => setIsBold(!isBold)} title="Bold">
                                <svg width="9" height="11" viewBox="0 0 9 11" fill="currentColor">
                                    <path d="M5.19531 5C6.39844 5.08854 7.29167 5.38802 7.875 5.89844C8.45833 6.40885 8.75 7.04688 8.75 7.8125C8.75 8.47917 8.55208 9.05469 8.15625 9.53906C7.76042 10.0182 7.2526 10.3333 6.63281 10.4844C6.01823 10.6302 5.19271 10.7031 4.15625 10.7031H0V10.3438H0.40625C0.859375 10.3438 1.17188 10.2865 1.34375 10.1719C1.52083 10.0573 1.63281 9.88021 1.67969 9.64062C1.72656 9.39583 1.75 8.83073 1.75 7.94531V2.78906C1.75 1.92969 1.72396 1.375 1.67188 1.125C1.625 0.875 1.52083 0.703125 1.35938 0.609375C1.20312 0.515625 0.856771 0.46875 0.320312 0.46875H0.117188V0.109375L1.85938 0.0625L3.84375 0C6.73958 0 8.1875 0.833333 8.1875 2.5C8.1875 3.1875 7.9375 3.73958 7.4375 4.15625C6.94271 4.57292 6.19531 4.85417 5.19531 5ZM3.28125 4.85156C3.41146 4.85677 3.52083 4.85938 3.60938 4.85938C4.73438 4.85938 5.5026 4.68229 5.91406 4.32812C6.32552 3.97396 6.53125 3.40104 6.53125 2.60938C6.53125 2.05729 6.45052 1.63021 6.28906 1.32812C6.1276 1.02604 5.88542 0.794271 5.5625 0.632812C5.23958 0.466146 4.6875 0.382812 3.90625 0.382812C3.70312 0.382812 3.49479 0.390625 3.28125 0.40625V4.85156ZM3.28125 5.23438V7.59375C3.28125 8.59896 3.29948 9.23698 3.33594 9.50781C3.3724 9.77865 3.46875 9.98438 3.625 10.125C3.78646 10.2656 4.10156 10.3359 4.57031 10.3359C5.40365 10.3359 6.02865 10.1224 6.44531 9.69531C6.86198 9.26823 7.07031 8.6276 7.07031 7.77344C7.07031 6.89844 6.83333 6.25521 6.35938 5.84375C5.89062 5.42708 5.0625 5.21875 3.875 5.21875C3.6875 5.21875 3.48958 5.22396 3.28125 5.23438Z" fill="currentColor" />
                                </svg>
                            </button>
                        )}

                        {/* Italic Button */}
                        {!hideItalic && (
                            <button className={`type-signature-style-btn ${isItalic ? "active" : ""}`} onClick={() => setIsItalic(!isItalic)} title="Italic">
                                <svg width="8" height="11" viewBox="0 0 8 11" fill="currentColor">
                                    <path d="M4.57812 10.2344L4.46875 10.5938H0L0.109375 10.2344H0.351562C0.674479 10.2344 0.947917 10.1771 1.17188 10.0625C1.39583 9.94271 1.54688 9.80729 1.625 9.65625C1.70833 9.5 1.82812 9.16146 1.98438 8.64062L4.02344 1.89844C4.1849 1.3776 4.26562 1.05208 4.26562 0.921875C4.26562 0.546875 3.92969 0.359375 3.25781 0.359375H2.97656L3.08594 0H7.25L7.14062 0.359375H6.92188C6.67188 0.359375 6.44531 0.403646 6.24219 0.492188C6.03906 0.580729 5.89323 0.703125 5.80469 0.859375C5.72135 1.01562 5.58073 1.41927 5.38281 2.07031L3.40625 8.5625C3.25521 9.05729 3.17969 9.36979 3.17969 9.5C3.17969 9.75521 3.28906 9.94271 3.50781 10.0625C3.73177 10.1771 3.98698 10.2344 4.27344 10.2344H4.57812Z" fill="currentColor" />
                                </svg>
                            </button>
                        )}

                        {/* Font Size Select below */}
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
                </div>
            </div>

            <div className="type-signature-preview-section">
                <div className="type-signature-preview" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }} ref={previewRef}>
                    {text ? (
                        <span
                            className="type-signature-preview-text"
                            style={{
                                fontFamily: `"${selectedFont}", ${hideFontStyle ? "sans-serif" : "cursive"}`,
                                fontWeight: isBold ? "bold" : "normal",
                                fontStyle: isItalic ? "italic" : "normal",
                                fontSize: `${adjustedFontSize(selectedFont, fontSize)}px`,
                            }}>
                            {text}
                        </span>
                    ) : (
                        <span className="type-signature-preview-placeholder">Your Signature will appear here</span>
                    )}
                </div>
            </div>

            {/* Hidden canvas for image generation */}
            <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
    );
};

export default TypeSignature;
