import { useState, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Buffer } from "buffer";
import "./pdfjs/pdf.worker.min.mjs";
import "./App.css";
import SignatureOverlay from "./components/SignatureOverlay";
import SignatureModal from "./components/SignatureModal";
import FieldOverlay from "./components/FieldOverlay";
import FieldModal from "./components/FieldModal";
import Toast from "./components/Toast";
import { updateSignatureWithImage, deleteSignatureImage, updateFieldWithValue, deleteFieldValue } from "./utils/signatureUtils";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";

const A4_WIDTH = 595;
const A4_HEIGHT = 842;

function App() {
    const [pdfFile, setPdfFile] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isExpired, setIsExpired] = useState(false);
    const [initialAccepted, setInitialAccepted] = useState(false);
    const [signatureData, setSignatureData] = useState([]);
    const [fieldData, setFieldData] = useState([]);
    const [documentRecord, setDocumentRecord] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
    const [currentSignature, setCurrentSignature] = useState(null);
    const [currentField, setCurrentField] = useState(null);
    const [toast, setToast] = useState({ isVisible: false, message: "", type: "success" });
    const [salesforceConfig, setSalesforceConfig] = useState(null);
    const [urlPriority, setUrlPriority] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [sessionSignedKeys, setSessionSignedKeys] = useState(new Set());
    const [sessionFilledKeys, setSessionFilledKeys] = useState(new Set());
    const [originalPdfBytes, setOriginalPdfBytes] = useState(null);
    const [initialSignatureData, setInitialSignatureData] = useState([]);
    const [orgIdState, setOrgIdState] = useState(null);
    const canvasRefsArray = useRef([]);
    const pdfDocRef = useRef(null);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const accessToken = urlParams.get("act");
        const recordId = urlParams.get("recordId");
        const instanceUrl = urlParams.get("instanceUrl");
        const clientId = urlParams.get("clientId");
        const clientSecret = urlParams.get("clientSecret");
        const priority = urlParams.get("priority");

        const parsedPriority = priority ? parseInt(priority, 10) : 1;
        setUrlPriority(parsedPriority);

        if (recordId && instanceUrl) {
            setSalesforceConfig({ accessToken, recordId, instanceUrl, clientId, clientSecret });
            fetchDocumentAndPdf(recordId, accessToken, instanceUrl, clientId, clientSecret);

            fetchOrganizationId(accessToken, instanceUrl, clientId, clientSecret)
                .then((id) => setOrgIdState(id))
                .catch(() => setOrgIdState(null));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Main function to fetch Document and then PDF
    const fetchDocumentAndPdf = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        setLoading(true);
        setError(null);
        setIsExpired(false);

        try {
            // Step 1: Fetch Document__c record to get ContentVersion ID and signature/field data
            const { contentVersionId, currentToken, documentData, signatureData: sigData, fieldData: fieldDataFromRecord, isExpired: documentExpired } = await fetchDocumentRecord(documentId, accessToken, instanceUrl, clientId, clientSecret);

            // Check if document is expired
            if (documentExpired) {
                setIsExpired(true);
                setPdfFile(null);
                setTotalPages(0);
                pdfDocRef.current = null;
                canvasRefsArray.current = [];
                setLoading(false);
                return;
            }

            setDocumentRecord(documentData);
            const signatures = Array.isArray(sigData) ? sigData : [];
            const fields = Array.isArray(fieldDataFromRecord) ? fieldDataFromRecord : [];
            setSignatureData(signatures);
            setFieldData(fields);
            setInitialSignatureData(JSON.parse(JSON.stringify(signatures)));

            // Step 2: Fetch PDF from ContentVersion
            await fetchPdfFromContentVersion(contentVersionId, currentToken, instanceUrl);
        } catch (error) {
            console.error("Error in fetchDocumentAndPdf:", error);
            setError(`Failed to load document: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Fetch Document__c record to get ContentVersion ID
    const fetchDocumentRecord = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            // Salesforce REST API endpoint to get Document__c record
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(`SELECT Id, Uploaded_Document_Id__c, Signing_Details__c, Status__c, CreatedDate, CreatedBy.Name, CreatedBy.Email, Email_Subject__c, Document_Name__c, Expiration_Date__c FROM Document__c WHERE Id='${documentId}' LIMIT 1`)}`;

            let response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
            });

            // If token expired (401), try to refresh it
            if (response.status === 401 && clientId && clientSecret) {
                console.log("Access token expired, attempting to refresh...");
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                // Retry the request with new token
                response = await fetch(apiUrl, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch Document record: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const documentData = data.records[0];

            // Check if document is expired
            if (documentData.Expiration_Date__c) {
                const expirationDate = new Date(documentData.Expiration_Date__c);
                const today = new Date();
                // Set time to start of day for fair comparison
                today.setHours(0, 0, 0, 0);
                expirationDate.setHours(0, 0, 0, 0);

                if (expirationDate < today) {
                    setIsExpired(true);
                    setError(null);
                    return { isExpired: true };
                }
            }

            const contentVersionId = documentData.Uploaded_Document_Id__c;
            const signatureDataJson = documentData.Signing_Details__c;

            if (!contentVersionId) {
                throw new Error("Uploaded_Document_Id__c field is empty in Document__c record");
            }

            // Parse signature and field data if available
            let parsedSignatureData = [];
            let parsedFieldData = [];
            if (signatureDataJson) {
                try {
                    const parsedData = JSON.parse(signatureDataJson);
                    if (Array.isArray(parsedData)) {
                        parsedData.forEach((entry) => {
                            // Check if entry has nested fields (new structure)
                            if (entry.fields && Array.isArray(entry.fields)) {
                                // Check if any field in this entry is a signature type
                                const hasSignatureFields = entry.fields.some((field) => {
                                    const typeLower = typeof field.type === "string" ? field.type.toLowerCase() : "";
                                    const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(typeLower);
                                    const isSignatureType = ["signature"].includes(typeLower) || (!isFieldType && !field.fieldType);
                                    return isSignatureType;
                                });

                                // If this entry has signature fields, add the entire entry once
                                // All fields (signature + text/date/etc) stay together in nested structure
                                if (hasSignatureFields) {
                                    parsedSignatureData.push({
                                        ...entry,
                                        signed: Boolean(entry.signed),
                                    });
                                }
                                
                                // DO NOT extract text fields from nested structure to fieldData
                                // They will be rendered by SignatureOverlay along with signature fields
                            } else {
                                // Old flat structure (backward compatibility)
                                const typeLower = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
                                const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(typeLower);
                                const isSignatureType = ["signature"].includes(typeLower) || (!isFieldType && !entry.fieldType);
                                if (isFieldType) {
                                    parsedFieldData.push({
                                        ...entry,
                                        fieldType: typeLower,
                                        filled: Boolean(entry.filled),
                                    });
                                } else if (isSignatureType) {
                                    parsedSignatureData.push({
                                        ...entry,
                                        signed: Boolean(entry.signed),
                                    });
                                }
                            }
                        });
                    }
                } catch (parseError) {
                    console.warn("Failed to parse Signing_Details__c:", parseError);
                }
            }

            // Fetch Signature__c records to get imageUrl data
            const signatureRecords = await fetchSignatureRecords(documentId, currentToken, instanceUrl, clientId, clientSecret);

            const signatureMap = new Map();
            signatureRecords.forEach((record) => {
                try {
                    const sigDetails = JSON.parse(record.Signing_Details__c);
                    const fieldIndexStr = String(record.Field_Index__c);
                    signatureMap.set(fieldIndexStr, sigDetails);
                } catch (error) {
                    console.warn(`Failed to parse Signature record ${record.Id}:`, error);
                }
            });

            const consumedLegacyKeys = new Set();
            const sortedSignatureData = [...parsedSignatureData].sort((a, b) => a.priority - b.priority);
            
            parsedSignatureData = sortedSignatureData.map((sig) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    return {
                        ...sig,
                        fields: sig.fields.map((field) => {
                            const compositeKey = `${String(sig.priority)}_${String(field.index)}`;
                            const legacyKey = String(field.index);
                            let sigData = signatureMap.get(compositeKey);
                            
                            if (!sigData && field.filled && !consumedLegacyKeys.has(legacyKey)) {
                                sigData = signatureMap.get(legacyKey);
                                if (sigData) {
                                    consumedLegacyKeys.add(legacyKey);
                                }
                            }
                            
                            if (sigData) {
                                return {
                                    ...field,
                                    imageUrl: sigData.imageUrl || null,
                                    ipAddress: sigData.ipAddress || field.ipAddress || "",
                                    timestamp: sigData.timestamp || field.timestamp || "",
                                    filled: Boolean(sigData.imageUrl),
                                };
                            }
                            return field;
                        }),
                    };
                }
                return sig;
            });

            return { contentVersionId, currentToken, documentData, signatureData: parsedSignatureData, fieldData: parsedFieldData, isExpired: false };
        } catch (error) {
            console.error("Error fetching Document record:", error);
            throw error;
        }
    };

    // Fetch PDF from Salesforce ContentVersion
    const fetchPdfFromContentVersion = async (contentVersionId, accessToken, instanceUrl) => {
        try {
            // Salesforce REST API endpoint to get ContentVersion
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentVersion/${contentVersionId}/VersionData`;

            const response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/pdf",
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Create a copy for pdf-lib before pdfjs consumes the original
            const arrayBufferCopy = arrayBuffer.slice(0);
            setOriginalPdfBytes(arrayBufferCopy);

            // Pass original to pdfjs (it will consume/detach this buffer)
            await loadPdfFromArrayBuffer(arrayBuffer, `Document_${contentVersionId}.pdf`);
        } catch (error) {
            console.error("Error fetching PDF from ContentVersion:", error);
            throw error;
        }
    };

    // Load PDF from array buffer
    const loadPdfFromArrayBuffer = async (arrayBuffer, fileName = "document.pdf") => {
        try {
            const typedArray = new Uint8Array(arrayBuffer);
            const loadingTask = pdfjsLib.getDocument(typedArray);
            const pdf = await loadingTask.promise;
            pdfDocRef.current = pdf;
            setTotalPages(pdf.numPages);
            setPdfFile(fileName);
            setError(null);
        } catch (error) {
            console.error("Error loading PDF:", error);
            setError("Error loading PDF file");
        }
    };

    // Fetch Salesforce Organization Id
    const fetchOrganizationId = async (accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent("SELECT Id FROM Organization LIMIT 1")}`;

            let response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
            });

            if (response.status === 401 && clientId && clientSecret) {
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);
                response = await fetch(apiUrl, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch Organization Id: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const id = data?.records?.[0]?.Id || null;
            return id;
        } catch (e) {
            console.warn("Unable to fetch Organization Id:", e);
            return null;
        }
    };

    const handleSignatureClick = (signature) => {
        if (isSubmitted) return;
        setCurrentSignature(signature);
        setIsModalOpen(true);
    };

    // Handle modal close
    const handleModalClose = () => {
        setIsModalOpen(false);
        setCurrentSignature(null);
    };

    const handleSignatureSave = async (imageData, signature, signatureType) => {
        if (signature.fieldType) {
            console.error("Attempted to save signature image to a field:", signature);
            return;
        }

        try {
            // 1. Get user's public IP address
            const ipRes = await fetch("https://api.ipify.org?format=json");
            const ipData = await ipRes.json();
            const ipAddress = ipData.ip;

            const timeStamp = new Date().toLocaleString();
            const userAgent = navigator.userAgent || "Unknown Device";

            const osMatch = userAgent.match(/\(([^;]+);/);
            const osVersion = osMatch ? osMatch[1].trim() : "Unknown OS";

            const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
            const chromeVersion = chromeMatch ? chromeMatch[1] : "Unknown Chrome Version";

            const deviceInfo = `${osVersion} Chrome/${chromeVersion}`;

            const locationInfo = await getLocationLive();
            const signerObject = signature._parentSigner;

            let updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData, signature.type, signerObject);

            // 3. Insert ipAddress in the correct signer's fields only
            updatedSignatures = updatedSignatures.map((sig) => {
                // Only update the fields if this is the correct signer
                if (sig.fields && Array.isArray(sig.fields)) {
                    const isCorrectSigner = signerObject && (sig.priority === signerObject.priority || sig.email === signerObject.email);
                    if (isCorrectSigner) {
                        return {
                            ...sig,
                            fields: sig.fields.map((field) => {
                                if (field.index === signature.index) {
                                    return { ...field, ipAddress, deviceInfo, locationInfo, timeStamp, signatureType, filled: true };
                                }
                                return field;
                            }),
                        };
                    }
                }
                return sig;
            });

            setSignatureData(updatedSignatures);
            setSessionSignedKeys((prev) => new Set(prev).add(signature.index));
        } catch (e) {
            console.warn("Could not fetch IP address:", e);
            // Fallback: Just update without IP

            // Get the parent signer object (attached in handleSignatureClick)
            const signerObject = signature._parentSigner;

            const updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData, signature.type, signerObject);
            setSignatureData(updatedSignatures);
            setSessionSignedKeys((prev) => new Set(prev).add(signature.index));
        }
    };

    // Handle field modal close
    const handleFieldModalClose = () => {
        setIsFieldModalOpen(false);
        setCurrentField(null);
    };

    const handleFieldSave = (value, field) => {
        if (!field.fieldType) {
            console.error("Attempted to save field value to a signature:", field);
            return;
        }
        const updatedFields = updateFieldWithValue(fieldData, field.index, value, field.fieldType || field.type);
        setFieldData(updatedFields);

        // Track that this field was filled in the current session
        setSessionFilledKeys((prev) => new Set(prev).add(field.index));
    };

    const handleFieldDelete = (field) => {
        const updatedFields = deleteFieldValue(fieldData, field.index, field.fieldType || field.type);
        setFieldData(updatedFields);

        // Remove from session filled keys
        setSessionFilledKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(field.index);
            return newSet;
        });
    };

    // Close toast
    const handleCloseToast = () => {
        setToast({ isVisible: false, message: "", type: "success" });
    };

    const handleSignatureDelete = (signature) => {
        const signerObject = signature._parentSigner;

        const updatedSignatures = deleteSignatureImage(signatureData, signature.index, signature.type, signerObject);
        setSignatureData(updatedSignatures);

        // Remove from session signed keys
        setSessionSignedKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(signature.index);
            return newSet;
        });
    };

    const handleFieldClick = (field) => {
        if (isSubmitted) return;
        // For checkbox, toggle directly without opening modal
        const fType = (field.fieldType || field.type || "").toLowerCase();
        if (fType === "checkbox") {
            const current = field.value === true || field.value === "true" || field.value === "True";
            if (current) {
                const updated = deleteFieldValue(fieldData, field.index, "checkbox");
                setFieldData(updated);
                setSessionFilledKeys((prev) => {
                    const s = new Set(prev);
                    s.delete(field.index);
                    return s;
                });
            } else {
                const updated = updateFieldWithValue(fieldData, field.index, true, "checkbox");
                setFieldData(updated);
                setSessionFilledKeys((prev) => new Set(prev).add(field.index));
            }
            return;
        }
        // Otherwise open modal
        setCurrentField(field);
        setIsFieldModalOpen(true);
    };

    // Handle Save & Submit
    const handleSaveAndSubmit = async () => {
        // Validate if all signature fields are filled for current priority
        const unfilledFields = signatureData
            .filter((sig) => sig.priority == urlPriority)
            .flatMap((sig) => sig.fields || [])
            .filter((field) => !field.filled);

        if (unfilledFields.length > 0) {
            // Show error toast
            setToast({
                isVisible: true,
                message: `Please complete all signatures. ${unfilledFields.length} signature(s) remaining.`,
                type: "error",
            });
        } else {
            try {
                // All signatures are completed
                if (!originalPdfBytes) {
                    throw new Error("Original PDF data not available");
                }

                // Load the original PDF using pdf-lib
                const pdfDoc = await PDFDocument.load(originalPdfBytes);
                const pages = pdfDoc.getPages();

                // Get all filled signature fields across all signatures
                const filledFieldsNew = signatureData.flatMap((sig) => sig.fields || []).filter((field) => field.filled && field.imageUrl);

                // Process each signature field
                for (const field of filledFieldsNew) {
                    try {
                        const pageIndex = field.pageNumber - 1; // Convert to 0-indexed
                        if (pageIndex < 0 || pageIndex >= pages.length) {
                            console.warn(`Invalid page number ${field.pageNumber} for field ${field.index}`);
                            continue;
                        }

                        const page = pages[pageIndex];
                        const { width: pageWidth, height: pageHeight } = page.getSize();

                        // Convert base64 image to bytes
                        const imageBytes = await fetch(field.imageUrl).then((res) => res.arrayBuffer());

                        // Embed image in PDF (supports PNG and JPEG)
                        let image;
                        if (field.imageUrl.startsWith("data:image/png")) {
                            image = await pdfDoc.embedPng(imageBytes);
                        } else if (field.imageUrl.startsWith("data:image/jpeg") || field.imageUrl.startsWith("data:image/jpg")) {
                            image = await pdfDoc.embedJpg(imageBytes);
                        } else {
                            // Default to PNG
                            image = await pdfDoc.embedPng(imageBytes);
                        }

                        // Use percentage-based coordinates from the field data
                        const pdfX = (field.xPercent / 100) * pageWidth;
                        const pdfY = pageHeight - (field.yPercent / 100) * pageHeight - (field.heightPercent / 100) * pageHeight;
                        const pdfWidth = (field.widthPercent / 100) * pageWidth;
                        const pdfHeight = (field.heightPercent / 100) * pageHeight;

                        // Draw the image on the page
                        page.drawImage(image, {
                            x: pdfX,
                            y: pdfY,
                            width: pdfWidth,
                            height: pdfHeight,
                        });
                    } catch (error) {
                        console.error("Error adding signature to PDF:", field.index, error);
                    }
                }

                // Get all filled fields (check both filled flag and value presence)
                const filledFields = fieldData.filter((field) => {
                    const hasValue = field.value !== null && field.value !== undefined && field.value !== "";
                    // For checkbox, false is a valid value
                    if (field.fieldType === "checkbox") {
                        return hasValue || field.value === false;
                    }
                    return (field.filled || hasValue) && hasValue;
                });

                // Embed font for text rendering
                const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

                // Process each form field
                for (const field of filledFields) {
                    try {
                        const pageIndex = field.pageNumber - 1; // Convert to 0-indexed
                        if (pageIndex < 0 || pageIndex >= pages.length) {
                            console.warn(`Invalid page number ${field.pageNumber} for field ${field.index}`);
                            continue;
                        }

                        const page = pages[pageIndex];
                        const { width: pageWidth, height: pageHeight } = page.getSize();

                        // Use percentage-based coordinates from the field data
                        const pdfX = (field.xPercent / 100) * pageWidth;
                        const pdfY = pageHeight - (field.yPercent / 100) * pageHeight - (field.heightPercent / 100) * pageHeight;
                        const pdfWidth = (field.widthPercent / 100) * pageWidth;
                        const pdfHeight = (field.heightPercent / 100) * pageHeight;

                        // Format the value based on field type
                        let displayValue = "";
                        let isCheckbox = false;
                        let checkboxChecked = false;

                        if (field.fieldType === "checkbox") {
                            isCheckbox = true;
                            checkboxChecked = field.value === true || field.value === "true" || field.value === "True";
                        } else if (field.fieldType === "date" && field.value) {
                            displayValue = new Date(field.value).toLocaleDateString();
                        } else {
                            displayValue = String(field.value || "");
                        }

                        // Draw checkbox
                        if (isCheckbox) {
                            const checkboxSize = Math.min(pdfWidth, pdfHeight) * 0.8;
                            const checkboxX = pdfX + (pdfWidth - checkboxSize) / 2;
                            const checkboxY = pdfY + (pdfHeight - checkboxSize) / 2;

                            // Draw checkbox border
                            page.drawRectangle({
                                x: checkboxX,
                                y: checkboxY,
                                width: checkboxSize + 5,
                                height: checkboxSize,
                                borderColor: rgb(0, 0, 0),
                                borderWidth: 2,
                            });

                            // Draw checkmark if checked
                            if (checkboxChecked) {
                                const path = "M2 12 L10 20 L22 4";
                                page.drawSvgPath(path, {
                                    x: checkboxX + checkboxSize * 0.1,
                                    y: checkboxY + checkboxSize * 0.1 + 22,
                                    width: checkboxSize - 12,
                                    height: checkboxSize - 7,
                                    borderColor: rgb(0, 0, 0),
                                    borderWidth: 1.5,
                                });
                            }
                        } else if (displayValue) {
                            // Draw text field
                            // Calculate font size based on field height (leave some padding)
                            const fontSize = Math.min(pdfHeight * 0.6, 12);

                            // Draw background rectangle for better visibility
                            // page.drawRectangle({
                            //     x: pdfX,
                            //     y: pdfY,
                            //     width: pdfWidth,
                            //     height: pdfHeight,
                            //     color: rgb(0.95, 0.95, 0.95),
                            //     borderColor: rgb(0.7, 0.7, 0.7),
                            //     borderWidth: 1,
                            // });

                            // Draw the text
                            page.drawText(displayValue, {
                                x: pdfX + 4,
                                y: pdfY + pdfHeight / 2 - fontSize / 3,
                                size: fontSize,
                                font: font,
                                color: rgb(0, 0, 0),
                                maxWidth: pdfWidth - 8,
                            });
                        }
                    } catch (error) {
                        console.error("Error adding form field to PDF:", field.index, error);
                    }
                }

                // Build audit report data from Salesforce record and signatures
                try {
                    await generateAuditReportPages({
                        pdfDoc,
                        pages,
                        documentRecord,
                        signatureData,
                        orgId: orgIdState,
                        totalPages,
                    });
                } catch (e) {
                    console.warn("Failed to append audit report page:", e);
                }

                // Save the modified PDF
                const pdfBytes = await pdfDoc.save();

                // Upload to Salesforce if config is available
                if (salesforceConfig) {
                    // Determine FirstPublishLocationId
                    const firstPublishLocationId = documentRecord?.Record_Id__c || salesforceConfig.recordId;

                    // Check if all fields are filled before uploading
                    const allFieldsFilled = signatureData.every((sig) => (sig.fields || []).every((field) => field.filled));

                    // Upload signed PDF as ContentVersion
                    if (allFieldsFilled) {
                        await uploadSignedPdfToSalesforce(pdfBytes, firstPublishLocationId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);
                    }

                    // Update Document record with signature and field data
                    await updateDocumentRecord(salesforceConfig.recordId, signatureData, fieldData, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);

                    // Mark as submitted
                    setIsSubmitted(true);

                    // Show success toast
                    setToast({
                        isVisible: true,
                        message: "All signatures completed successfully! Signed PDF uploaded to Salesforce.",
                        type: "success",
                    });
                } else {
                    // Fallback: Download the PDF if no Salesforce config
                    const blob = new Blob([pdfBytes], { type: "application/pdf" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = pdfFile.replace(".pdf", "") + "-signed.pdf";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    // Mark as submitted
                    setIsSubmitted(true);

                    // Show success toast
                    setToast({
                        isVisible: true,
                        message: "All signatures completed successfully! Signed PDF downloaded.",
                        type: "success",
                    });
                }
            } catch (error) {
                console.error("Error in save and submit:", error);
                setToast({
                    isVisible: true,
                    message: `Error creating signed PDF: ${error.message}`,
                    type: "error",
                });
            }
        }
    };

    // Upload signed PDF to Salesforce as ContentVersion
    const uploadSignedPdfToSalesforce = async (pdfBytes, firstPublishLocationId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Convert PDF bytes to base64
            const base64Pdf = Buffer.from(pdfBytes).toString("base64");

            // Create ContentVersion record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentVersion`;

            const contentVersionData = {
                Title: `Signed_Document_${Date.now()}`,
                PathOnClient: `Signed_Document_${Date.now()}.pdf`,
                VersionData: base64Pdf,
                FirstPublishLocationId: firstPublishLocationId,
                IsMajorVersion: true,
            };

            let response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(contentVersionData),
            });

            // If token expired (401), try to refresh it
            if (response.status === 401 && clientId && clientSecret) {
                console.log("Access token expired, attempting to refresh...");
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                // Retry the request with new token
                response = await fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(contentVersionData),
                });
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to upload ContentVersion: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const result = await response.json();
            return result.id;
        } catch (error) {
            console.error("Error uploading signed PDF to Salesforce:", error);
            throw error;
        }
    };

    // Update Document__c record with signature and field data
    const updateDocumentRecord = async (documentId, signatureData, fieldData, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Step 1: Save imageUrl data to Signature__c records
            await upsertSignatureRecords(documentId, signatureData, currentToken, instanceUrl, clientId, clientSecret);

            // Step 2: Remove imageUrl from signature data before saving to Document__c
            const sanitizedSignatureData = signatureData.map((sig) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    return {
                        ...sig,
                        fields: sig.fields.map((field) => {
                            // eslint-disable-next-line no-unused-vars
                            const { imageUrl, ...fieldWithoutImage } = field;
                            return fieldWithoutImage;
                        }),
                    };
                }
                return sig;
            });

            // Salesforce REST API endpoint to update Document__c record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/Document__c/${documentId}`;

            // Combine sanitized signature and field data into a single array
            const combinedData = [...(sanitizedSignatureData || []), ...(fieldData || [])];

            // Convert combined data to JSON string
            const signatureDataJson = JSON.stringify(combinedData);

            let response = await fetch(apiUrl, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    Signing_Details__c: signatureDataJson,
                }),
            });

            // If token expired (401), try to refresh it
            if (response.status === 401 && clientId && clientSecret) {
                console.log("Access token expired, attempting to refresh...");
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                // Retry the request with new token
                response = await fetch(apiUrl, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        Signing_Details__c: signatureDataJson,
                    }),
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to update Document record: ${response.status} ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error("Error updating Document record:", error);
            throw error;
        }
    };

    // Create or update Signature__c records
    const upsertSignatureRecords = async (documentId, signatureData, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Extract all fields with imageUrl from signatureData
            const fieldsWithImages = [];
            signatureData.forEach((sig) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    sig.fields.forEach((field) => {
                        if (field.filled && field.imageUrl) {
                            // Use composite key: priority_fieldIndex to prevent cross-priority contamination
                            // Ensure both values are converted to strings
                            const compositeKey = `${String(sig.priority)}_${String(field.index)}`;
                            fieldsWithImages.push({
                                fieldIndex: compositeKey, // Store as priority_fieldIndex
                                imageUrl: field.imageUrl,
                                ipAddress: field.ipAddress || "",
                                timestamp: field.timestamp || field.signedTime || "",
                            });
                        }
                    });
                }
            });

            // First, fetch existing Signature__c records to get their IDs
            const existingRecords = await fetchSignatureRecords(documentId, currentToken, instanceUrl, clientId, clientSecret);
            const existingMap = new Map();
            existingRecords.forEach((record) => {
                existingMap.set(record.Field_Index__c, record.Id);
            });

            // Prepare records for upsert (create or update)
            const recordsToUpsert = [];
            for (const field of fieldsWithImages) {
                const signingDetails = JSON.stringify({
                    imageUrl: field.imageUrl,
                    ipAddress: field.ipAddress,
                    timestamp: field.timestamp,
                });

                const recordData = {
                    Document__c: documentId,
                    Field_Index__c: field.fieldIndex,
                    Signing_Details__c: signingDetails,
                };

                // If record exists, add Id for update
                const existingId = existingMap.get(field.fieldIndex);
                if (existingId) {
                    recordData.Id = existingId;
                }

                recordsToUpsert.push(recordData);
            }

            if (recordsToUpsert.length === 0) {
                return true;
            }

            // Use Promise.all to create/update records individually
            const upsertPromises = recordsToUpsert.map(async (record) => {
                const isUpdate = !!record.Id;
                const method = isUpdate ? "PATCH" : "POST";
                const apiUrl = isUpdate ? `${instanceUrl}/services/data/v65.0/sobjects/Signature__c/${record.Id}` : `${instanceUrl}/services/data/v65.0/sobjects/Signature__c`;

                // Remove Id from body if updating (Id is in URL)
                const body = isUpdate ? { ...record } : record;
                if (isUpdate) {
                    delete body.Id;
                }

                let response = await fetch(apiUrl, {
                    method: method,
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(body),
                });

                // If token expired (401), try to refresh it
                if (response.status === 401 && clientId && clientSecret) {
                    console.log("Access token expired, attempting to refresh...");
                    currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                    // Retry the request with new token
                    response = await fetch(apiUrl, {
                        method: method,
                        headers: {
                            Authorization: `Bearer ${currentToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(body),
                    });
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to ${isUpdate ? "update" : "create"} Signature record (Field Index: ${record.Field_Index__c}): ${response.status} ${response.statusText} - ${errorText}`);
                }

                const result = await response.json();
                return result;
            });

            // Execute all upsert operations in parallel
            await Promise.all(upsertPromises);
            return true;
        } catch (error) {
            console.error("Error upserting Signature records:", error);
            throw error;
        }
    };

    // Fetch all Signature__c records for a document
    const fetchSignatureRecords = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            const query = `SELECT Id, Field_Index__c, Signing_Details__c FROM Signature__c WHERE Document__c = '${documentId}'`;

            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(query)}`;

            let response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
            });

            // If token expired (401), try to refresh it
            if (response.status === 401 && clientId && clientSecret) {
                console.log("Access token expired, attempting to refresh...");
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                // Retry the request with new token
                response = await fetch(apiUrl, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch Signature records: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.records || [];
        } catch (error) {
            console.error("Error fetching Signature records:", error);
            return [];
        }
    };

    const handleReject = async () => {
        if (!salesforceConfig) return;

        const { recordId, accessToken, instanceUrl, clientId, clientSecret } = salesforceConfig;
        let currentToken = accessToken;

        try {
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/Document__c/${recordId}`;

            let response = await fetch(apiUrl, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    Status__c: "Rejected",
                }),
            });

            // token refresh fallback
            if (response.status === 401 && clientId && clientSecret) {
                console.log("Access token expired, refreshing…");

                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                response = await fetch(apiUrl, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        Status__c: "Rejected",
                    }),
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to update Status__c: ${response.status}`);
            }

            // Disable UI after rejection
            setIsSubmitted(true);
            setToast({
                isVisible: true,
                message: "Document has been rejected.",
                type: "error",
            });
        } catch (error) {
            console.error("Reject error:", error);
            setToast({
                isVisible: true,
                message: `Error rejecting document: ${error.message}`,
                type: "error",
            });
        }
    };

    // Refresh access token using client credentials
    const refreshAccessToken = async (instanceUrl, clientId, clientSecret) => {
        try {
            const tokenUrl = `${instanceUrl}/services/oauth2/token`;
            const params = new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId,
                client_secret: clientSecret,
            });

            const response = await fetch(tokenUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: params,
            });

            if (!response.ok) {
                throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const newToken = data.access_token;

            // Persist the refreshed token in the URL and component state so reloads keep using it
            if (newToken) {
                updateUrlAccessToken(newToken);
            }

            return newToken;
        } catch (error) {
            console.error("Error refreshing access token:", error);
            throw error;
        }
    };

    // Refresh access token using client credentials
    // Helper to update access token in the url and component state so refresh persists across reloads
    const updateUrlAccessToken = (token) => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("act", token);
            // Replace the current history entry without reloading
            window.history.replaceState({}, document.title, url.toString());

            // Keep salesforceConfig state in sync if present
            setSalesforceConfig((prev) => (prev ? { ...prev, accessToken: token } : prev));
        } catch (err) {
            console.warn("Could not update URL access token:", err);
        }
    };

    // ========= AUDIT REPORT – dedicated helper =========
    const generateAuditReportPages = async ({ pdfDoc, pages, documentRecord, signatureData, orgId, totalPages }) => {
        if (!documentRecord) return;

        // ---------- 1. Build audit data ----------
        const buildAuditData = () => {
            // Document information
            const createdDate = documentRecord.CreatedDate ? new Date(documentRecord.CreatedDate) : null;
            const modifiedDate = documentRecord.LastModifiedDate ? new Date(documentRecord.LastModifiedDate) : null;
            const emailSubject = documentRecord.Email_Subject__c || null;
            const ownerName = documentRecord.CreatedBy?.Name || null;
            const ownerEmail = documentRecord.CreatedBy?.Email || null;

            const documentName = documentRecord.Document_Name__c || documentRecord.Name || "";
            const orgIdVal = orgId || "";

            // Signatures summary - handle both flat and nested field structures
            const sigs = Array.isArray(signatureData) ? signatureData : [];

            // Flatten all signature fields from nested structure
            const allSignatureFields = [];
            sigs.forEach((sig, sigIdx) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    // New nested structure - extract fields
                    sig.fields
                        .filter((f) => (f.type || f.fieldType) === "signature")
                        .forEach((field, fieldIdx) => {
                            allSignatureFields.push({
                                index: field.index ?? `${sig.index ?? sigIdx}-${fieldIdx}`,
                                imagePresent: Boolean(field.filled && field.imageUrl),
                                ipAddress: sig.ipAddress || field.ipAddress || "",
                                deviceInfo: sig.deviceInfo || field.deviceInfo || "",
                                locationInfo: sig.locationInfo || field.locationInfo || "",
                                timeStamp: sig.signedTime || field.signedTime || sig.timeStamp || field.timeStamp || "",
                                signeeName: sig.name || field.name || sig.signeeName || field.signeeName || "",
                                signeeEmail: sig.email || field.email || sig.signeeEmail || field.signeeEmail || "",
                                imageUrl: field.imageUrl || null,
                                signatureType: field.signatureType || sig.signatureType || "--",
                            });
                        });
                } else if ((sig.type || sig.fieldType) === "signature") {
                    // Old flat structure - use signature directly
                    allSignatureFields.push({
                        index: sig.index ?? sigIdx,
                        imagePresent: Boolean(sig.signed && (sig.imageUrl || sig.imagePresent)),
                        ipAddress: sig.ipAddress || "",
                        deviceInfo: sig.deviceInfo || "",
                        locationInfo: sig.locationInfo || "",
                        timeStamp: sig.signedTime || sig.timeStamp || "",
                        signeeName: sig.name || sig.signeeName || "",
                        signeeEmail: sig.email || sig.signeeEmail || "",
                        imageUrl: sig.imageUrl || null,
                        signatureType: sig.signatureType || "--",
                    });
                }
            });

            const totalSignatures = allSignatureFields.length;
            const signedCount = allSignatureFields.filter((s) => s.imagePresent).length;
            const pendingCount = totalSignatures - signedCount;

            return {
                createdDate,
                modifiedDate,
                emailSubject,
                ownerName,
                ownerEmail,
                documentName,
                orgId: orgIdVal,
                documentId: documentRecord.Id,
                documentStatus: pendingCount > 0 ? "Pending" : "Signed",
                totalSignatures,
                signedCount,
                pendingCount,
                signatures: allSignatureFields,
            };
        };

        const data = buildAuditData();
        if (!data) return;

        // ---------- 2. Page sizing & common layout ----------
        let PW = A4_WIDTH;
        let PH = A4_HEIGHT;
        try {
            const sz = pages[0]?.getSize();
            if (sz && sz.width && sz.height) {
                PW = sz.width;
                PH = sz.height;
            }
        } catch (error) {
            console.warn("Exception while reading original page size:", error);
        }

        // Dynamic spacing based on page
        const margin = Math.max(32, PW * 0.05);
        const headerTitleSize = Math.max(14, PH * 0.017);
        const sectionTitleSize = Math.max(11, PH * 0.013);
        const textSize = Math.max(10, PH * 0.0105);
        const lineHeight = Math.max(14, PH * 0.017);
        const sectionSpacing = Math.max(16, PH * 0.019);
        const boxSpacing = Math.max(8, PW * 0.01);
        const rowHeight = Math.max(60, PH * 0.071);
        const imgHeight = Math.max(50, rowHeight * 0.83);
        const tableHeaderHeight = Math.max(24, PH * 0.028);
        const bottomMargin = Math.max(40, PH * 0.047);

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        // Bold font for prominent headings in the audit report
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const blue = rgb(0.12, 0.59, 0.95);
        const darkBlue = rgb(0.1, 0.46, 0.82);
        const green = rgb(0.18, 0.49, 0.2);
        const orange = rgb(0.96, 0.49, 0.0);
        const gray = rgb(0.2, 0.2, 0.2);
        const lightGray = rgb(0.961, 0.961, 0.961);
        const white = rgb(1, 1, 1);
        // const summaryBlue = rgb(224,245,255);
        // const summaryGreen = rgb(224,255,235);
        // const summaryOrange = rgb(255,236,224);

        const fmt = (d) => (d ? new Date(d).toLocaleString() : "");

        // Table layout (Signature / Signature Type / Signature Details / User Details)
        const totalTblW = PW - margin * 2;
        const padding = Math.max(6, PW * 0.008);
        const imgColW = Math.max(120, PW * 0.18);
        const typeColW = Math.max(90, PW * 0.12);
        const internalGaps = padding * 3;
        const remW = totalTblW - (imgColW + typeColW + internalGaps);
        const sigDetailsColW = Math.max(140, Math.floor(remW / 2));
        const userColW = Math.max(120, remW - sigDetailsColW);

        const colXs = [margin + padding, margin + padding + imgColW + padding, margin + padding + imgColW + padding + typeColW + padding, margin + padding + imgColW + padding + typeColW + padding + sigDetailsColW + padding];

        // ---------- 3. Helper: draw one set of signature rows (used for page1 and continuation pages) ----------
        const drawSignatureRows = async (page, signaturesToDraw, startRowYFromBottom) => {
            const drawText = (text, opts) => page.drawText(String(text ?? ""), { font, ...opts });

            let rowYFromBottom = startRowYFromBottom;
            let rowsDrawn = 0;

            for (const sign of signaturesToDraw) {
                const signatureType = sign.signatureType.toUpperCase() || "--";
                const isSigned = !!sign.imagePresent;
                const backColour = rowsDrawn % 2 == 0 ? white : lightGray;

                page.drawRectangle({
                    x: margin,
                    y: rowYFromBottom - rowHeight,
                    width: PW - margin * 2,
                    height: rowHeight,
                    color: white,
                    borderColor: backColour,
                    borderWidth: 1,
                });

                // Signature thumbnail / index
                if (isSigned && sign.imageUrl) {
                    try {
                        const imgBytes = await fetch(sign.imageUrl).then((res) => res.arrayBuffer());
                        let img;
                        if (sign.imageUrl.startsWith("data:image/png")) {
                            img = await pdfDoc.embedPng(imgBytes);
                        } else if (sign.imageUrl.startsWith("data:image/jpeg") || sign.imageUrl.startsWith("data:image/jpg")) {
                            img = await pdfDoc.embedJpg(imgBytes);
                        } else {
                            img = await pdfDoc.embedPng(imgBytes);
                        }

                        const imgW = imgColW - padding * 2;
                        const imgH = imgHeight;
                        const imgYFromBottom = rowYFromBottom - (rowHeight - imgH) / 2 - imgH;

                        // rounded container
                        page.drawRectangle({
                            x: colXs[0] - 2,
                            y: imgYFromBottom - 2,
                            width: imgW + 4,
                            height: imgH + 4,
                            borderColor: rgb(0.82, 0.84, 0.86),
                            borderWidth: 1,
                        });

                        page.drawImage(img, {
                            x: colXs[0],
                            y: imgYFromBottom,
                            width: imgW,
                            height: imgH,
                        });
                    } catch {
                        drawText(`#${sign.index}`, {
                            x: colXs[0],
                            y: rowYFromBottom - rowHeight / 2 - textSize / 3,
                            size: textSize,
                            color: gray,
                        });
                    }
                } else {
                    drawText(`#${sign.index}`, {
                        x: colXs[0],
                        y: rowYFromBottom - rowHeight / 2 - textSize / 3,
                        size: textSize,
                        color: gray,
                    });
                }

                // Signature Type as pill
                const pillText = signatureType;
                const pillPaddingX = 12;
                const pillPaddingY = 4;
                const pillTextSize = Math.max(9, PH * 0.011);
                const pillTextWidth = font.widthOfTextAtSize(pillText, pillTextSize);
                const pillWidth = pillTextWidth + pillPaddingX * 2;
                const pillHeight = pillTextSize + pillPaddingY * 2;
                const pillX = colXs[1] + (typeColW - pillWidth) / 2;
                const pillY = rowYFromBottom - rowHeight / 2 - pillHeight / 2;

                // page.drawRectangle({
                //     x: pillX,
                //     y: pillY,
                //     width: pillWidth,
                //     height: pillHeight,
                //     color: rgb(0.9, 0.97, 0.91),
                //     borderColor: statusColor,
                //     borderWidth: 1,
                // });

                drawText(pillText, {
                    x: pillX + pillPaddingX,
                    y: pillY + pillPaddingY + 1,
                    size: pillTextSize,
                    color: green,
                });

                // Signature details
                const rowTextSize = Math.max(8, PH * 0.0095);
                const signedOn = sign.timeStamp || (isSigned ? new Date().toLocaleString() : "--");
                const ipLine = isSigned ? `IP: ${sign.ipAddress || "--"}` : "IP: --";
                const deviceLine = isSigned ? `Device: ${sign.deviceInfo || "--"}` : "Device: --";
                const locationLine = isSigned ? `Location: ${sign.locationInfo || "--"}` : "Location: --";

                drawText(`Signed On: ${signedOn}`, {
                    x: colXs[2],
                    y: rowYFromBottom - rowHeight * 0.3,
                    size: rowTextSize,
                    color: gray,
                });
                drawText(deviceLine, {
                    x: colXs[2],
                    y: rowYFromBottom - rowHeight * 0.55,
                    size: rowTextSize,
                    color: gray,
                });
                drawText(locationLine, {
                    x: colXs[2],
                    y: rowYFromBottom - rowHeight * 0.77,
                    size: rowTextSize,
                    color: gray,
                });

                // User details
                drawText(`Name: ${sign.signeeName || "--"}`, {
                    x: colXs[3],
                    y: rowYFromBottom - rowHeight * 0.3,
                    size: rowTextSize,
                    color: gray,
                });
                drawText(`Email: ${sign.signeeEmail || "--"}`, {
                    x: colXs[3],
                    y: rowYFromBottom - rowHeight * 0.55,
                    size: rowTextSize,
                    color: gray,
                });
                drawText(ipLine, {
                    x: colXs[3],
                    y: rowYFromBottom - rowHeight * 0.77,
                    size: rowTextSize,
                    color: gray,
                });

                rowYFromBottom -= rowHeight;
                rowsDrawn++;
            }

            return rowsDrawn;
        };

        // ---------- 4. First page + continuation pages ----------
        // slightly reduced document info box height to fit 1-2 fewer lines visually
        const docInfoBoxHeight = Math.max(120, PH * 0.14);
        const summaryBoxHeight = Math.max(50, PH * 0.059);

        const fixedSectionsHeightFirst =
            margin + // top
            headerTitleSize * 1.5 +
            sectionSpacing + // "Audit Report" + space
            docInfoBoxHeight +
            sectionSpacing +
            sectionTitleSize * 1.5 +
            sectionSpacing +
            summaryBoxHeight +
            sectionSpacing +
            sectionTitleSize * 1.5 +
            sectionSpacing +
            tableHeaderHeight +
            sectionSpacing +
            bottomMargin;

        const availableFirst = PH - fixedSectionsHeightFirst;
        const maxRowsFirst = Math.max(0, Math.floor(availableFirst / rowHeight));

        const availableCont = PH - (margin + sectionTitleSize * 1.5 + sectionSpacing + tableHeaderHeight + sectionSpacing + bottomMargin);
        const maxRowsCont = Math.max(0, Math.floor(availableCont / rowHeight));

        let signaturesRemaining = [...data.signatures];
        let pageNumber = 1;

        while (signaturesRemaining.length > 0) {
            const page = pdfDoc.addPage([PW, PH]);
            page.drawRectangle({
                x: 0,
                y: 0,
                width: PW,
                height: PH,
                color: lightGray, // light gray background
            });

            const drawText = (text, opts) => page.drawText(String(text ?? ""), { font, ...opts });

            let currentYFromTop = margin;
            let currentYFromBottom = PH - currentYFromTop;

            if (pageNumber === 1) {
                // draw box for audit report header
                page.drawRectangle({
                    x: 0,
                    y: PH - headerTitleSize * 1.5 - 10,
                    width: PW,
                    height: headerTitleSize * 1.5 + 22,
                    color: white,
                });
                // ---- Header "Audit Report" (Header B – simple text) ----
                drawText("Audit Report", {
                    font: fontBold,
                    x: margin,
                    y: currentYFromBottom + 8,
                    size: headerTitleSize,
                    color: rgb(0, 0, 0),
                });
                currentYFromTop += headerTitleSize * 1.5;
                currentYFromBottom = PH - currentYFromTop;

                // ---- Document Information card ----
                const cardY = currentYFromBottom - docInfoBoxHeight;
                page.drawRectangle({
                    x: margin,
                    y: cardY,
                    width: PW - margin * 2,
                    height: docInfoBoxHeight - 20,
                    color: rgb(1, 1, 1),
                    borderColor: rgb(0.88, 0.9, 0.92),
                    borderWidth: 1.5,
                });

                const cardInnerLeftX = margin + 18;
                const cardInnerRightX = margin + (PW - margin * 2) / 2 + 12;

                page.drawRectangle({
                    x: margin,
                    y: cardY + docInfoBoxHeight - 28,
                    width: PW - margin * 2,
                    height: 28,
                    color: white,
                });

                // Draw top border
                page.drawLine({
                    start: { x: margin, y: cardY + docInfoBoxHeight - 28 + 28 },
                    end: { x: margin + (PW - margin * 2), y: cardY + docInfoBoxHeight - 28 + 28 },
                    color: rgb(0.88, 0.9, 0.92),
                    thickness: 1.5,
                });

                // Draw left border
                page.drawLine({
                    start: { x: margin, y: cardY + docInfoBoxHeight - 28 },
                    end: { x: margin, y: cardY + docInfoBoxHeight },
                    color: rgb(0.88, 0.9, 0.92),
                    thickness: 1.5,
                });

                // Draw right border
                page.drawLine({
                    start: { x: margin + (PW - margin * 2), y: cardY + docInfoBoxHeight - 28 },
                    end: { x: margin + (PW - margin * 2), y: cardY + docInfoBoxHeight },
                    color: rgb(0.88, 0.9, 0.92),
                    thickness: 1.5,
                });

                // Make the Document Information heading slightly larger
                const docInfoHeadingSize = Math.max(sectionTitleSize, sectionTitleSize + Math.round(PH * 0.002));
                drawText("Document Information", {
                    x: cardInnerLeftX,
                    y: cardY + docInfoBoxHeight - 20,
                    size: docInfoHeadingSize,
                    color: rgb(0, 0, 0),
                });

                let infoY = cardY + docInfoBoxHeight - 45;

                // Use a slightly reduced font size for the document info key/values
                const infoTextSize = Math.max(8, textSize - 2);
                const writeKV = (kx, ky, key, val) => {
                    drawText(key, {
                        x: kx,
                        y: ky,
                        size: infoTextSize,
                        color: gray,
                    });
                    drawText(val || "", {
                        x: kx + 120,
                        y: ky,
                        size: infoTextSize,
                        color: gray,
                    });
                };

                // Left column
                writeKV(cardInnerLeftX, infoY, "Sent Date:", fmt(data.createdDate));
                infoY -= lineHeight;
                writeKV(cardInnerLeftX, infoY, "Document Name:", data.documentName);
                infoY -= lineHeight;
                writeKV(cardInnerLeftX, infoY, "Document Owner:", data.ownerName);
                infoY -= lineHeight;
                writeKV(cardInnerLeftX, infoY, "Document Owner Email:", data.ownerEmail);
                infoY -= lineHeight;
                writeKV(cardInnerLeftX, infoY, "Email Subject:", data.emailSubject);

                // Right column
                let infoYR = cardY + docInfoBoxHeight - 45;
                writeKV(cardInnerRightX, infoYR, "Document ID:", data.documentId || "");
                infoYR -= lineHeight;
                writeKV(cardInnerRightX, infoYR, "Org ID:", data.orgId || "");
                infoYR -= lineHeight;
                writeKV(cardInnerRightX, infoYR, "Document Status:", data.documentStatus);
                infoYR -= lineHeight;
                writeKV(cardInnerRightX, infoYR, "Document Pages:", String(totalPages));

                currentYFromTop += docInfoBoxHeight + Math.max(8, Math.floor(sectionSpacing / 2));
                currentYFromBottom = PH - currentYFromTop;
                currentYFromTop += sectionTitleSize * 1.5;
                currentYFromBottom = PH - currentYFromTop;

                const summaryY = currentYFromBottom - summaryBoxHeight;
                const totalBoxWidth = PW - margin * 2;
                const boxW = (totalBoxWidth - boxSpacing * 2) / 3;
                const offsets = [margin, margin + boxW + boxSpacing, margin + (boxW + boxSpacing) * 2];
                const labels = ["Total Signatures", "Signed", "Pending"];
                const values = [data.totalSignatures, data.signedCount, data.pendingCount];
                const colors = [blue, green, orange];
                const summaryPaths = [
                    "M4 6C4 4.89688 4.89688 4 6 4H10.6719C11.2031 4 11.7125 4.20938 12.0875 4.58438L15.4125 7.91563C15.7875 8.29063 15.9969 8.8 15.9969 9.33125V12.3781L11.8719 16.5031H10.5562L10.0531 14.8281C9.90625 14.3375 9.45625 14.0031 8.94375 14.0031C8.59063 14.0031 8.25937 14.1625 8.04062 14.4375L6.1625 16.7812C5.90313 17.1031 5.95625 17.5781 6.27813 17.8344C6.6 18.0906 7.075 18.0406 7.33125 17.7156L8.80313 15.8781L9.27812 17.4625C9.37187 17.7812 9.66562 17.9969 9.99687 17.9969H10.9812C10.9531 18.0938 10.9281 18.1937 10.9094 18.2937L10.5687 19.9969H6C4.89688 19.9969 4 19.1 4 17.9969V5.99688V6ZM10.5 5.82812V8.75C10.5 9.16563 10.8344 9.5 11.25 9.5H14.1719L10.5 5.82812ZM12.3812 18.5906C12.4594 18.2031 12.65 17.8469 12.9281 17.5688L16.6438 13.8531L19.1438 16.3531L15.4281 20.0688C15.15 20.3469 14.7937 20.5375 14.4062 20.6156L12.5437 20.9875C12.5156 20.9937 12.4844 20.9969 12.4531 20.9969C12.2031 20.9969 11.9969 20.7937 11.9969 20.5406C11.9969 20.5094 12 20.4813 12.0062 20.45L12.3781 18.5875L12.3812 18.5906ZM20.75 14.7469L19.85 15.6469L17.35 13.1469L18.25 12.2469C18.9406 11.5562 20.0594 11.5562 20.75 12.2469C21.4406 12.9375 21.4406 14.0562 20.75 14.7469Z",
                    "M10.2882 4.11611C10.3768 4.1467 10.4636 4.18256 10.5485 4.2237L11.5635 4.72369C11.6993 4.79056 11.8487 4.82533 12.0002 4.82533C12.1516 4.82533 12.301 4.79056 12.4369 4.72369L13.4518 4.2237C13.7082 4.0975 13.9869 4.02304 14.272 4.00456C14.5571 3.98608 14.8431 4.02394 15.1136 4.11599C15.3841 4.20804 15.6338 4.35247 15.8484 4.54104C16.0631 4.7296 16.2385 4.9586 16.3647 5.21497L16.4224 5.34313L16.4723 5.47525L16.8362 6.54563C16.9351 6.83676 17.1637 7.0646 17.454 7.16349L18.5252 7.5274C18.8182 7.62709 19.0866 7.78815 19.3124 7.99982C19.5381 8.21149 19.7162 8.46891 19.8346 8.75487C19.9529 9.04084 20.0089 9.34877 19.9988 9.6581C19.9887 9.96744 19.9127 10.2711 19.7759 10.5487L19.2767 11.5637C19.2099 11.6995 19.1751 11.8489 19.1751 12.0004C19.1751 12.1518 19.2099 12.3012 19.2767 12.4371L19.7759 13.4521C19.9126 13.7297 19.9885 14.0332 19.9985 14.3425C20.0086 14.6517 19.9525 14.9595 19.8342 15.2454C19.7158 15.5313 19.5378 15.7886 19.3121 16.0002C19.0864 16.2118 18.8181 16.3729 18.5252 16.4726L17.454 16.8365C17.3108 16.8854 17.1806 16.9665 17.0736 17.0736C16.9666 17.1807 16.8857 17.311 16.837 17.4543L16.4723 18.5255C16.3726 18.8184 16.2115 19.0867 15.9999 19.3124C15.7883 19.5381 15.531 19.7161 15.2451 19.8345C14.9593 19.9529 14.6514 20.0089 14.3422 19.9989C14.033 19.9888 13.7294 19.9129 13.4518 19.7763L12.4369 19.2771C12.301 19.2102 12.1516 19.1754 12.0002 19.1754C11.8487 19.1754 11.6993 19.2102 11.5635 19.2771L10.5485 19.7763C10.2709 19.9129 9.96737 19.9888 9.65814 19.9989C9.3489 20.0089 9.04107 19.9529 8.75521 19.8345C8.46935 19.7161 8.21203 19.5381 8.00041 19.3124C7.7888 19.0867 7.62777 18.8184 7.52806 18.5255L7.16415 17.4543C7.1152 17.311 7.03395 17.1808 6.92668 17.0738C6.81942 16.9668 6.68901 16.8859 6.54551 16.8373L5.47515 16.4726C5.18218 16.3729 4.91384 16.212 4.68803 16.0004C4.46223 15.7888 4.28415 15.5315 4.1657 15.2456C4.04725 14.9597 3.99115 14.6519 4.00113 14.3426C4.01112 14.0333 4.08697 13.7297 4.22362 13.4521L4.7236 12.4371C4.79047 12.3012 4.82524 12.1518 4.82524 12.0004C4.82524 11.8489 4.79047 11.6995 4.7236 11.5637L4.22362 10.5487C4.08697 10.271 4.01112 9.96744 4.00113 9.65816C3.99115 9.34888 4.04725 9.04102 4.1657 8.75514C4.28415 8.46927 4.46223 8.21195 4.68803 8.00037C4.91384 7.78879 5.18218 7.62782 5.47515 7.52819L6.54551 7.16428C6.68903 7.11542 6.81939 7.03422 6.92652 6.92695C7.03366 6.81968 7.11469 6.68921 7.16336 6.54563L7.52727 5.47525C7.61926 5.20468 7.76366 4.95488 7.95222 4.74014C8.14077 4.52539 8.36978 4.34989 8.62618 4.22368C8.88257 4.09746 9.16132 4.023 9.4465 4.00454C9.73168 3.98609 10.0177 4.024 10.2882 4.11611ZM14.7453 9.6025L10.4575 13.8904L8.89588 12.0154C8.84671 11.9534 8.78563 11.9019 8.71625 11.8639C8.64688 11.8259 8.57059 11.8021 8.49189 11.794C8.41319 11.7859 8.33367 11.7936 8.258 11.8167C8.18232 11.8398 8.11203 11.8777 8.05125 11.9284C7.99047 11.979 7.94044 12.0413 7.90409 12.1116C7.86774 12.1819 7.84581 12.2587 7.8396 12.3376C7.83338 12.4165 7.843 12.4958 7.86789 12.5709C7.89278 12.646 7.93244 12.7153 7.98453 12.7749L9.96229 15.1482C10.015 15.2115 10.0804 15.2632 10.1542 15.2999C10.2279 15.3365 10.3086 15.3574 10.3909 15.3612C10.4732 15.365 10.5554 15.3516 10.6322 15.3219C10.7091 15.2922 10.7789 15.2468 10.8372 15.1886L15.5839 10.4419C15.6422 10.3876 15.6889 10.3221 15.7214 10.2493C15.7538 10.1765 15.7712 10.0979 15.7726 10.0183C15.774 9.93858 15.7594 9.85945 15.7295 9.78557C15.6997 9.71169 15.6553 9.64457 15.5989 9.58823C15.5426 9.53189 15.4755 9.48747 15.4016 9.45763C15.3277 9.42779 15.2486 9.41313 15.1689 9.41454C15.0893 9.41594 15.0107 9.43338 14.9379 9.46581C14.8651 9.49824 14.7996 9.545 14.7453 9.60329",
                    "M20 12C20 14.1217 19.1571 16.1566 17.6569 17.6569C16.1566 19.1571 14.1217 20 12 20C9.87827 20 7.84344 19.1571 6.34315 17.6569C4.84285 16.1566 4 14.1217 4 12C4 9.87827 4.84285 7.84344 6.34315 6.34315C7.84344 4.84285 9.87827 4 12 4C14.1217 4 16.1566 4.84285 17.6569 6.34315C19.1571 7.84344 20 9.87827 20 12ZM12 7.5C12 7.36739 11.9473 7.24021 11.8536 7.14645C11.7598 7.05268 11.6326 7 11.5 7C11.3674 7 11.2402 7.05268 11.1464 7.14645C11.0527 7.24021 11 7.36739 11 7.5V13C11 13.0881 11.0234 13.1747 11.0676 13.2509C11.1119 13.3271 11.1755 13.3903 11.252 13.434L14.752 15.434C14.8669 15.4961 15.0014 15.5108 15.127 15.4749C15.2525 15.4391 15.3591 15.3556 15.4238 15.2422C15.4886 15.1288 15.5065 14.9946 15.4736 14.8683C15.4408 14.7419 15.3598 14.6334 15.248 14.566L12 12.71V7.5Z",
                ];

                for (let i = 0; i < 3; i++) {
                    const bx = offsets[i];
                    page.drawRectangle({
                        x: bx,
                        y: summaryY + 27,
                        width: boxW,
                        height: summaryBoxHeight - 10,
                        color: rgb(1, 1, 1),
                        borderColor: rgb(0.88, 0.9, 0.92),
                        borderWidth: 1.2,
                    });

                    // Count (larger, centered, gray color)
                    const countStr = String(values[i] ?? 0);
                    const countSize = Math.max(headerTitleSize + 4, Math.round(headerTitleSize * 1.0 + PH * 0.002));
                    const countFont = fontBold || font;
                    const countW = countFont.widthOfTextAtSize(countStr, countSize);
                    const label = labels[i];
                    const labelSize = Math.max(9, textSize - 1);
                    const iconW = 20,
                        iconH = 20;
                    const gap = 8;
                    const leftPad = 18;
                    const rightPad = 18;
                    const centerY = summaryY + summaryBoxHeight / 2;

                    // Draw count (bold)
                    let leftX = bx + leftPad;
                    page.drawText(countStr, {
                        x: leftX,
                        y: centerY - countSize / 2 + 24,
                        size: countSize,
                        font: countFont,
                        color: rgb(0.25, 0.25, 0.25),
                    });

                    // Draw label (side by side, vertically centered)
                    page.drawText(label, {
                        x: leftX + countW + gap,
                        y: centerY - labelSize / 2 + 23,
                        size: labelSize,
                        color: rgb(0.45, 0.45, 0.45),
                    });

                    // Small colored indicator on the right
                    // page.drawRectangle({
                    //     x: bx + boxW - 24,
                    //     y: summaryY + summaryBoxHeight / 2 - 8,
                    //     width: 16,
                    //     height: 16,
                    //     color: colors[i],
                    // });

                    page.drawSvgPath(summaryPaths[i], {
                        x: bx + boxW - rightPad - iconW,
                        y: centerY - iconH / 2 + 43,
                        width: iconW,
                        height: iconH,
                        color: colors[i],
                    });
                }

                // Keep a slightly smaller gap after the summary to visually group related info
                currentYFromTop += summaryBoxHeight + Math.max(8, Math.floor(sectionSpacing / 2));
                currentYFromBottom = PH - currentYFromTop;

                // ---- Signature Events header strip ----
                page.drawRectangle({
                    x: margin,
                    y: currentYFromBottom,
                    width: PW - margin * 2,
                    height: 28,
                    color: white,
                    borderColor: rgb(0.88, 0.9, 0.92),
                    borderWidth: 1.5,
                });

                drawText("Signature Events", {
                    x: margin + 12,
                    y: currentYFromBottom + 9,
                    size: sectionTitleSize,
                    color: rgb(0, 0, 0),
                });

                currentYFromTop += 28 + sectionSpacing;
                currentYFromBottom = PH - currentYFromTop;

                // ---- Table header ----
                const headerY = currentYFromBottom;
                page.drawRectangle({
                    x: margin,
                    y: headerY - tableHeaderHeight + 46,
                    width: totalTblW,
                    height: tableHeaderHeight - 3,
                    color: lightGray,
                });

                const headerTitles = ["SIGNATURE", "SIGNATURE TYPE", "SIGNATURE DETAILS", "USER DETAILS"];
                const headerWidths = [imgColW, typeColW, sigDetailsColW, userColW];
                const headerTextSize = Math.max(9, PH * 0.011);

                for (let i = 0; i < headerTitles.length; i++) {
                    const t = headerTitles[i];
                    const w = font.widthOfTextAtSize(t, headerTextSize);
                    const colStart = colXs[i];
                    const colW = headerWidths[i];
                    const tx = colStart + (colW - w) / 2;

                    drawText(t, {
                        x: tx,
                        y: headerY - tableHeaderHeight / 2 - headerTextSize / 3 + 46,
                        size: headerTextSize - 2,
                        color: rgb(0, 0, 0),
                    });
                }

                currentYFromTop += tableHeaderHeight + sectionSpacing;
                currentYFromBottom = PH - currentYFromTop + 64;

                // ---- Rows on first page ----
                const firstSlice = signaturesRemaining.slice(0, maxRowsFirst);
                await drawSignatureRows(page, firstSlice, currentYFromBottom);
                signaturesRemaining = signaturesRemaining.slice(firstSlice.length);
            } else {
                // ---- Continuation pages ----

                // small title
                drawText(`Signature Events (continued) - Page ${pageNumber}`, {
                    x: margin,
                    y: currentYFromBottom,
                    size: sectionTitleSize,
                    color: darkBlue,
                });

                currentYFromTop += sectionTitleSize * 1.5;
                currentYFromBottom = PH - currentYFromTop;

                // table header
                const headerY = currentYFromBottom;
                page.drawRectangle({
                    x: margin,
                    y: headerY - tableHeaderHeight,
                    width: totalTblW,
                    height: tableHeaderHeight,
                    color: darkBlue,
                });

                const headerTitles = ["Signature", "Signature Type", "Signature Details", "User Details"];
                const headerWidths = [imgColW, typeColW, sigDetailsColW, userColW];
                const headerTextSize = Math.max(9, PH * 0.011);

                for (let i = 0; i < headerTitles.length; i++) {
                    const t = headerTitles[i];
                    const w = font.widthOfTextAtSize(t, headerTextSize);
                    const colStart = colXs[i];
                    const colW = headerWidths[i];
                    const tx = colStart + (colW - w) / 2;

                    drawText(t, {
                        x: tx,
                        y: headerY - tableHeaderHeight / 2 - headerTextSize / 3,
                        size: headerTextSize,
                        color: rgb(1, 1, 1),
                    });
                }

                currentYFromTop += tableHeaderHeight + sectionSpacing;
                currentYFromBottom = PH - currentYFromTop;

                // rows on continuation page
                const slice = signaturesRemaining.slice(0, maxRowsCont);
                await drawSignatureRows(page, slice, currentYFromBottom);
                signaturesRemaining = signaturesRemaining.slice(slice.length);
            }

            pageNumber++;
        }
    };

    // Check if Save & Submit button should be shown
    const shouldShowSaveButton = () => {
        // If already submitted in this session, hide button
        if (isSubmitted) {
            return false;
        }

        // Get all fields for current priority from all signatures
        const currentPriorityFields = signatureData.filter((sig) => sig.priority == urlPriority).flatMap((sig) => sig.fields || []);

        const initialPriorityFields = initialSignatureData.filter((sig) => sig.priority == urlPriority).flatMap((sig) => sig.fields || []);

        // If no fields for current priority, hide button
        if (currentPriorityFields.length === 0) {
            return false;
        }

        // Check if all fields for current priority were already filled initially
        const allInitiallyFilled = initialPriorityFields.every((field) => field.filled);

        if (allInitiallyFilled) {
            // Check if there are any changes from initial state
            const hasChanges = currentPriorityFields.some((currentField) => {
                const initialField = initialPriorityFields.find((f) => f.index === currentField.index);
                // Check if imageUrl has changed
                return !initialField || currentField.imageUrl !== initialField.imageUrl;
            });

            // Only show button if there are changes
            return hasChanges;
        }

        // Show button if not all were initially filled (user needs to complete signing)
        return true;
    };

    useEffect(() => {
        if (pdfDocRef.current && totalPages > 0) {
            // Small delay to ensure canvas elements are in the DOM
            setTimeout(() => {
                renderAllPages(pdfDocRef.current);
                renderThumbnailPages(pdfDocRef.current);
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [totalPages]);

    const renderAllPages = async (pdf) => {
        const numPages = pdf.numPages;
        const dimensions = [];

        // Get container width for responsive sizing
        const containerWidth = 800; // Fixed width for consistency

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const canvas = canvasRefsArray.current[pageNum - 1];
            if (canvas) {
                const dims = await renderPage(pdf, pageNum, canvas, containerWidth);
                dimensions.push(dims);
            }
        }
    };

    const renderPage = async (pdf, pageNumber, canvas, targetWidth) => {
        if (!canvas) {
            console.error("Canvas not available for page", pageNumber);
            return null;
        }

        const page = await pdf.getPage(pageNumber);
        const originalViewport = page.getViewport({ scale: 1 });

        const pageWidth = originalViewport.width || A4_WIDTH;
        const calculatedScale = targetWidth / pageWidth;

        const viewport = page.getViewport({ scale: calculatedScale });
        const context = canvas.getContext("2d");

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Return actual dimensions for this page
        return {
            width: viewport.width,
            height: viewport.height,
            scale: calculatedScale,
        };
    };

    const renderThumbnailPages = async (pdf) => {
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const canvas = canvasRefsArray.current[`thumb-${pageNum - 1}`];
            if (!canvas) continue;

            try {
                const page = await pdf.getPage(pageNum);

                const viewport = page.getViewport({ scale: 0.25 }); // Small thumbnail scale
                const ctx = canvas.getContext("2d");

                canvas.width = viewport.width;
                canvas.height = viewport.height;

                await page.render({
                    canvasContext: ctx,
                    viewport: viewport,
                }).promise;
            } catch (error) {
                console.warn("Thumbnail render failed:", error);
            }
        }
    };

    const getLocationLive = async () => {
        try {
            // Try GPS first
            const coords = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) return reject("No GPS");
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 4000,
                });
            });

            const { latitude, longitude } = coords.coords;

            // Reverse geocode to city/state/country
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
            const data = await res.json();
            const address = data.address;

            const city = address.state_district || "Unknown City";
            const state = address.state || "Unknown State";
            const country = address.country || "Unknown Country";
            return `${city}, ${state}, ${country}`;
        } catch (gpsError) {
            console.warn("GPS failed, fallback to IP:", gpsError);
            return "Location Unavailable";
        }
    };

    const handleScrollToPage = (pageNumber) => {
        const target = document.querySelector(`[data-page="${pageNumber}"]`);
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    };

    return (
        <div className="app">
            {loading && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p>Loading PDF from Salesforce...</p>
                    </div>
                </div>
            )}
            {error && !pdfFile && !isExpired && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p style={{ color: "#d32f2f" }}>The URL is not right. Please contact the owner or sender of this link.</p>
                    </div>
                </div>
            )}

            {isExpired && (
                <div className="expired-card">
                    <div className="expired-icon">
                        <svg className="expired-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>

                    <h3 className="expired-title">Document Expired</h3>

                    <p className="expired-message">This document has expired and is no longer available for signing.</p>

                    <p className="expired-hint">Please contact the document owner if you believe this is an error.</p>

                    <button className="expired-button">Contact Support</button>
                </div>
            )}

            {pdfFile && !isExpired && (
                <>
                    <div className="pdf-container">
                        <div className="heading">
                            <h1 className="document-header">Send Document for Signing</h1>
                        </div>
                        <div className="content-section">
                            <div className="preview-section">
                                <div className="pages">
                                    {Array.from({ length: totalPages }, (_, index) => {
                                        const pageNumber = index + 1;
                                        return (
                                            <div key={index} className="preview-page-wrapper" onClick={() => handleScrollToPage(pageNumber)}>
                                                <div className="preview-canvas-wrapper">
                                                    <canvas ref={(el) => (canvasRefsArray.current[`thumb-${index}`] = el)} className="preview-thumbnail" />{" "}
                                                </div>
                                                <div className="preview-page-number">{pageNumber}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {shouldShowSaveButton() && (
                                    <div className="bottom-bar">
                                        <div className="bottom-bar-left">
                                            <input type="checkbox" checked={initialAccepted} onChange={(e) => setInitialAccepted(e.target.checked)} style={{ cursor: "pointer", width: "18px", height: "18px" }} />
                                            <span>
                                                {" "}
                                                I accept the{" "}
                                                <a target="_blank" href="https://mvclouds.com/products/signature-anywhere" className="termAndConditionLink">
                                                    t & c ↗
                                                </a>
                                            </span>
                                        </div>
                                        <div className="bottom-bar-right">
                                            <div className="action-btns">
                                                <button className="reject-btn" onClick={handleReject}>
                                                    Reject
                                                </button>
                                                <button className="save-submit-btn" onClick={handleSaveAndSubmit} disabled={!initialAccepted}>
                                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M17.8452 4.0874C19.1239 3.66152 20.3408 4.87805 19.9146 6.15674L15.6724 18.8823C15.2246 20.2247 13.3986 20.4032 12.6987 19.1733L10.1675 14.7222L12.6685 12.2222C12.9141 11.9765 12.9141 11.5782 12.6685 11.3325C12.4228 11.0868 12.0245 11.0868 11.7788 11.3325L9.27686 13.8335L4.82764 11.3032C3.59725 10.6034 3.77671 8.77723 5.11963 8.32959L17.8452 4.0874Z" fill="white" />
                                                    </svg>
                                                    Submit
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="canvas-container">
                                <div className="pdf-header">
                                    <h4>Document Preview</h4>
                                    <span> {totalPages} pages</span>
                                    <div className="pdf-file-info">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M6 3C4.89688 3 4 3.89688 4 5V17C4 18.1031 4.89688 19 6 19H8.5V15.5C8.5 14.3969 9.39687 13.5 10.5 13.5H16V8.32812C16 7.79688 15.7906 7.2875 15.4156 6.9125L12.0844 3.58438C11.7094 3.20938 11.2031 3 10.6719 3H6ZM14.1719 8.5H11.25C10.8344 8.5 10.5 8.16563 10.5 7.75V4.82812L14.1719 8.5ZM10.5 14.875C10.1562 14.875 9.875 15.1562 9.875 15.5V19.5C9.875 19.8438 10.1562 20.125 10.5 20.125C10.8438 20.125 11.125 19.8438 11.125 19.5V18.625H11.5C12.5344 18.625 13.375 17.7844 13.375 16.75C13.375 15.7156 12.5344 14.875 11.5 14.875H10.5ZM11.5 17.375H11.125V16.125H11.5C11.8438 16.125 12.125 16.4062 12.125 16.75C12.125 17.0938 11.8438 17.375 11.5 17.375ZM14.5 14.875C14.1562 14.875 13.875 15.1562 13.875 15.5V19.5C13.875 19.8438 14.1562 20.125 14.5 20.125H15.5C16.3969 20.125 17.125 19.3969 17.125 18.5V16.5C17.125 15.6031 16.3969 14.875 15.5 14.875H14.5ZM15.125 18.875V16.125H15.5C15.7063 16.125 15.875 16.2937 15.875 16.5V18.5C15.875 18.7063 15.7063 18.875 15.5 18.875H15.125ZM17.875 15.5V19.5C17.875 19.8438 18.1562 20.125 18.5 20.125C18.8438 20.125 19.125 19.8438 19.125 19.5V18.125H20C20.3438 18.125 20.625 17.8438 20.625 17.5C20.625 17.1562 20.3438 16.875 20 16.875H19.125V16.125H20C20.3438 16.125 20.625 15.8438 20.625 15.5C20.625 15.1562 20.3438 14.875 20 14.875H18.5C18.1562 14.875 17.875 15.1562 17.875 15.5Z" fill="#FF8282" />
                                        </svg>
                                        <span>{documentRecord?.Document_Name__c || "document"}</span>
                                    </div>
                                </div>
                                {Array.from({ length: totalPages }, (_, index) => {
                                    const pageNumber = index + 1;
                                    return (
                                        <div key={index} className="page-wrapper" data-page={pageNumber}>
                                            {/* <div className="page-number">Page {pageNumber}</div> */}
                                            <div className="canvas-wrapper">
                                                <canvas ref={(el) => (canvasRefsArray.current[index] = el)}></canvas>
                                                {signatureData.length > 0 && <SignatureOverlay pageNumber={pageNumber} priority={urlPriority} signatures={signatureData} onSign={handleSignatureClick} onFieldClick={handleFieldClick} onDelete={handleSignatureDelete} onFieldDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionSignedKeys={sessionSignedKeys} sessionFilledKeys={sessionFilledKeys} />}
                                                {fieldData.length > 0 && <FieldOverlay pageNumber={pageNumber} priority={urlPriority} fields={fieldData} onFieldClick={handleFieldClick} onDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionFilledKeys={sessionFilledKeys} />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        {shouldShowSaveButton() && (
                            <div className="footer">
                                <div className="bottom-bar-left">
                                    <input type="checkbox" checked={initialAccepted} onChange={(e) => setInitialAccepted(e.target.checked)} style={{ cursor: "pointer", width: "18px", height: "18px" }} />
                                    <span>
                                        {" "}
                                        I accept the{" "}
                                        <a target="_blank" href="https://mvclouds.com/products/signature-anywhere" className="termAndConditionLink">
                                            t & c ↗
                                        </a>
                                    </span>
                                </div>
                                <div className="bottom-bar-right">
                                    <div className="action-btns">
                                        <button className="reject-btn" onClick={handleReject}>
                                            Reject
                                        </button>
                                        <button className="save-submit-btn" onClick={handleSaveAndSubmit} disabled={!initialAccepted}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M17.8452 4.0874C19.1239 3.66152 20.3408 4.87805 19.9146 6.15674L15.6724 18.8823C15.2246 20.2247 13.3986 20.4032 12.6987 19.1733L10.1675 14.7222L12.6685 12.2222C12.9141 11.9765 12.9141 11.5782 12.6685 11.3325C12.4228 11.0868 12.0245 11.0868 11.7788 11.3325L9.27686 13.8335L4.82764 11.3032C3.59725 10.6034 3.77671 8.77723 5.11963 8.32959L17.8452 4.0874Z" fill="white" />
                                            </svg>
                                            Submit
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {!pdfFile && !loading && !error && !isExpired && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p>The URL is incorrect. Please contact the owner or sender of this link.</p>
                    </div>
                </div>
            )}

            <SignatureModal isOpen={isModalOpen} onClose={handleModalClose} onSave={handleSignatureSave} signature={currentSignature} title={currentSignature?.type === "text" ? "Enter Text" : currentSignature?.type === "initials" ? "Enter Initials" : "Create Signature"} />
            <FieldModal isOpen={isFieldModalOpen} onClose={handleFieldModalClose} onSave={handleFieldSave} field={currentField} />
            <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={handleCloseToast} />
        </div>
    );
}

export default App;