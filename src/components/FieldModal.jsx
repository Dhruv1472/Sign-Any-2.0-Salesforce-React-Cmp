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
            
            // Convert formatted date "Nov 21 2025" back to "YYYY-MM-DD" for date input
            if (field.fieldType === "date" && initialValue && typeof initialValue === "string") {
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const parts = initialValue.split(" ");
                if (parts.length === 3) {
                    const monthIndex = monthNames.indexOf(parts[0]);
                    if (monthIndex !== -1) {
                        const day = String(parts[1]).padStart(2, '0');
                        const year = parts[2];
                        const month = String(monthIndex + 1).padStart(2, '0');
                        initialValue = `${year}-${month}-${day}`;
                    }
                }
            }
            
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

    const formatDateByPattern = (dateObj, pattern) => {
        const pad2 = (n) => String(n).padStart(2, "0");
        const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const map = {
            YYYY: String(dateObj.getFullYear()),
            MM: pad2(dateObj.getMonth() + 1),
            DD: pad2(dateObj.getDate()),
            MMM: monthsShort[dateObj.getMonth()],
            MMMM: monthsLong[dateObj.getMonth()],
        };
        let out = pattern || "MMM DD YYYY";
        // Replace longer tokens first
        out = out.replace(/MMMM/g, map.MMMM);
        out = out.replace(/MMM/g, map.MMM);
        out = out.replace(/YYYY/g, map.YYYY);
        out = out.replace(/MM/g, map.MM);
        out = out.replace(/DD/g, map.DD);
        return out;
    };

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
            const raw = String(value).trim();
            if (field.exponentialNotation === false && /e|E/.test(raw)) {
                setError("Exponential notation is not allowed");
                return;
            }
            let num = Number(raw.replace(/,/g, ""));
            if (Number.isNaN(num)) {
                setError("Please enter a valid number");
                return;
            }
            if (field.allowNegative === false && num < 0) {
                setError("Negative numbers are not allowed");
                return;
            }
            if (field.min !== null && field.min !== undefined && num < Number(field.min)) {
                setError(`Value must be ≥ ${field.min}`);
                return;
            }
            if (field.max !== null && field.max !== undefined && num > Number(field.max)) {
                setError(`Value must be ≤ ${field.max}`);
                return;
            }
            if (field.decimals !== null && field.decimals !== undefined) {
                const decimals = parseInt(field.decimals, 10);
                const parts = String(raw).split(".");
                if (parts[1] && parts[1].length > decimals) {
                    setError(`Only ${decimals} decimal places allowed`);
                    return;
                }
            }
        }

        // Date validation with min/max
        if (fieldType === "date" && value) {
            const selectedDate = new Date(value);
            
            const minStr = field.minDate || field.min;
            const maxStr = field.maxDate || field.max;

            if (minStr) {
                const minDate = new Date(minStr);
                if (selectedDate < minDate) {
                    setError(`Date must be on or after ${minStr}`);
                    return;
                }
            }
            
            if (maxStr) {
                const maxDate = new Date(maxStr);
                if (selectedDate > maxDate) {
                    setError(`Date must be on or before ${maxStr}`);
                    return;
                }
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

        // Format date based on dateFormat/customDateFormat (fallback to "MMM DD YYYY")
        if (fieldType === "date" && value) {
            const dateObj = new Date(value);
            const pattern = field.customDateFormat || field.dateFormat || "MMM DD YYYY";
            normalizedValue = formatDateByPattern(dateObj, pattern);
        }

        // Currency formatting on number (applied after validation)
        if (fieldType === "number" && value) {
            let num = Number(String(value).replace(/,/g, ""));
            if (!Number.isNaN(num) && field.currencyFormatting) {
                if (field.decimals !== null && field.decimals !== undefined) {
                    const decimals = parseInt(field.decimals, 10);
                    normalizedValue = Number(num).toLocaleString(undefined, {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                    });
                } else {
                    normalizedValue = Number(num).toLocaleString();
                }
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
                if (field.multiline) {
                    return (
                        <textarea
                            className="field-input"
                            value={value}
                            onChange={(e) => {
                                let v = e.target.value;
                                if (field.maxLines) {
                                    const maxL = parseInt(field.maxLines, 10);
                                    const lines = v.split(/\r?\n/);
                                    if (lines.length > maxL) v = lines.slice(0, maxL).join("\n");
                                }
                                setValue(v);
                            }}
                            placeholder="Enter text here"
                            autoFocus
                            rows={field.maxLines ? parseInt(field.maxLines, 10) : 3}
                            maxLength={field.maxLength ? parseInt(field.maxLength, 10) : 100}
                            style={{ resize: "vertical" }}
                        />
                    );
                }
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
                        min={field.minDate || field.min || undefined}
                        max={field.maxDate || field.max || undefined}
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
                        maxLength={field.maxLength ? parseInt(field.maxLength, 10) : undefined}
                        step={field.decimals !== undefined && field.decimals !== null ? (1 / Math.pow(10, parseInt(field.decimals, 10))).toFixed(parseInt(field.decimals, 10)) : undefined}
                        min={field.allowNegative === false ? Math.max(0, field.min || 0) : (field.min ?? undefined)}
                        max={field.max ?? undefined}
                    />
                );

            case "email":
                return (
                    <input
                        type="email"
                        className="field-input"
                        value={value}
                        onChange={(e) => {
                            let v = e.target.value;
                            if (field.forceLowercase) v = v.toLowerCase();
                            if (field.allowedCharacters) {
                                const re = new RegExp(`[^${field.allowedCharacters}]`, "g");
                                v = v.replace(re, "");
                            }
                            setValue(v);
                        }}
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

