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

    const parseLocalDate = (str) => {
        const [year, month, day] = str.split("-").map(Number);
        return new Date(year, month - 1, day); // local midnight, no UTC shift
    };

    const toYyyyMmDd = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    };

    const coerceBoolean = (v, fallback = true) => {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (s === "true") return true;
            if (s === "false") return false;
        }
        return fallback;
    };

    const getDateInputBounds = (f) => {
        const today = new Date();
        const todayStr = toYyyyMmDd(today);

        // Default behavior keeps existing flow unchanged when flags are missing.
        const allowPastDates = coerceBoolean(f?.allowPastDates, true);
        const allowFutureDates = coerceBoolean(f?.allowFutureDates, true);

        let minDate = f?.minDate || f?.min || undefined;
        let maxDate = f?.maxDate || f?.max || undefined;

        if (!allowPastDates) {
            minDate = !minDate || minDate < todayStr ? todayStr : minDate;
        }

        if (!allowFutureDates) {
            maxDate = !maxDate || maxDate > todayStr ? todayStr : maxDate;
        }

        return { minDate, maxDate, allowPastDates, allowFutureDates, todayStr };
    };

    useEffect(() => {
        if (isOpen && field) {
            // Initialize with existing value, or default value, or empty
            let initialValue = field.value !== undefined && field.value !== null ? field.value : field.defaultValue !== undefined && field.defaultValue !== null ? field.defaultValue : field.fieldType === "checkbox" ? false : "";

            // Convert formatted date "Nov 21 2025" back to "YYYY-MM-DD" for date input
            if (field.fieldType === "date" && initialValue && typeof initialValue === "string") {
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const parts = initialValue.split(" ");
                if (parts.length === 3) {
                    const monthIndex = monthNames.indexOf(parts[0]);
                    if (monthIndex !== -1) {
                        const day = String(parts[1]).padStart(2, "0");
                        const year = parts[2];
                        const month = String(monthIndex + 1).padStart(2, "0");
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

    const { fieldType, fieldName, required, readonly } = field;
    const isReadOnly = Boolean(readonly);

    const formatDateByPattern = (dateObj, pattern) => {
        const pad2 = (n) => String(n).padStart(2, "0");
        const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const date = dateObj.getDate();
        const month = dateObj.getMonth();
        const year = dateObj.getFullYear();
        
        const map = {
            YYYY: String(year),
            YY: String(year).slice(-2),
            MMMM: monthsLong[month],
            MMM: monthsShort[month],
            MM: pad2(month + 1),
            M: String(month + 1),
            DD: pad2(date),
            D: String(date),
        };
        
        let out = pattern || "MMM DD YYYY";
        // Replace all tokens in one pass, matching longest first
        out = out.replace(/YYYY|MMMM|MMM|MM|YY|DD|M|D/g, (match) => {
            return map[match] || match;
        });
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
            const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
            const emailValue = typeof value === "string" ? value.trim() : String(value).trim();
            if (!emailRegex.test(emailValue)) {
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
            const selectedDate = parseLocalDate(value);

            const { minDate, maxDate, allowPastDates, allowFutureDates, todayStr } = getDateInputBounds(field);
            const todayDate = parseLocalDate(todayStr);

            if (!allowPastDates && selectedDate < todayDate) {
                setError("Past dates are not allowed");
                return;
            }

            if (!allowFutureDates && selectedDate > todayDate) {
                setError("Future dates are not allowed");
                return;
            }

            if (minDate) {
                const minDateObj = parseLocalDate(minDate);
                if (selectedDate < minDateObj) {
                    setError(`Date must be on or after ${minDate}`);
                    return;
                }
            }

            if (maxDate) {
                const maxDateObj = parseLocalDate(maxDate);
                if (selectedDate > maxDateObj) {
                    setError(`Date must be on or before ${maxDate}`);
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
            const dateObj = parseLocalDate(value);
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
                            autoFocus={!isReadOnly}
                            rows={field.maxLines ? parseInt(field.maxLines, 10) : 3}
                            maxLength={field.maxLength ? parseInt(field.maxLength, 10) : 100}
                            style={{ resize: "vertical" }}
                            readOnly={isReadOnly}
                            disabled={isReadOnly}
                        />
                    );
                }
                return <input type="text" className="field-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Enter text here" autoFocus={!isReadOnly} maxLength={field.maxLength ? parseInt(field.maxLength, 10) : 100} readOnly={isReadOnly} disabled={isReadOnly} />;

            case "initials":
                return <input type="text" className="field-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Enter initials here" autoFocus maxLength={5} />;

            case "date": {
                const { minDate, maxDate } = getDateInputBounds(field);
                return <input type="date" className="field-input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!isReadOnly} min={minDate} max={maxDate} readOnly={isReadOnly} disabled={isReadOnly} />;
            }

            case "number":
                return <input type="number" className="field-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Enter number here" autoFocus={!isReadOnly} maxLength={field.maxLength ? parseInt(field.maxLength, 10) : undefined} step={field.decimals !== undefined && field.decimals !== null ? (1 / Math.pow(10, parseInt(field.decimals, 10))).toFixed(parseInt(field.decimals, 10)) : undefined} min={field.allowNegative === false ? Math.max(0, field.min || 0) : field.min ?? undefined} max={field.max ?? undefined} readOnly={isReadOnly} disabled={isReadOnly} />;

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
                        autoFocus={!isReadOnly}
                        readOnly={isReadOnly}
                        disabled={isReadOnly}
                    />
                );

            case "checkbox":
                return (
                    <div className="checkbox-input-container">
                        <label className="checkbox-label-input">
                            <input type="checkbox" checked={value || false} onChange={(e) => setValue(e.target.checked)} className="checkbox-input" disabled={isReadOnly} />
                        </label>
                    </div>
                );

            default:
                return <input type="text" className="field-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Enter value here" autoFocus />;
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
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"></path>
                            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" stroke-width="0.5"></path>
                        </svg>
                        Cancel
                    </button>
                    <button className="field-btn-save" onClick={handleSave}>
                        <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
                            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" stroke-width="0.8" stroke="currentColor"></path>
                        </svg>
                        {fieldType === "checkbox" ? "Save" : "Save Value"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FieldModal;
