import React from "react";
import FieldButton from "./FieldButton";
import "./FieldOverlay.css";

/**
 * FieldOverlay Component
 * Renders field buttons/values overlaid on a PDF page
 *
 * @param {number} pageNumber - The page number (1-indexed)
 * @param {number} priority - The priority level for filtering fields
 * @param {Array} fields - Array of field configurations for this page
 * @param {Function} onFieldClick - Callback when field button is clicked
 * @param {Function} onFieldSave - Callback when inline field is saved
 * @param {Function} onDelete - Callback when delete is clicked
 * @param {boolean} isSubmitted - Whether document has been submitted
 * @param {Set} sessionFilledKeys - Set of field keys filled in current session
 * @param {number} canvasScale - Scale factor for responsive sizing
 * @param {Object} storedInitials - Stored initials data { signBase64, arrStored }
 * @param {Function} onReuseInitials - Callback when reusing stored initials
 * @param {boolean} sendEmailsSimultaneously - Whether emails are sent simultaneously (affects visibility rules)
 */
const FieldOverlay = ({ pageNumber, priority, fields, onFieldClick, onFieldSave, onDelete, isSubmitted, sessionFilledKeys, canvasScale = 1, storedInitials, onReuseInitials, sendEmailsSimultaneously = false }) => {
    // Filter fields for this page
    // Show: 1. Current priority fields (editable), 2. Lower priority filled fields (read-only)
    // When sendEmailsSimultaneously is true: Show ALL filled fields from any priority
    const pageFields = fields
        .filter((field) => {
            if (!field.fieldType) return false; // Ensure it's a field, not a signature
            if (field.pageNumber !== pageNumber) return false;

            const fieldPriority = field.signerPriority ?? field.priority;
            const isCurrentPriority = fieldPriority == priority;
            const isLowerPriority = fieldPriority < priority;
            const isHigherPriority = fieldPriority > priority;

            // If simultaneous emails mode: show all priorities' filled fields
            if (sendEmailsSimultaneously) {
                // Show current priority fields (all)
                if (isCurrentPriority) return true;
                // Show other priorities' filled fields only
                return (isLowerPriority || isHigherPriority) && field.filled;
            }

            // Sequential mode: don't show higher priority fields
            if (!isCurrentPriority && !isLowerPriority) {
                return false;
            }

            // Show current priority fields (all)
            if (isCurrentPriority) return true;

            // Show lower priority fields only if filled (already completed)
            return isLowerPriority && field.filled;
        })
        .map((field) => {
            const fieldPriority = field.signerPriority ?? field.priority;
            const isCurrentPriority = fieldPriority == priority;

            // Mark non-current priority fields as disabled (read-only)
            return {
                ...field,
                disabled: !isCurrentPriority || isSubmitted,
            };
        });

    if (pageFields.length === 0) {
        return null;
    }

    return (
        <div className="field-overlay">
            {pageFields.map((field) => {
                // Show delete button only if field belongs to current priority and was filled in current session
                const fieldPriority = field.signerPriority ?? field.priority;
                const isCurrentPriorityField = fieldPriority == priority;
                const canDelete = !isSubmitted && isCurrentPriorityField && sessionFilledKeys.has(field.index);

                return (
                    <div key={field.index} className="field-position" style={{ position: "absolute", left: `${field.xPercent}%`, top: `${field.yPercent}%`, width: `${field.widthPercent}%`, height: `${field.heightPercent}%` }}>
                        <FieldButton field={field} onFieldClick={onFieldClick} onSave={onFieldSave} onDelete={onDelete} canDelete={canDelete} disabled={field.disabled} canvasScale={canvasScale} storedInitials={storedInitials} onReuseInitials={onReuseInitials} />
                    </div>
                );
            })}
        </div>
    );
};

export default FieldOverlay;
