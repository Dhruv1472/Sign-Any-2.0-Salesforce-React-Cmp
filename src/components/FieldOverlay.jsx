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
 * @param {Function} onDelete - Callback when delete is clicked
 * @param {boolean} isSubmitted - Whether document has been submitted
 * @param {Set} sessionFilledKeys - Set of field keys filled in current session
 */
const FieldOverlay = ({ pageNumber, priority, fields, onFieldClick, onDelete, isSubmitted, sessionFilledKeys }) => {
    // Filter fields for this page and exclude hidden ones
    // IMPORTANT: Only show items that are actually fields (have fieldType property)
    const pageFields = fields.filter((field) => 
        field.fieldType && // Ensure it's a field, not a signature
        field.pageNumber === pageNumber && 
        (field.priority == priority || field.filled)
    );

    if (pageFields.length === 0) {
        return null;
    }

    return (
        <div className="field-overlay">
            {pageFields.map((field) => {
                // Show delete button only if:
                // 1. Document hasn't been submitted AND
                // 2. Field was filled in current session (not pre-existing)
                const canDelete = !isSubmitted && sessionFilledKeys.has(field.index);

                return (
                    <div
                        key={field.index}
                        className="field-position"
                        style={{
                            position: "absolute",
                            left: `${field.xPercent}%`,
                            top: `${field.yPercent}%`,
                            width: `${field.widthPercent}%`,
                            height: `${field.heightPercent}%`,
                        }}>
                        <FieldButton field={field} onFieldClick={onFieldClick} onDelete={onDelete} canDelete={canDelete} disabled={isSubmitted} />
                    </div>
                );
            })}
        </div>
    );
};

export default FieldOverlay;

