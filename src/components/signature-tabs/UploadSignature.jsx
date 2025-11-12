import React, { useState, useRef, useEffect } from "react";
import "./UploadSignature.css";

/**
 * UploadSignature Component
 * Image file upload for signature
 *
 * @param {Function} onChange - Callback when image is uploaded (receives base64 image)
 * @param {number} clearTrigger - Trigger to clear the upload
 */
const UploadSignature = ({ onChange, clearTrigger }) => {
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);

    // Clear upload when clearTrigger changes
    useEffect(() => {
        if (clearTrigger > 0) {
            setPreview(null);
            setError(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }, [clearTrigger]);

    const processFile = (file) => {
        if (!file) return;

        // Validate file type
        const validTypes = ["image/jpeg", "image/jpg", "image/png"];
        if (!validTypes.includes(file.type)) {
            setError("Please upload a JPG or PNG image");
            setPreview(null);
            if (onChange) onChange(null);
            return;
        }

        // Validate file size (max 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB in bytes
        if (file.size > maxSize) {
            setError("File size must be less than 5MB");
            setPreview(null);
            if (onChange) onChange(null);
            return;
        }

        // Clear error
        setError(null);

        // Read file and create preview
        const reader = new FileReader();
        reader.onload = (event) => {
            const imageData = event.target.result;
            setPreview(imageData);
            if (onChange) onChange(imageData);
        };
        reader.onerror = () => {
            setError("Failed to read file");
            setPreview(null);
            if (onChange) onChange(null);
        };
        reader.readAsDataURL(file);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        processFile(file);
    };

    const handleButtonClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInputRef.current?.click();
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            processFile(files[0]);
        }
    };

    return (
        <div className="upload-signature-container">
            {!preview && (
                <div className="upload-signature-instructions">
                    <p>Upload an image of your signature</p>
                    <p className="upload-signature-requirements">Accepted formats: JPG, PNG (max 5MB)</p>
                </div>
            )}

            <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png" onChange={handleFileSelect} className="upload-signature-input" style={{ display: "none" }} />

            {!preview ? (
                <div className={`upload-signature-dropzone ${isDragging ? "dragging" : ""}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop} onClick={handleButtonClick}>
                    <div className="upload-signature-dropzone-content">
                        <p className="upload-signature-dropzone-text">Drag and drop your signature image here</p>
                        <p className="upload-signature-dropzone-or">or</p>
                        <button className="upload-signature-select-btn" onClick={handleButtonClick}>
                            Choose File
                        </button>
                    </div>
                </div>
            ) : (
                <div className="upload-signature-preview-section">
                    <div className="upload-signature-preview">
                        <img src={preview} alt="Signature preview" className="upload-signature-preview-image" />
                    </div>
                    <div className="upload-signature-actions">
                        <button className="upload-signature-change-btn" onClick={handleButtonClick}>
                            Change Image
                        </button>
                    </div>
                </div>
            )}

            {error && <div className="upload-signature-error">{error}</div>}
        </div>
    );
};

export default UploadSignature;
