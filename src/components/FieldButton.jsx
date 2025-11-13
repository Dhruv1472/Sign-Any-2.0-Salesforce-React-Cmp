import React from "react";
import "./FieldButton.css";

/**
 * FieldButton Component
 * Renders field buttons or filled field values
 *
 * @param {Object} field - Field configuration object
 * @param {Function} onFieldClick - Callback when field button is clicked
 * @param {Function} onDelete - Callback when delete button is clicked
 * @param {boolean} canDelete - Whether the delete button should be shown
 */
const FieldButton = ({ field, onFieldClick, onDelete, canDelete = false, disabled = false }) => {
    const { key, fieldName, fieldType, value, filled, disabled: fieldDisabled, required } = field;
    const isDisabled = Boolean(disabled || fieldDisabled);

    const handleFieldClick = () => {
        if (isDisabled) return;
        if (onFieldClick) {
            onFieldClick(field);
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
    if (filled && hasValue) {
        return (
            <div className={`field-container ${filled ? "filled" : ""}`}>
                <div className="field-value" onClick={handleFieldClick}>
                    {fieldType === "checkbox" ? (
                        <div className="checkbox-display">
                            <span className={`checkbox-icon ${value ? "checked" : ""}`}>
                                {value ? "✓" : ""}
                            </span>
                            <span className="checkbox-label">{fieldName || "Checkbox"}</span>
                        </div>
                    ) : (
                        <div className="field-value-text">
                            {fieldType === "date" && value ? new Date(value).toLocaleDateString() : value}
                        </div>
                    )}
                </div>
                {canDelete && (
                    <button className="field-delete-btn" onClick={handleDeleteClick} title="Clear field">
                        ×
                    </button>
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
        <button className={getButtonClass()} onClick={handleFieldClick} disabled={isDisabled} data-key={key}>
            {getButtonText()}
            {required && <span className="required-indicator">*</span>}
        </button>
    );
};

export default FieldButton;

