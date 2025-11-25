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
    const { key, fieldName, fieldType, value, filled, disabled: fieldDisabled, required } = field;
    const isDisabled = Boolean(disabled || fieldDisabled);
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
        
        // For text fields, enable inline editing
        if (fieldType === "text") {
            // Prefill with existing value, defaultValue, or empty string
            const initialValue = value || field.defaultValue || "";
            setEditValue(initialValue);
            setIsEditing(true);
            return;
        }
        
        // For other fields, use the modal
        if (onFieldClick) {
            onFieldClick(field);
        }
    };

    const handleSaveInline = () => {
        if (required && (!editValue || editValue.trim() === "")) {
            alert("This field is required");
            return;
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
        const newValue = e.target.value;
        
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
        if (e.key === "Enter") {
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
                        <div className="field-value-text" style={{
                            fontSize: `${12 * canvasScale}px`,
                            padding: `${4 * canvasScale}px`
                        }}>
                            {fieldType === "date" && value ? new Date(value).toLocaleDateString() : value}
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

    // If editing inline (text field)
    if (isEditing && fieldType === "text") {
        const remainingChars = maxLength - editValue.length;
        const isNearLimit = remainingChars <= 10;
        const isAtLimit = remainingChars === 0;
        
        return (
            <div className="field-inline-edit">
                <input
                    ref={inputRef}
                    type="text"
                    className="field-inline-input"
                    value={editValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    placeholder="Enter text..."
                    disabled={isDisabled}
                    maxLength={maxLength}
                />
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

