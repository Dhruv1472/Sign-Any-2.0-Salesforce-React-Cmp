import React, { useState, useEffect } from "react";
import "./FieldModal.css";

/**
 * FieldModal Component
 * Modal for capturing field values
 *
 * @param {boolean} isOpen - Controls modal visibility
 * @param {Function} onClose - Callback when modal is closed
 * @param {Function} onSave - Callback when field value is saved
 * @param {Object} field - Field configuration object
 */
const FieldModal = ({ isOpen, onClose, onSave, field }) => {
    const [value, setValue] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (isOpen && field) {
            // Initialize with existing value, or default value, or empty
            let initialValue = field.value !== undefined && field.value !== null 
                ? field.value 
                : (field.defaultValue !== undefined && field.defaultValue !== null
                    ? field.defaultValue
                    : (field.fieldType === "checkbox" ? false : ""));
            
            // Ensure it's a string if it should be a string
            if (field.fieldType !== "checkbox" && initialValue !== "") {
                initialValue = String(initialValue);
            }
            
            setValue(initialValue);
            setError("");
        }
    }, [isOpen, field]);

    if (!isOpen || !field) return null;

    const { fieldType, fieldName, required } = field;

    const handleSave = () => {
        // Validation
        if (required) {
            if (fieldType === "checkbox") {
                // Checkbox doesn't need validation for required
            } else if (!value || (typeof value === "string" && value.trim() === "")) {
                setError("This field is required");
                return;
            }
        }

        // Type-specific validation
        if (fieldType === "email" && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                setError("Please enter a valid email address");
                return;
            }
        }

        if (fieldType === "number" && value) {
            if (isNaN(value) || value === "") {
                setError("Please enter a valid number");
                return;
            }
        }

        let normalizedValue = value;
        if (fieldType === "initials" && typeof value === "string") {
            normalizedValue = value.trim().toUpperCase();
            if (required && normalizedValue === "") {
                setError("This field is required");
                return;
            }
        }

        if (onSave) {
            onSave(normalizedValue, field);
        }
        handleClose();
    };

    const handleClose = () => {
        setValue("");
        setError("");
        if (onClose) onClose();
    };

    const getTitle = () => {
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
                return "Checkbox";
            default:
                return "Fill Field";
        }
    };

    const renderFieldInput = () => {
        switch (fieldType) {
            case "text":
                return (
                    <input
                        type="text"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Enter text here"
                        autoFocus
                        maxLength={field.maxLength ? parseInt(field.maxLength, 10) : 100}
                    />
                );

            case "initials":
                return (
                    <input
                        type="text"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Enter initials here"
                        autoFocus
                        maxLength={5}
                    />
                );

            case "date":
                return (
                    <input
                        type="date"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        autoFocus
                    />
                );

            case "number":
                return (
                    <input
                        type="number"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Enter number here"
                        autoFocus
                    />
                );

            case "email":
                return (
                    <input
                        type="email"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Enter email address"
                        autoFocus
                    />
                );

            case "checkbox":
                return (
                    <div className="checkbox-input-container">
                        <label className="checkbox-label-input">
                            <input
                                type="checkbox"
                                checked={value || false}
                                onChange={(e) => setValue(e.target.checked)}
                                className="checkbox-input"
                            />
                            <span className="checkbox-label-text">{fieldName || "Check this box"}</span>
                        </label>
                    </div>
                );

            default:
                return (
                    <input
                        type="text"
                        className="field-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Enter value here"
                        autoFocus
                    />
                );
        }
    };

    return (
        <div className="field-modal-overlay" onClick={handleClose}>
            <div className="field-modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="field-modal-header">
                    <h2>{getTitle()}</h2>
                    <button className="field-modal-close" onClick={handleClose}>
                        ×
                    </button>
                </div>

                <div className="field-modal-content">
                    {renderFieldInput()}
                    {error && <div className="field-error">{error}</div>}
                    {required && <div className="field-required-hint">* This field is required</div>}
                </div>

                <div className="field-modal-footer">
                    <button className="field-btn-cancel" onClick={handleClose}>
                        Cancel
                    </button>
                    <button className="field-btn-save" onClick={handleSave}>
                        {fieldType === "checkbox" ? "Save" : "Save Value"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FieldModal;

