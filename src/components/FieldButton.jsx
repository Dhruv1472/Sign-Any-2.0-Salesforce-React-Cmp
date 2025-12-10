import React, { useState, useRef, useEffect } from "react";
import "./FieldButton.css";

/**
 * FieldButton Component
 * Renders field buttons or filled field values with inline editing for text fields
 *
 * @param {Object} field - Field configuration object
 * @param {Function} onFieldClick - Callback when field button is clicked
 * @param {Function} onDelete - Callback when delete button is clicked
 * @param {Function} onSave - Callback when inline edit is saved
 * @param {boolean} canDelete - Whether the delete button should be shown
 * @param {number} canvasScale - Scale factor for responsive sizing
 */
const FieldButton = ({ field, onFieldClick, onDelete, onSave, canDelete = false, disabled = false, canvasScale = 1 }) => {
    const { key, fieldName, fieldType, value, filled, disabled: fieldDisabled, required, readonly } = field;
    const isDisabled = Boolean(disabled || fieldDisabled || readonly);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [showLimitWarning, setShowLimitWarning] = useState(false);
    const inputRef = useRef(null);
    const warningTimeoutRef = useRef(null);

    // Get max length for the field
    const maxLength = field.maxLength ? parseInt(field.maxLength, 10) : 100;

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    // Cleanup warning timeout on unmount
    useEffect(() => {
        return () => {
            if (warningTimeoutRef.current) {
                clearTimeout(warningTimeoutRef.current);
            }
        };
    }, []);

    const handleFieldClick = () => {
        if (isDisabled) return;
        
        // For text and number fields, enable inline editing
        // Email, date, and initials use modal
        if (["text", "number"].includes(fieldType)) {
            // Prefill with existing value, defaultValue, or empty string
            const initialValue = value || field.defaultValue || "";
            setEditValue(initialValue);
            setIsEditing(true);
            return;
        }
        
        // For other fields (email, date, initials, checkbox), use the modal
        if (onFieldClick) {
            onFieldClick(field);
        }
    };

    const handleSaveInline = () => {
        if (required && (!editValue || editValue.trim() === "")) {
            alert("This field is required");
            return;
        }
        
        // Email validation
        if (fieldType === "email" && editValue && editValue.trim() !== "") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(editValue)) {
                alert("Please enter a valid email address");
                return;
            }
        }
        
        // Number validations and normalization
        if (fieldType === "number" && editValue && editValue.trim() !== "") {
            const raw = editValue.trim();
            // Disallow exponential notation if specified
            if (field.exponentialNotation === false && /e|E/.test(raw)) {
                alert("Exponential notation is not allowed");
                return;
            }

            let num = Number(raw.replace(/,/g, ""));
            if (Number.isNaN(num)) {
                alert("Please enter a valid number");
                return;
            }

            // allowNegative check
            if (field.allowNegative === false && num < 0) {
                alert("Negative numbers are not allowed");
                return;
            }

            // min/max
            if (field.min !== null && field.min !== undefined && num < Number(field.min)) {
                alert(`Value must be ≥ ${field.min}`);
                return;
            }
            if (field.max !== null && field.max !== undefined && num > Number(field.max)) {
                alert(`Value must be ≤ ${field.max}`);
                return;
            }

            // decimals limit
            if (field.decimals !== null && field.decimals !== undefined) {
                const decimals = parseInt(field.decimals, 10);
                const parts = String(raw).split(".");
                if (parts[1] && parts[1].length > decimals) {
                    alert(`Only ${decimals} decimal places allowed`);
                    return;
                }
                // Normalize decimals length when formatting
                if (field.currencyFormatting) {
                    const formatted = Number(num).toLocaleString(undefined, {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                    });
                    if (onSave) onSave(formatted, field);
                    setIsEditing(false);
                    return;
                }
            } else if (field.currencyFormatting) {
                const formatted = Number(num).toLocaleString(undefined, {
                    maximumFractionDigits: 20,
                });
                if (onSave) onSave(formatted, field);
                setIsEditing(false);
                return;
            }
        }
        
        if (onSave) {
            onSave(editValue, field);
        }
        setIsEditing(false);
    };

    const handleCancelInline = () => {
        setIsEditing(false);
        setEditValue("");
        setShowLimitWarning(false);
        if (warningTimeoutRef.current) {
            clearTimeout(warningTimeoutRef.current);
        }
    };

    const handleInputChange = (e) => {
        let newValue = e.target.value;

        // Email transforms
        if (fieldType === "email") {
            if (field.forceLowercase) {
                newValue = newValue.toLowerCase();
            }
            if (field.allowedCharacters) {
                // allowedCharacters is treated as a character class (e.g., A-Za-z0-9@._-)
                const re = new RegExp(`[^${field.allowedCharacters}]`, "g");
                newValue = newValue.replace(re, "");
            }
        }

        // Text multiline: enforce maxLines
        if (fieldType === "text" && field.multiline) {
            const lines = newValue.split(/\r?\n/);
            if (field.maxLines && lines.length > parseInt(field.maxLines, 10)) {
                newValue = lines.slice(0, parseInt(field.maxLines, 10)).join("\n");
            }
        }

        // Number input constraints
        if (fieldType === "number") {
            // Prevent illegal characters
            // Allow digits, dot, minus (if allowed), and commas (which we strip on save)
            const allowNeg = field.allowNegative !== false ? true : false;
            const cleaned = newValue
                .replace(/,/g, "")
                .replace(allowNeg ? /[^0-9.\-eE]/g : /[^0-9.]/g, "");
            newValue = cleaned;
        }
        
        // Check if trying to exceed max length
        if (newValue.length > maxLength) {
            // Show warning
            setShowLimitWarning(true);
            
            // Clear any existing timeout
            if (warningTimeoutRef.current) {
                clearTimeout(warningTimeoutRef.current);
            }
            
            // Hide warning after 3 seconds
            warningTimeoutRef.current = setTimeout(() => {
                setShowLimitWarning(false);
            }, 3000);
            
            // Don't update value beyond max length
            return;
        }
        
        setEditValue(newValue);
        
        // Hide warning if user is within limit
        if (showLimitWarning && newValue.length < maxLength) {
            setShowLimitWarning(false);
            if (warningTimeoutRef.current) {
                clearTimeout(warningTimeoutRef.current);
            }
        }
    };

    const handleKeyDown = (e) => {
        // Block unwanted keys for numbers
        if (fieldType === "number") {
            if (field.exponentialNotation === false && (e.key === "e" || e.key === "E")) {
                e.preventDefault();
                return;
            }
            if (field.allowNegative === false && (e.key === "-")) {
                e.preventDefault();
                return;
            }
        }

        if (e.key === "Enter" && !(fieldType === "text" && field.multiline)) {
            handleSaveInline();
        } else if (e.key === "Escape") {
            handleCancelInline();
        }
    };

    const handleBlur = () => {
        // Save on blur
        if (editValue.trim() !== "") {
            handleSaveInline();
        } else {
            handleCancelInline();
        }
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        if (onDelete) {
            onDelete(field);
        }
    };

    // If field is filled, show the value (for checkbox, false is a valid value)
    const hasValue = value !== null && value !== undefined && (fieldType === "checkbox" ? true : value !== "");
    if (filled && hasValue && !isEditing) {
        return (
            <div className={`field-container ${filled ? "filled" : ""}`} data-field={fieldType}>
                <div className="field-value" onClick={handleFieldClick}>
                    {fieldType === "checkbox" ? (
                        <div className="checkbox-display">
                            <span 
                                className={`checkbox-icon ${value ? "checked" : ""}`}
                                style={{
                                    width: `${16 * canvasScale}px`,
                                    height: `${16 * canvasScale}px`,
                                    fontSize: `${12 * canvasScale}px`,
                                    borderWidth: `${1 * canvasScale}px`
                                }}
                            >
                                {value ? "✓" : ""}
                            </span>
                            <span className="checkbox-label" style={{
                                fontSize: `${12 * canvasScale}px`
                            }}>{fieldName || "Checkbox"}</span>
                        </div>
                    ) : (
                        <div 
                            className="field-value-text" 
                            data-multiline={fieldType === "text" && field.multiline === true}
                            style={{
                                fontSize: `${15.16 * canvasScale -1.55}px`,
                                padding: `${4 * canvasScale}px`
                            }}
                        >
                            {value}
                        </div>
                    )}
                </div>
                {canDelete && fieldType !== "checkbox" && (
                    <button 
                        className="field-delete-btn" 
                        onClick={handleDeleteClick} 
                        title="Clear field"
                        style={{
                            top: `${2 * canvasScale}px`,
                            right: `${2 * canvasScale}px`,
                            width: `${20 * canvasScale}px`,
                            height: `${20 * canvasScale}px`,
                            fontSize: `${14 * canvasScale}px`
                        }}
                    >
                        ×
                    </button>
                )}
            </div>
        );
    }

    // For checkbox field type, render actual checkbox instead of button
    if (fieldType === "checkbox") {
        // Checkbox is checked if it's filled and value is true
        const isChecked = filled && (value === true || value === "true" || value === "True");
        return (
            <div className="checkbox-wrapper" onClick={handleFieldClick}>
                <input 
                    type="checkbox" 
                    checked={isChecked}
                    disabled={isDisabled}
                    readOnly
                    data-key={key}
                />
            </div>
        );
    }

    // If editing inline (text or number only - email uses modal)
    if (isEditing && ["text", "number"].includes(fieldType)) {
        const remainingChars = maxLength - editValue.length;
        const isNearLimit = remainingChars <= 10;
        const isAtLimit = remainingChars === 0;
        
        return (
            <div className="field-inline-edit">
                {fieldType === "text" && field.multiline ? (
                    <textarea
                        ref={inputRef}
                        className="field-inline-input"
                        value={editValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                        placeholder="Enter text..."
                        disabled={isDisabled}
                        maxLength={maxLength}
                        rows={field.maxLines ? parseInt(field.maxLines, 10) : 3}
                        style={{ resize: "vertical" }}
                    />
                ) : (
                    <input
                        ref={inputRef}
                        type={fieldType}
                        className="field-inline-input"
                        value={editValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                        placeholder={fieldType === "number" ? "Enter number..." : "Enter text..."}
                        disabled={isDisabled}
                        maxLength={maxLength}
                        step={fieldType === "number" && field.decimals !== undefined && field.decimals !== null ? (1 / Math.pow(10, parseInt(field.decimals, 10))).toFixed(parseInt(field.decimals, 10)) : undefined}
                        min={fieldType === "number" ? (field.allowNegative === false ? Math.max(0, field.min || 0) : (field.min ?? undefined)) : undefined}
                        max={fieldType === "number" ? (field.max ?? undefined) : undefined}
                    />
                )}
                {showLimitWarning && (
                    <div className="field-limit-warning">
                        Max character limit reached ({maxLength})
                    </div>
                )}
                {!showLimitWarning && isNearLimit && editValue.length > 0 && (
                    <div className={`field-char-counter ${isAtLimit ? 'at-limit' : ''}`}>
                        {remainingChars} character{remainingChars !== 1 ? 's' : ''} remaining
                    </div>
                )}
            </div>
        );
    }

    // Otherwise show the field button
    const getButtonText = () => {
        if (fieldName) return fieldName;
        switch (fieldType) {
            case "text":
                return "Enter Text";
            case "initials":
                return "Enter Initials";
            case "date":
                return "Select Date";
            case "number":
                return "Enter Number";
            case "email":
                return "Enter Email";
            case "checkbox":
                return "Check";
            default:
                return "Fill Field";
        }
    };

    const getButtonClass = () => {
        const baseClass = "field-button";
        const typeClass = `field-button-${fieldType}`;
        const requiredClass = required ? "field-button-required" : "";
        return `${baseClass} ${typeClass} ${requiredClass}`.trim();
    };

    return (
        <button 
            className={getButtonClass()} 
            onClick={handleFieldClick} 
            disabled={isDisabled} 
            data-key={key}
            style={{
                padding: `${8 * canvasScale}px ${12 * canvasScale}px`,
                borderWidth: `${2 * canvasScale}px`,
                fontSize: `${12 * canvasScale}px`,
                borderRadius: `${4 * canvasScale}px`
            }}
        >
            {getButtonText()}
            {required && <span className="required-indicator" style={{
                width: `${6 * canvasScale}px`,
                height: `${6 * canvasScale}px`,
                top: `${-2 * canvasScale}px`,
                right: `${-2 * canvasScale}px`
            }}></span>}
        </button>
    );
};

export default FieldButton;

