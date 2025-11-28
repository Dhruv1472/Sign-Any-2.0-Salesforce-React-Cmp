import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import html2pdf from "html2pdf.js";
import { updateSignatureWithImage, deleteSignatureImage, updateFieldWithValue, deleteFieldValue, updateNestedFieldValue, deleteNestedFieldValue } from "./utils/signatureUtils";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";

const A4_WIDTH = 595;
const A4_HEIGHT = 842;

function App() {
    const navigate = useNavigate();
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
    const [userIpAddress, setUserIpAddress] = useState(null);
    const [userLocation, setUserLocation] = useState(null);
    const [userMacAddress, setUserMacAddress] = useState(null);
    const [adminProperties, setAdminProperties] = useState(null);
    const [showSpinner, setShowSpinner] = useState(false);
    const [canvasScale, setCanvasScale] = useState(1);
    const [pdfPageFormat, setPdfPageFormat] = useState({ width: A4_WIDTH, height: A4_HEIGHT, orientation: "portrait" });
    const [showRejectConfirm, setShowRejectConfirm] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const canvasRefsArray = useRef([]);
    const pdfDocRef = useRef(null);
    const resizeTimeoutRef = useRef(null);

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

            fetchAdminProperties(accessToken, instanceUrl, clientId, clientSecret)
                .then((properties) => setAdminProperties(properties))
                .catch(() => setAdminProperties(null));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch IP address, location, and MAC address when the component mounts
    useEffect(() => {
        const fetchUserInfo = async () => {
            try {
                // Fetch IP address
                const ipRes = await fetch("https://api.ipify.org?format=json");
                const ipData = await ipRes.json();
                setUserIpAddress(ipData.ip);

                // Fetch location
                const location = await getLocationLive();
                setUserLocation(location);

                // Fetch MAC address (browser-based fingerprint as proxy)
                const macAddress = await getMacAddress();
                setUserMacAddress(macAddress);
            } catch (error) {
                console.warn("Could not fetch user info:", error);
                setUserIpAddress("Unknown IP");
                setUserLocation("Location Unavailable");
                setUserMacAddress("Unavailable");
            }
        };

        fetchUserInfo();
    }, []);

    // Debounced resize handler to re-render PDF pages when window resizes
    useEffect(() => {
        const handleResize = () => {
            // Clear existing timeout
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current);
            }

            // Set new timeout (300ms debounce)
            resizeTimeoutRef.current = setTimeout(() => {
                if (pdfDocRef.current && totalPages > 0) {
                    console.log("Window resized - re-rendering PDF pages");
                    renderAllPages(pdfDocRef.current);
                }
            }, 300);
        };

        window.addEventListener("resize", handleResize);

        // Cleanup
        return () => {
            window.removeEventListener("resize", handleResize);
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfDocRef.current, totalPages]);

    // ESC key handler for all modals
    useEffect(() => {
        const handleEscKey = (event) => {
            if (event.key === "Escape") {
                if (showRejectConfirm) handleCancelReject();
                else if (isModalOpen) handleModalClose();
                else if (isFieldModalOpen) handleFieldModalClose();
            }
        };

        if (isModalOpen || isFieldModalOpen || showRejectConfirm) {
            document.addEventListener("keydown", handleEscKey);
            return () => document.removeEventListener("keydown", handleEscKey);
        }
    }, [isModalOpen, isFieldModalOpen, showRejectConfirm]);

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
                if (documentData) setDocumentRecord(documentData);
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

            // Check if document is already submitted (Completed or Rejected status)
            if (documentData.Status__c === "Completed" || documentData.Status__c === "Rejected") {
                setIsSubmitted(true);
            }

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
                    setDocumentRecord(documentData);
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
                                // For checkboxes, value can be false which is valid
                                const fieldType = (field.fieldType || field.type || "").toLowerCase();
                                const hasValue = sigData.value !== undefined && sigData.value !== null && (sigData.value !== "" || fieldType === "checkbox");

                                return {
                                    ...field,
                                    imageUrl: sigData.imageUrl || null,
                                    ipAddress: sigData.ipAddress || field.ipAddress || "",
                                    timestamp: sigData.timestamp || field.timestamp || field.timeStamp || "",
                                    deviceInfo: sigData.deviceInfo || field.deviceInfo || "",
                                    locationInfo: sigData.locationInfo || field.locationInfo || "",
                                    macAddress: sigData.macAddress || field.macAddress || "",
                                    signatureType: sigData.signatureType || field.signatureType || "",
                                    value: sigData.value !== undefined && sigData.value !== null ? sigData.value : field.value,
                                    filled: Boolean(sigData.imageUrl || hasValue),
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

            // Detect PDF page format from first page
            if (pdf.numPages > 0) {
                const firstPage = await pdf.getPage(1);
                const viewport = firstPage.getViewport({ scale: 1 });
                const pageWidth = viewport.width;
                const pageHeight = viewport.height;

                // Determine orientation
                const orientation = pageWidth > pageHeight ? "landscape" : "portrait";

                // Store the detected page format
                setPdfPageFormat({
                    width: pageWidth,
                    height: pageHeight,
                    orientation: orientation,
                });

                console.log(`Detected PDF format: ${pageWidth.toFixed(2)}pt x ${pageHeight.toFixed(2)}pt (${orientation})`);
            }
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

    // Fetch Admin_Properties__c custom setting from Salesforce
    const fetchAdminProperties = async (accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            const query = `SELECT Email_Object_Field__c, Email_Address__c, Audit_Report_Behaviour__c, Available_Fonts__c, Default_Brush_Size__c, Default_Font_Size__c, Default_Font_Style__c, Hide_Available_Fonts__c, Hide_Bold_Option__c, Hide_Brush_Size__c, Hide_Font_Size_Option__c, Hide_Italic_Option__c, Hide_Pen_And_Erase__c, Hide_Undo_Redo__c FROM Admin_Properties__c LIMIT 1`;
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(query)}`;

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
                throw new Error(`Failed to fetch Admin Properties: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const properties = data?.records?.[0] || null;
            return properties;
        } catch (e) {
            console.warn("Unable to fetch Admin Properties:", e);
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

        // Show spinner during signature conversion
        setShowSpinner(true);

        // Use pre-fetched IP, location, and MAC address data
        const ipAddress = userIpAddress || "Unknown IP";
        const locationInfo = userLocation || "Location Unavailable";
        const macAddress = userMacAddress || "Unavailable";

        // Format timestamp as "Nov 21 2025, hh:mm:ss AM/PM TimeZone"
        const now = new Date();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[now.getMonth()];
        const day = now.getDate();
        const year = now.getFullYear();
        const timeString = now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        });
        // Get timezone abbreviation
        const timeZone = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
        const timeStamp = `${month} ${day} ${year}, ${timeString} ${timeZone}`;

        const userAgent = navigator.userAgent || "Unknown Device";

        const osMatch = userAgent.match(/\(([^;]+);/);
        const osVersion = osMatch ? osMatch[1].trim() : "Unknown OS";

        const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
        const chromeVersion = chromeMatch ? chromeMatch[1] : "Unknown Chrome Version";

        const deviceInfo = `${osVersion} Chrome/${chromeVersion}`;

        const signerObject = signature._parentSigner;

        // Create metadata object with all signature details
        const metadata = {
            ipAddress,
            deviceInfo,
            locationInfo,
            macAddress,
            timeStamp,
            signatureType,
        };

        // Pass metadata to updateSignatureWithImage function
        const updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData, signature.type, signerObject, metadata);

        setSignatureData(updatedSignatures);
        setSessionSignedKeys((prev) => new Set(prev).add(signature.index));

        // Hide spinner after signature is saved
        setShowSpinner(false);
    };

    // Handle field modal close
    const handleFieldModalClose = () => {
        setIsFieldModalOpen(false);
        setCurrentField(null);
    };

    const handleFieldSave = (value, field) => {
        if (!field.fieldType && !field.type) {
            console.error("Attempted to save field value to a signature:", field);
            return;
        }

        // Check if this field belongs to nested structure (has _parentSigner)
        if (field._parentSigner) {
            // Update nested field within signatureData
            const signerObject = field._parentSigner;
            const updatedSignatures = updateNestedFieldValue(signatureData, field.index, value, field.fieldType || field.type, signerObject);
            setSignatureData(updatedSignatures);
        } else {
            // Update flat field structure
            const updatedFields = updateFieldWithValue(fieldData, field.index, value, field.fieldType || field.type);
            setFieldData(updatedFields);
        }

        // Track that this field was filled in the current session
        setSessionFilledKeys((prev) => new Set(prev).add(field.index));
    };

    const handleFieldDelete = (field) => {
        // Check if this field belongs to nested structure (has _parentSigner)
        if (field._parentSigner) {
            // Delete nested field within signatureData
            const signerObject = field._parentSigner;
            const updatedSignatures = deleteNestedFieldValue(signatureData, field.index, field.fieldType || field.type, signerObject);
            setSignatureData(updatedSignatures);
        } else {
            // Delete flat field structure
            const updatedFields = deleteFieldValue(fieldData, field.index, field.fieldType || field.type);
            setFieldData(updatedFields);
        }

        // Remove from session filled keys
        setSessionFilledKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(field.index);
            return newSet;
        });
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
                // Check if nested structure
                if (field._parentSigner) {
                    const signerObject = field._parentSigner;
                    const updated = deleteNestedFieldValue(signatureData, field.index, "checkbox", signerObject);
                    setSignatureData(updated);
                } else {
                    const updated = deleteFieldValue(fieldData, field.index, "checkbox");
                    setFieldData(updated);
                }
                setSessionFilledKeys((prev) => {
                    const s = new Set(prev);
                    s.delete(field.index);
                    return s;
                });
            } else {
                // Check if nested structure
                if (field._parentSigner) {
                    const signerObject = field._parentSigner;
                    const updated = updateNestedFieldValue(signatureData, field.index, true, "checkbox", signerObject);
                    setSignatureData(updated);
                } else {
                    const updated = updateFieldWithValue(fieldData, field.index, true, "checkbox");
                    setFieldData(updated);
                }
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
        // Validate if all REQUIRED fields are filled for current priority
        const unfilledRequiredFields = signatureData
            .filter((sig) => sig.priority == urlPriority)
            .flatMap((sig) => sig.fields || [])
            .filter((field) => field.required === true && !field.filled);

        if (unfilledRequiredFields.length > 0) {
            // Show error toast
            setToast({
                isVisible: true,
                message: `Please complete all required fields. ${unfilledRequiredFields.length} required field(s) remaining.`,
                type: "error",
            });
        } else {
            try {
                // Show spinner during document saving
                setShowSpinner(true);

                // All signatures are completed
                if (!originalPdfBytes) {
                    throw new Error("Original PDF data not available");
                }

                // Load the original PDF using pdf-lib
                const pdfDoc = await PDFDocument.load(originalPdfBytes);
                const pages = pdfDoc.getPages();

                // Get all filled signature fields across all signatures
                const filledFieldsNew = signatureData.flatMap((s) =>
                    (s.fields || [])
                        .filter((f) => (f.type || f.fieldType || "").toLowerCase() == "signature") // Only include fields with type="signature"
                        .map((f) => ({ ...f, signerName: s.name || "--", signerEmail: s.email || "--" }))
                );
                console.log("filledFieldsNew==> ", filledFieldsNew);
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

                        // Add timestamp and signer name below the signature
                        const signerName = field._parentSigner?.name || field.signerName || "";
                        const timestamp = field.timeStamp || field.timestamp || "";

                        if (signerName || timestamp) {
                            // Embed font for text
                            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

                            // Create the metadata text on one line
                            let metadataText = "";
                            if (signerName && timestamp) {
                                metadataText = `${signerName} | ${timestamp}`;
                            } else if (signerName) {
                                metadataText = signerName;
                            } else {
                                metadataText = timestamp;
                            }

                            // Calculate font size relative to signature width (small text)
                            const fontSize = 8;
                            const textWidth = font.widthOfTextAtSize(metadataText, fontSize);

                            // Center the text below the signature
                            const textX = pdfX + (pdfWidth - textWidth) / 2;
                            const textY = pdfY - fontSize - 2; // Position below signature with small gap

                            // Draw a subtle line above the text
                            page.drawLine({
                                start: { x: pdfX, y: pdfY - 1 },
                                end: { x: pdfX + pdfWidth, y: pdfY - 1 },
                                thickness: 0.5,
                                color: rgb(0.88, 0.88, 0.88),
                            });

                            // Draw the metadata text
                            page.drawText(metadataText, {
                                x: textX,
                                y: textY,
                                size: fontSize,
                                font: font,
                                color: rgb(0.4, 0.4, 0.4), // Gray color
                            });
                        }
                    } catch (error) {
                        console.error("Error adding signature to PDF:", field.index, error);
                    }
                }

                // Get all filled fields from both flat fieldData and nested signatureData structures
                const flatFilledFields = fieldData.filter((field) => {
                    const hasValue = field.value !== null && field.value !== undefined && field.value !== "";
                    // For checkbox, false is a valid value
                    if (field.fieldType === "checkbox") {
                        return hasValue || field.value === false;
                    }
                    return (field.filled || hasValue) && hasValue;
                });

                // Get filled fields from nested structure (inside signatureData)
                const nestedFilledFields = signatureData.flatMap((sig) =>
                    (sig.fields || []).filter((field) => {
                        // Check if it's a field type (not signature)
                        const fieldType = (field.fieldType || field.type || "").toLowerCase();
                        const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(fieldType);

                        if (!isFieldType) return false;

                        const hasValue = field.value !== null && field.value !== undefined && field.value !== "";
                        // For checkbox, false is a valid value
                        if (fieldType === "checkbox") {
                            return hasValue || field.value === false;
                        }
                        return (field.filled || hasValue) && hasValue;
                    })
                );

                // Combine both flat and nested fields
                const filledFields = [...flatFilledFields, ...nestedFilledFields];

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

                        const fieldType = (field.fieldType || field.type || "").toLowerCase();

                        if (fieldType === "checkbox") {
                            isCheckbox = true;
                            checkboxChecked = field.value === true || field.value === "true" || field.value === "True";
                        } else {
                            displayValue = String(field.value || "");
                        }

                        // Draw checkbox
                        if (isCheckbox) {
                            const checkboxSize = Math.min(pdfWidth, pdfHeight) * 0.85;
                            const checkboxX = pdfX + (pdfWidth - checkboxSize) / 2;
                            const checkboxY = pdfY + (pdfHeight - checkboxSize) / 2;

                            // Draw checkbox border
                            page.drawRectangle({
                                x: checkboxX,
                                y: checkboxY,
                                width: checkboxSize,
                                height: checkboxSize,
                                borderColor: rgb(0, 0, 0),
                                borderWidth: 1,
                            });

                            // Draw checkmark if checked
                            if (checkboxChecked) {
                                const padding = checkboxSize * 0.25;
                                const checkStartX = checkboxX + padding;
                                const checkMidX = checkboxX + checkboxSize * 0.42;
                                const checkEndX = checkboxX + checkboxSize - padding;
                                const checkStartY = checkboxY + checkboxSize * 0.48;
                                const checkMidY = checkboxY + padding;
                                const checkEndY = checkboxY + checkboxSize - padding;

                                // Draw left part of checkmark (short line going down-right)
                                page.drawLine({
                                    start: { x: checkStartX, y: checkStartY },
                                    end: { x: checkMidX, y: checkMidY },
                                    thickness: 1.5,
                                    color: rgb(0, 0, 0),
                                });

                                // Draw right part of checkmark (long line going up-right)
                                page.drawLine({
                                    start: { x: checkMidX, y: checkMidY },
                                    end: { x: checkEndX, y: checkEndY },
                                    thickness: 1.5,
                                    color: rgb(0, 0, 0),
                                });
                            }
                        } else if (displayValue) {
                            // Draw text field
                            // Calculate font size based on field height (leave some padding)
                            const fontSize = 12;
                            const padding = 4;
                            const maxWidth = pdfWidth;
                            const lineHeight = fontSize * 1.4;

                            // Split text into words and build lines that fit within maxWidth
                            const words = displayValue.split(" ");
                            const lines = [];
                            let currentLine = words[0] || "";

                            for (let i = 1; i < words.length; i++) {
                                const word = words[i];
                                const testLine = currentLine + " " + word;
                                const testWidth = font.widthOfTextAtSize(testLine, fontSize);

                                if (testWidth <= maxWidth) {
                                    currentLine = testLine;
                                } else {
                                    lines.push(currentLine);
                                    currentLine = word;
                                }
                            }
                            lines.push(currentLine);

                            // Calculate starting Y position from top of field
                            const textY = pdfY + pdfHeight - padding - fontSize;

                            // Draw each line
                            for (let i = 0; i < lines.length; i++) {
                                const currentY = textY - i * lineHeight;
                                console.log("Drawing line on PDF:", lines[i], "at Y:", currentY);
                                // Only draw if within field bounds
                                if (currentY >= pdfY) {
                                    page.drawText(lines[i], {
                                        x: pdfX + padding,
                                        y: currentY,
                                        size: fontSize - 2,
                                        font: font,
                                        color: rgb(0, 0, 0),
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.error("Error adding form field to PDF:", field.index, error);
                    }
                }
                // Build audit report data from Salesforce record and signatures
                try {
                    await generateAuditHTML(documentRecord, signatureData, orgIdState, totalPages, pdfPageFormat);
                } catch (e) {
                    console.warn("Failed to append audit report page:", e);
                }

                // Merge audit report HTML as extra pages
                const htmlPdfBytes = await convertAuditHTMLToPDF();
                const finalDoc = await PDFDocument.load(await pdfDoc.save());
                const extraDoc = await PDFDocument.load(htmlPdfBytes);
                const htmlPages = await finalDoc.copyPages(extraDoc, extraDoc.getPageIndices());
                htmlPages.forEach((p) => finalDoc.addPage(p));

                const pdfBytes = await finalDoc.save();
                console.log("Final PDF byte size:", pdfBytes);
                // Generate SHA-256 hash of the final PDF
                const pdfHash = await generatePdfHash(pdfBytes);
                console.log("Generated PDF Hash:", pdfHash);

                // Upload to Salesforce if config is available
                if (salesforceConfig) {
                    // Determine FirstPublishLocationId
                    const firstPublishLocationId = documentRecord?.Record_Id__c || salesforceConfig.recordId;

                    // Check if all REQUIRED fields are filled before uploading
                    const allRequiredFieldsFilled = signatureData.every((sig) => (sig.fields || []).every((field) => field.required !== true || field.filled));

                    // Upload signed PDF as ContentVersion
                    let newContentVersionId = null;
                    if (allRequiredFieldsFilled) {
                        newContentVersionId = await uploadSignedPdfToSalesforce(pdfBytes, firstPublishLocationId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret, documentRecord.Document_Name__c);
                    }

                    // Update Document record with signature, field data, PDF hash, and new ContentVersion ID
                    await updateDocumentRecord(salesforceConfig.recordId, signatureData, fieldData, pdfHash, newContentVersionId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);

                    // Mark as submitted
                    setIsSubmitted(true);

                    // Show success toast
                    setToast({
                        isVisible: true,
                        message: "All signatures completed successfully! Signed PDF uploaded to Salesforce.",
                        type: "success",
                    });

                    // Navigate to thank you page and replace history so user can't go back
                    // setTimeout(() => {
                    navigate("/thank-you", { replace: true });
                    // }, 1500);
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

                    // Navigate to thank you page and replace history so user can't go back
                    // setTimeout(() => {
                    navigate("/thank-you", { replace: true });
                    // }, 1500);
                }
            } catch (error) {
                console.error("Error in save and submit:", error);
                setToast({
                    isVisible: true,
                    message: `Error creating signed PDF: ${error.message}`,
                    type: "error",
                });
            } finally {
                // Hide spinner after save process completes
                setShowSpinner(false);
            }
        }
    };

    // Upload signed PDF to Salesforce as ContentVersion
    const uploadSignedPdfToSalesforce = async (pdfBytes, firstPublishLocationId, accessToken, instanceUrl, clientId = null, clientSecret = null, documentName) => {
        try {
            let currentToken = accessToken;

            // Convert PDF bytes to base64
            const base64Pdf = Buffer.from(pdfBytes).toString("base64");

            // Create ContentVersion record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentVersion`;

            const contentVersionData = {
                Title: `${documentName} - Signed`,
                PathOnClient: `${documentName} - Signed.pdf`,
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
    const updateDocumentRecord = async (documentId, signatureData, fieldData, pdfHash, newContentVersionId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
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

            // Prepare update data
            const updateData = {
                Signing_Details__c: signatureDataJson,
                Document_Hash_Key__c: pdfHash,
            };

            // Add ContentVersion ID if provided
            if (newContentVersionId) {
                updateData.Final_Document_Id__c = newContentVersionId;
            }

            let response = await fetch(apiUrl, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(updateData),
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
                    body: JSON.stringify(updateData),
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

            // Extract all fields with imageUrl and nested field values from signatureData
            const fieldsWithImages = [];
            signatureData.forEach((sig) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    sig.fields.forEach((field) => {
                        const compositeKey = `${String(sig.priority)}_${String(field.index)}`;

                        // Store signature fields with images
                        if (field.filled && field.imageUrl) {
                            fieldsWithImages.push({
                                fieldIndex: compositeKey,
                                imageUrl: field.imageUrl,
                                ipAddress: field.ipAddress || "",
                                timestamp: field.timestamp || field.timeStamp || field.signedTime || "",
                                deviceInfo: field.deviceInfo || "",
                                locationInfo: field.locationInfo || "",
                                macAddress: field.macAddress || "",
                                signatureType: field.signatureType || "",
                                fieldType: "",
                                value: null,
                            });
                        }

                        // Also store nested text/date/number/email/checkbox fields with values
                        const fieldType = (field.fieldType || field.type || "").toLowerCase();
                        const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(fieldType);
                        const hasValue = field.value !== null && field.value !== undefined && (field.value !== "" || field.value === false);

                        if (isFieldType && hasValue && !field.imageUrl) {
                            fieldsWithImages.push({
                                fieldIndex: compositeKey,
                                imageUrl: "",
                                ipAddress: "",
                                timestamp: "",
                                deviceInfo: "",
                                locationInfo: "",
                                macAddress: "",
                                signatureType: "",
                                fieldType: fieldType,
                                value: field.value,
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
                    deviceInfo: field.deviceInfo,
                    locationInfo: field.locationInfo,
                    macAddress: field.macAddress,
                    signatureType: field.signatureType,
                    fieldType: field.fieldType || "",
                    value: field.value !== undefined ? field.value : null,
                });

                const recordData = {
                    Field_Index__c: field.fieldIndex,
                    Signing_Details__c: signingDetails,
                };

                // If record exists, add Id for update
                const existingId = existingMap.get(field.fieldIndex);
                if (existingId) {
                    recordData.Id = existingId;
                } else {
                    recordData.Document__c = documentId;
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
                console.log("isUpdate==> ", isUpdate);
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

                if (response.status === 201 || response.status === 204) {
                    return { success: true };
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
            console.log("Fetched Signature records:", data);
            return data.records || [];
        } catch (error) {
            console.error("Error fetching Signature records:", error);
            return [];
        }
    };

    // Build HTML for audit report
    const generateAuditHTML = async (doc, sigData, orgId, totalPages, pageFormat) => {
        console.log("Generating audit report HTML with document and signatures:", doc);
        console.log("Signature data:", sigData);
        console.log("Using page format:", pageFormat);

        // Helper function to format timestamp with smaller timezone
        const formatTimestamp = (timestamp) => {
            if (!timestamp || timestamp === "--") return "--";

            // Check if timestamp contains AM or PM followed by timezone
            const ampmRegex = /(.*?\s+(?:AM|PM|am|pm))(\s+.+)?$/;
            const match = timestamp.match(ampmRegex);

            if (match) {
                const mainPart = match[1]; // Date, time, AM/PM
                const timezonePart = match[2] || ""; // Everything after AM/PM (timezone)

                if (timezonePart.trim()) {
                    return `${mainPart} <span style="font-size:9px; color:#666;">${timezonePart.trim()}</span>`;
                }
            }

            return timestamp;
        };

        // Only include signature fields (those with type="signature"), exclude other field types
        const allFields = sigData.flatMap((s) =>
            (s.fields || [])
                .filter((f) => (f.type || f.fieldType || "").toLowerCase() == "signature") // Only include fields with type="signature"
                .map((f) => ({ ...f, signerName: s.name || "--", signerEmail: s.email || "--" }))
        );
        const signedFields = allFields.filter((f) => f.filled);
        const pendingFields = allFields.filter((f) => !f.filled);

        console.log("All signature fields:", allFields);
        console.log("Signed fields:", signedFields);
        console.log("Pending fields:", pendingFields);

        // SVG ICONS
        const SVG_TOTAL = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#E0F5FF"/><path d="M4 6C4 4.89688 4.89688 4 6 4H10.6719C11.2031 4 11.7125 4.20938 12.0875 4.58438L15.4125 7.91563C15.7875 8.29063 15.9969 8.8 15.9969 9.33125V12.3781L11.8719 16.5031H10.5562L10.0531 14.8281C9.90625 14.3375 9.45625 14.0031 8.94375 14.0031C8.59063 14.0031 8.25937 14.1625 8.04062 14.4375L6.1625 16.7812C5.90313 17.1031 5.95625 17.5781 6.27813 17.8344C6.6 18.0906 7.075 18.0406 7.33125 17.7156L8.80313 15.8781L9.27812 17.4625C9.37187 17.7812 9.66562 17.9969 9.99687 17.9969H10.9812C10.9531 18.0938 10.9281 18.1937 10.9094 18.2937L10.5687 19.9969H6C4.89688 19.9969 4 19.1 4 17.9969V5.99688V6ZM10.5 5.82812V8.75C10.5 9.16563 10.8344 9.5 11.25 9.5H14.1719L10.5 5.82812ZM12.3812 18.5906C12.4594 18.2031 12.65 17.8469 12.9281 17.5688L16.6438 13.8531L19.1438 16.3531L15.4281 20.0688C15.15 20.3469 14.7937 20.5375 14.4062 20.6156L12.5437 20.9875C12.5156 20.9937 12.4844 20.9969 12.4531 20.9969C12.2031 20.9969 11.9969 20.7937 11.9969 20.5406C11.9969 20.5094 12 20.4813 12.0062 20.45L12.3781 18.5875L12.3812 18.5906ZM20.75 14.7469L19.85 15.6469L17.35 13.1469L18.25 12.2469C18.9406 11.5562 20.0594 11.5562 20.75 12.2469C21.4406 12.9375 21.4406 14.0562 20.75 14.7469Z" fill="#42C0FF"/></svg>`;
        const SVG_SIGNED = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#E0FFEB"/><path d="M10.2882 4.11611C10.3768 4.1467 10.4636 4.18256 10.5485 4.2237L11.5635 4.72369C11.6993 4.79056 11.8487 4.82533 12.0002 4.82533C12.1516 4.82533 12.301 4.79056 12.4369 4.72369L13.4518 4.2237C13.7082 4.0975 13.9869 4.02304 14.272 4.00456C14.5571 3.98608 14.8431 4.02394 15.1136 4.11599C15.3841 4.20804 15.6338 4.35247 15.8484 4.54104C16.0631 4.7296 16.2385 4.9586 16.3647 5.21497L16.4224 5.34313L16.4723 5.47525L16.8362 6.54563C16.9351 6.83676 17.1637 7.0646 17.454 7.16349L18.5252 7.5274C18.8182 7.62709 19.0866 7.78815 19.3124 7.99982C19.5381 8.21149 19.7162 8.46891 19.8346 8.75487C19.9529 9.04084 20.0089 9.34877 19.9988 9.6581C19.9887 9.96744 19.9127 10.2711 19.7759 10.5487L19.2767 11.5637C19.2099 11.6995 19.1751 11.8489 19.1751 12.0004C19.1751 12.1518 19.2099 12.3012 19.2767 12.4371L19.7759 13.4521C19.9126 13.7297 19.9885 14.0332 19.9985 14.3425C20.0086 14.6517 19.9525 14.9595 19.8342 15.2454C19.7158 15.5313 19.5378 15.7886 19.3121 16.0002C19.0864 16.2118 18.8181 16.3729 18.5252 16.4726L17.454 16.8365C17.3108 16.8854 17.1806 16.9665 17.0736 17.0736C16.9666 17.1807 16.8857 17.311 16.837 17.4543L16.4723 18.5255C16.3726 18.8184 16.2115 19.0867 15.9999 19.3124C15.7883 19.5381 15.531 19.7161 15.2451 19.8345C14.9593 19.9529 14.6514 20.0089 14.3422 19.9989C14.033 19.9888 13.7294 19.9129 13.4518 19.7763L12.4369 19.2771C12.301 19.2102 12.1516 19.1754 12.0002 19.1754C11.8487 19.1754 11.6993 19.2102 11.5635 19.2771L10.5485 19.7763C10.2709 19.9129 9.96737 19.9888 9.65814 19.9989C9.3489 20.0089 9.04107 19.9529 8.75521 19.8345C8.46935 19.7161 8.21203 19.5381 8.00041 19.3124C7.7888 19.0867 7.62777 18.8184 7.52806 18.5255L7.16415 17.4543C7.1152 17.311 7.03395 17.1808 6.92668 17.0738C6.81942 16.9668 6.68901 16.8859 6.54551 16.8373L5.47515 16.4726C5.18218 16.3729 4.91384 16.212 4.68803 16.0004C4.46223 15.7888 4.28415 15.5315 4.1657 15.2456C4.04725 14.9597 3.99115 14.6519 4.00113 14.3426C4.01112 14.0333 4.08697 13.7297 4.22362 13.4521L4.7236 12.4371C4.79047 12.3012 4.82524 12.1518 4.82524 12.0004C4.82524 11.8489 4.79047 11.6995 4.7236 11.5637L4.22362 10.5487C4.08697 10.271 4.01112 9.96744 4.00113 9.65816C3.99115 9.34888 4.04725 9.04102 4.1657 8.75514C4.28415 8.46927 4.46223 8.21195 4.68803 8.00037C4.91384 7.78879 5.18218 7.62782 5.47515 7.52819L6.54551 7.16428C6.68903 7.11542 6.81939 7.03422 6.92652 6.92695C7.03366 6.81968 7.11469 6.68921 7.16336 6.54563L7.52727 5.47525C7.61926 5.20468 7.76366 4.95488 7.95222 4.74014C8.14077 4.52539 8.36978 4.34989 8.62618 4.22368C8.88257 4.09746 9.16132 4.023 9.4465 4.00454C9.73168 3.98609 10.0177 4.024 10.2882 4.11611ZM14.7453 9.6025L10.4575 13.8904L8.89588 12.0154C8.84671 11.9534 8.78563 11.9019 8.71625 11.8639C8.64688 11.8259 8.57059 11.8021 8.49189 11.794C8.41319 11.7859 8.33367 11.7936 8.258 11.8167C8.18232 11.8398 8.11203 11.8777 8.05125 11.9284C7.99047 11.979 7.94044 12.0413 7.90409 12.1116C7.86774 12.1819 7.84581 12.2587 7.8396 12.3376C7.83338 12.4165 7.843 12.4958 7.86789 12.5709C7.89278 12.646 7.93244 12.7153 7.98453 12.7749L9.96229 15.1482C10.015 15.2115 10.0804 15.2632 10.1542 15.2999C10.2279 15.3365 10.3086 15.3574 10.3909 15.3612C10.4732 15.365 10.5554 15.3516 10.6322 15.3219C10.7091 15.2922 10.7789 15.2468 10.8372 15.1886L15.5839 10.4419C15.6422 10.3876 15.6889 10.3221 15.7214 10.2493C15.7538 10.1765 15.7712 10.0979 15.7726 10.0183C15.774 9.93858 15.7594 9.85945 15.7295 9.78557C15.6997 9.71169 15.6553 9.64457 15.5989 9.58823C15.5426 9.53189 15.4755 9.48747 15.4016 9.45763C15.3277 9.42779 15.2486 9.41313 15.1689 9.41454C15.0893 9.41594 15.0107 9.43338 14.9379 9.46581C14.8651 9.49824 14.7996 9.545 14.7453 9.60329" fill="#00BD42"/></svg>`;
        const SVG_PENDING = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#FFECE0"/><path d="M20 12C20 14.1217 19.1571 16.1566 17.6569 17.6569C16.1566 19.1571 14.1217 20 12 20C9.87827 20 7.84344 19.1571 6.34315 17.6569C4.84285 16.1566 4 14.1217 4 12C4 9.87827 4.84285 7.84344 6.34315 6.34315C7.84344 4.84285 9.87827 4 12 4C14.1217 4 16.1566 4.84285 17.6569 6.34315C19.1571 7.84344 20 9.87827 20 12ZM12 7.5C12 7.36739 11.9473 7.24021 11.8536 7.14645C11.7598 7.05268 11.6326 7 11.5 7C11.3674 7 11.2402 7.05268 11.1464 7.14645C11.0527 7.24021 11 7.36739 11 7.5V13C11 13.0881 11.0234 13.1747 11.0676 13.2509C11.1119 13.3271 11.1755 13.3903 11.252 13.434L14.752 15.434C14.8669 15.4961 15.0014 15.5108 15.127 15.4749C15.2525 15.4391 15.3591 15.3556 15.4238 15.2422C15.4886 15.1288 15.5065 14.9946 15.4736 14.8683C15.4408 14.7419 15.3598 14.6334 15.248 14.566L12 12.71V7.5Z" fill="#EC6511"/></svg>`;

        const html = `
            <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
            <style>
                /* Scope audit styles to the audit container only to avoid leaking globally */
                #audit-html, #audit-html * {
                    font-family: 'Manrope', sans-serif !important;
                }

                #audit-html * {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
            </style>

            <div style="background:#FFFFFF;padding:0 24px 24px 24px;width:100%; font-family:'Manrope', sans-serif;">

                
                <div style="
                    background:#ffffff;
                    padding:10px 14px;
                    display:flex;
                    align-items:center;
                    height:40px;
                    margin:0 -24px 8px -24px;
                ">
                    <h2 style="color:#111; font-weight:700; font-size:16px; margin:0;">Audit Report</h2>
                </div>


                <!-- DOC INFO BOX -->
                <div style="
                    border:1px solid #E2E8F0; 
                    border-radius:8px; 
                    background:#ffffff;
                    padding:18px 20px;
                    margin-bottom:8px;
                ">
                    <h3 style="margin:0 0 12px 0; color:#111; font-size:16px; font-weight:600;">Document Information</h3>

                    <table style="width:100%; font-size:13px; border-collapse:collapse;">
                        <tr>
                            <td style="color:gray; padding-right:18px;">Sent Date:</td>
                            <td style="text-align:right;color:black; padding-right:18px;">${new Date(doc.CreatedDate).toLocaleString()}</td>
                            
                            <td style="color:gray; padding-right:18px;">Document ID:</td>
                            <td style="text-align:right;color:black; padding-left:18px;">${doc.Id || ""}</td>
                        </tr>
                        <tr>
                            <td style="color:gray; padding-right:18px;">Document Name:</td>
                            <td style="text-align:right;color:black; padding-right:18px;">${doc.Document_Name__c || ""}</td>
                            
                            <td style="color:gray; padding-right:18px;">Org ID:</td>
                            <td style="text-align:right;color:black; padding-left:18px;">${orgId || ""}</td>
                        </tr>
                        <tr>
                            <td style="color:gray; padding-right:18px;">Document Sender:</td>
                            <td style="text-align:right;color:black; padding-right:18px;">${doc.CreatedBy?.Name || ""}</td>
                            
                            <td style="color:gray; padding-right:18px;">Document Status:</td>
                            <td style="text-align:right; padding-left:18px;">
                                <span style="color:#00BD42; font-weight:600;background:#E0FFEB;padding:0px 8px 4px 8px;border-radius:8px;font-size:11px;align-items:center;">${allFields.length > 0 && signedFields.length === allFields.length ? "Completed" : doc.Status__c || ""}</span>
                            </td>
                        </tr>
                        <tr>
                            <td style="color:gray; padding-right:18px;">Doc. Sender Email:</td>
                            <td style="text-align:right;color:black; padding-right:18px;">${doc.CreatedBy?.Email || ""}</td>
                            
                            <td style="color:gray; padding-right:18px;">Email Subject:</td>
                            <td style="text-align:right;color:black;">${doc.Email_Subject__c && doc.Email_Subject__c.length > 25 ? doc.Email_Subject__c.slice(0, 25) + "..." : doc.Email_Subject__c || ""}</td>
                        </tr>
                        <tr>
                            <td style="color:gray; padding-right:18px;">Document Pages:</td>
                            <td style="text-align:right;color:black; padding-right:18px;">${totalPages || ""}</td>
                            
                        </tr>
                    </table>

                </div>

                <!-- SIGNATURE SUMMARY -->
                <div style="display:flex;gap:12px;margin-bottom:8px;">
                    <div style="
                        border:1px solid #E2E8F0;
                        border-radius:8px;
                        padding:14px 16px;
                        display:flex;
                        align-items:center;
                        height:58px;
                        flex:1;
                        background:#fff;
                        justify-content:space-between;
                    ">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:16px;font-weight:700;color:#111;">${allFields.length}</span>
                            <span style="font-size:12px; color:#444;">Total Signatures</span>
                        </div>
                        ${SVG_TOTAL}
                    </div>

                    <div style="
                        border:1px solid #E2E8F0;
                        border-radius:8px;
                        padding:14px 16px;
                        display:flex;
                        align-items:center;
                        height:58px;
                        flex:1;
                        background:#fff;
                        justify-content:space-between;
                    ">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:16px;font-weight:700;color:#111;">${signedFields.length}</span>
                            <span style="font-size:12px; color:#444;">Signed</span>
                        </div>
                        ${SVG_SIGNED}
                    </div>

                    <div style="
                        border:1px solid #E2E8F0;
                        border-radius:8px;
                        padding:14px 16px;
                        display:flex;
                        align-items:center;
                        height:58px;
                        flex:1;
                        background:#fff;
                        justify-content:space-between;
                    ">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:16px;font-weight:700;color:#111;">${pendingFields.length}</span>
                            <span style="font-size:12px; color:#444;">Pending</span>
                        </div>
                        ${SVG_PENDING}
                    </div>
                </div>

                <!-- SIGNATURE EVENTS -->
                <div style="
                    border:1px solid #E2E8F0; 
                    border-radius:8px; 
                    background:#ffffff;
                    padding:16px 0 0 0 ;
                    margin-bottom:12px;
                ">
                    <h3 style="margin:0 0 10px 0;color:#111;font-weight:600;font-size:15px;margin-left:18px">Signature Events</h3>

                    <table style="width:100%; border-collapse:collapse; font-size:10px;">
                        <thead>
                            <tr style="background:#F1F3F4; color:#444;">
                                <th style="padding:6px; width:22%; text-align:center;">SIGNATURE</th>
                                <th style="padding:6px; width:38%; text-align:center;">SIGNATURE DETAILS</th>
                                <th style="padding:6px; width:30%; text-align:center;">USER DETAILS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allFields
                                .map(
                                    (f) => `
                            <tr style="border-top:1px solid #E2E8F0;">
                                <td style="padding:8px 0 8px 18px; text-align:center;">
                                    ${
                                        f.imageUrl
                                            ? `<img src="${f.imageUrl}" 
                                            style="height:55px;width:110px;object-fit:contain;background:#fff;" />`
                                            : `<div style="border:1px solid #CBD5E0;height:35px;width:60px;border-radius:4px;background:#fff;display:flex;align-items:center;justify-content:center;margin:auto;">
                                                <span style="font-size:11px;color:#555;">#${f.index}</span>
                                        </div>`
                                    }
                                </td>
                                <td style="padding:8px; vertical-align:middle;">
                                    <table style="width:100%; border-collapse:collapse;">
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:80px;">Signed On:</td>
                                            <td style="color:black;">${formatTimestamp(f.timestamp || f.timeStamp || f.signedTime || "--")}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:80px;">Device:</td>
                                            <td style="color:black;">${f.deviceInfo || "--"}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:80px;">Location:</td>
                                            <td style="color:black;">${f.locationInfo || "--"}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:80px;">Sign Type:</td>
                                            <td style="color:black;">
                                                <span style="color:#0066FF; font-weight:600;background:#E0F0FF;padding:0px 8px 4px 8px;border-radius:8px;font-size:9px;">
                                                    ${(f.signatureType || "--").toUpperCase()}
                                                </span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                                <td style="padding:8px; vertical-align:middle;">
                                    <table style="width:100%; border-collapse:collapse;">
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:50px;">Name:</td>
                                            <td style="color:black;">${f.signerName || "--"}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:50px;">Email:</td>
                                            <td style="color:black;">${f.signerEmail || "--"}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:50px;">IP:</td>
                                            <td style="color:black;">${f.ipAddress || "--"}</td>
                                        </tr>
                                        <tr>
                                            <td style="color:gray; padding-right:12px; width:50px;">Bro. Fin.:</td>
                                            <td style="color:black;">${f.macAddress || "--"}</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>`
                                )
                                .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById("audit-html").innerHTML = html;
        await new Promise((resolve) => setTimeout(resolve, 300));
    };

    // Convert to PDF via html2pdf
    const convertAuditHTMLToPDF = async () => {
        const element = document.getElementById("audit-html");

        element.style.visibility = "visible";
        element.style.position = "static";
        element.style.zIndex = "9999";

        await new Promise((res) => setTimeout(res, 400));

        // Use detected PDF page format for audit report
        const pageWidth = pdfPageFormat.width || A4_WIDTH;
        const pageHeight = pdfPageFormat.height || A4_HEIGHT;
        const orientation = pdfPageFormat.orientation || "portrait";

        console.log(`Generating audit report with format: ${pageWidth.toFixed(2)}pt x ${pageHeight.toFixed(2)}pt (${orientation})`);

        const pdfBlob = await html2pdf()
            .from(element)
            .set({
                margin: 0,
                filename: "audit.pdf",
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: {
                    unit: "pt",
                    format: [pageWidth, pageHeight],
                    orientation: orientation,
                },
            })
            .output("blob");

        // Download
        // const url = URL.createObjectURL(pdfBlob);
        // const a = document.createElement("a");
        // a.href = url;
        // a.download = "audit.pdf";
        // a.click();
        // URL.revokeObjectURL(url);

        const arrayBuffer = await pdfBlob.arrayBuffer();

        element.style.visibility = "hidden";
        element.style.position = "absolute";
        element.style.top = "-9999px";
        // Clean up injected HTML to prevent any lingering scoped styles
        element.innerHTML = "";

        return arrayBuffer;
    };

    const handleReject = () => {
        // Show confirmation modal instead of rejecting directly
        setRejectReason(""); // Clear previous reason
        setShowRejectConfirm(true);
    };

    const handleConfirmReject = async () => {
        // Validate that reason is provided
        if (!rejectReason.trim()) {
            setToast({
                isVisible: true,
                message: "Please provide a reason for rejection",
                type: "error",
            });
            return;
        }

        // Close the confirmation modal
        setShowRejectConfirm(false);

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
                    Rejection_Reason__c: rejectReason.trim(),
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
                        Rejection_Reason__c: rejectReason.trim(),
                    }),
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to update Status__c: ${response.status}`);
            }

            // Navigate to rejected page and replace history so user can't go back
            navigate("/rejected", { replace: true });
        } catch (error) {
            console.error("Reject error:", error);
            setToast({
                isVisible: true,
                message: `Error rejecting document: ${error.message}`,
                type: "error",
            });
        }
    };

    const handleCancelReject = () => {
        // Close the confirmation modal without rejecting
        setRejectReason(""); // Clear reason
        setShowRejectConfirm(false);
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

    // Close toast
    const handleCloseToast = () => {
        setToast({ isVisible: false, message: "", type: "success" });
    };

    // Check if all signatures for current priority are completed
    const areAllSignaturesCompleted = () => {
        if (isSubmitted) {
            return false;
        }

        // Get all fields for current priority
        const currentPriorityFields = signatureData.filter((sig) => sig.priority == urlPriority).flatMap((sig) => sig.fields || []);

        // If no fields, return false
        if (currentPriorityFields.length === 0) {
            return false;
        }

        // Check if all fields are filled
        const allFilled = currentPriorityFields.every((field) => field.filled);

        return allFilled;
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

        // Calculate target width based on available space
        // Try to get actual canvas wrapper width from DOM
        const canvasWrapper = document.querySelector(".canvas-wrapper");
        let targetWidth = 800;

        if (canvasWrapper) {
            // Get the actual rendered width of the canvas wrapper after CSS is applied
            const wrapperWidth = canvasWrapper.getBoundingClientRect().width;
            // Subtract padding if needed (canvas-wrapper has no padding, but be safe)
            targetWidth = Math.min(Math.max(wrapperWidth - 10, 300), 800);
        } else {
            // Fallback: calculate based on window width
            const windowWidth = window.innerWidth;
            if (windowWidth < 900) {
                // Account for container padding and margins (roughly 80px total)
                targetWidth = Math.max(Math.min(windowWidth - 80, 800), 300);
            }
        }

        console.log("Rendering PDF with target width:", targetWidth);

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const canvas = canvasRefsArray.current[pageNum - 1];
            if (canvas) {
                const dims = await renderPage(pdf, pageNum, canvas, targetWidth);
                dimensions.push(dims);
                // Update scale state with the first page's scale (all pages use same scale)
                if (pageNum === 1 && dims) {
                    setCanvasScale(dims.scale);
                    console.log("Updated canvas scale to:", dims.scale);
                }
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
                    enableHighAccuracy: false, // Changed to false for faster response
                    timeout: 8000, // Increased timeout
                    maximumAge: 60000, // Accept cached position up to 1 minute old
                });
            });

            const { latitude, longitude } = coords.coords;

            // Reverse geocode to city/state/country
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
            const data = await res.json();
            const address = data.address;

            const city = address.city || address.state_district || address.town || address.village || "Unknown City";
            const state = address.state || "Unknown State";
            const country = address.country || "Unknown Country";
            return `${city}, ${state}, ${country}`;
        } catch (gpsError) {
            console.warn("GPS failed, fallback to IP-based location:", gpsError);
            return "Location Unavailable";
        }
    };

    // MAC address cannot be retrieved from browser for security reasons
    // We'll create a browser fingerprint as a unique identifier instead
    const getMacAddress = async () => {
        try {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            ctx.textBaseline = "top";
            ctx.font = "14px Arial";
            ctx.fillText("Browser Fingerprint", 2, 2);
            const canvasData = canvas.toDataURL();

            // Create a hash-like identifier from canvas fingerprint + user agent + screen info
            const fingerprint = [canvasData.slice(-50), navigator.userAgent, navigator.language, screen.colorDepth, screen.width + "x" + screen.height, new Date().getTimezoneOffset()].join("|");

            // Generate a MAC-like format from the fingerprint
            let hash = 0;
            for (let i = 0; i < fingerprint.length; i++) {
                hash = (hash << 5) - hash + fingerprint.charCodeAt(i);
                hash = hash & hash;
            }

            const macLike = Math.abs(hash).toString(16).padStart(12, "0").slice(0, 12);
            const formatted = macLike
                .match(/.{1,2}/g)
                .join(":")
                .toUpperCase();

            return formatted;
        } catch (error) {
            console.warn("Could not generate device fingerprint:", error);
            return "Unavailable";
        }
    };

    // Function to generate SHA-256 hash of PDF bytes
    const generatePdfHash = async (pdfBytes) => {
        try {
            // Convert Uint8Array to ArrayBuffer if needed
            const buffer = pdfBytes instanceof Uint8Array ? pdfBytes.buffer : pdfBytes;

            // Generate SHA-256 hash
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

            // Convert hash to hex string
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

            return hashHex;
        } catch (error) {
            console.error("Error generating PDF hash:", error);
            throw error;
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
            {/* {loading && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p>Loading PDF from Salesforce...</p>
                    </div>
                </div>
            )} */}
            {error && !pdfFile && !isExpired && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p style={{ color: "#d32f2f" }}>The URL is not right. Please contact the sender of this link.</p>
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

                    <p className="expired-hint" style={{ fontWeight: 500, marginTop: "12px" }}>
                        Please contact the document sender:
                    </p>
                    <p className="expired-hint" style={{ marginTop: "4px", fontSize: "14px" }}>
                        <strong>{documentRecord?.CreatedBy?.Name || "Unknown User"}</strong>
                        <br />
                        <span style={{ color: "#555" }}>{documentRecord?.CreatedBy?.Email || "No Email Available"}</span>
                    </p>
                </div>
            )}

            {pdfFile && !isExpired && (
                <>
                    <div className="pdf-container">
                        <div className="heading">
                            <h1 className="document-header">Review & Sign Document : {documentRecord?.Document_Name__c || ""}</h1>
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
                                                {signatureData.length > 0 && <SignatureOverlay key={`sig-overlay-${pageNumber}-${canvasScale}`} pageNumber={pageNumber} priority={urlPriority} signatures={signatureData} onSign={handleSignatureClick} onFieldClick={handleFieldClick} onFieldSave={handleFieldSave} onDelete={handleSignatureDelete} onFieldDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionSignedKeys={sessionSignedKeys} sessionFilledKeys={sessionFilledKeys} canvasScale={canvasScale} />}
                                                {fieldData.length > 0 && <FieldOverlay key={`field-overlay-${pageNumber}-${canvasScale}`} pageNumber={pageNumber} priority={urlPriority} fields={fieldData} onFieldClick={handleFieldClick} onFieldSave={handleFieldSave} onDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionFilledKeys={sessionFilledKeys} canvasScale={canvasScale} />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        {shouldShowSaveButton() && areAllSignaturesCompleted() && (
                            <div className={`completion-footer ${areAllSignaturesCompleted() ? "show" : ""}`}>
                                <div className="completion-content">
                                    <div className="completion-icon">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <circle cx="12" cy="12" r="10" fill="#626262" />
                                            <path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <div className="completion-text">
                                        <h3>All Signatures Completed!</h3>
                                        <p>You have successfully signed all required fields in this document.</p>
                                    </div>
                                    <div className="completion-actions">
                                        <input type="checkbox" id="accept-terms" checked={initialAccepted} onChange={(e) => setInitialAccepted(e.target.checked)} style={{ cursor: "pointer", width: "18px", height: "18px" }} />
                                        <label htmlFor="accept-terms" style={{ cursor: "pointer", marginLeft: "8px" }}>
                                            I accept the{" "}
                                            <a target="_blank" href="https://mvclouds.com/products/signature-anywhere" className="termAndConditionLink">
                                                terms & conditions ↗
                                            </a>
                                        </label>
                                        <button className="submit-final-btn" onClick={handleSaveAndSubmit} disabled={!initialAccepted}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M17.8452 4.0874C19.1239 3.66152 20.3408 4.87805 19.9146 6.15674L15.6724 18.8823C15.2246 20.2247 13.3986 20.4032 12.6987 19.1733L10.1675 14.7222L12.6685 12.2222C12.9141 11.9765 12.9141 11.5782 12.6685 11.3325C12.4228 11.0868 12.0245 11.0868 11.7788 11.3325L9.27686 13.8335L4.82764 11.3032C3.59725 10.6034 3.77671 8.77723 5.11963 8.32959L17.8452 4.0874Z" fill="white" />
                                            </svg>
                                            Submit Document
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* this is replacte  html code of submit button footer for responsive page */}
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
                        <p>The URL is incorrect. Please contact the sender of this link.</p>
                    </div>
                </div>
            )}

            <SignatureModal isOpen={isModalOpen} onClose={handleModalClose} onSave={handleSignatureSave} signature={currentSignature} title={currentSignature?.type === "text" ? "Enter Text" : currentSignature?.type === "initials" ? "Enter Initials" : "Create Signature"} adminProperties={adminProperties} />
            <FieldModal isOpen={isFieldModalOpen} onClose={handleFieldModalClose} onSave={handleFieldSave} field={currentField} />
            <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={handleCloseToast} />
            <div id="audit-html" style={{ position: "absolute", top: "-9999px", left: "-9999px" }}></div>

            {/* Rejection Confirmation Modal */}
            {showRejectConfirm && (
                <div className="reject-confirm-overlay" onClick={handleCancelReject}>
                    <div className="reject-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="reject-confirm-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 13C11.45 13 11 12.55 11 12V8C11 7.45 11.45 7 12 7C12.55 7 13 7.45 13 8V12C13 12.55 12.55 13 12 13ZM13 17H11V15H13V17Z" fill="#d32f2f" />
                            </svg>
                        </div>
                        <h3 className="reject-confirm-title">Reject Document?</h3>
                        <p className="reject-confirm-message">Are you sure you want to reject this document? This action cannot be undone.</p>
                        <div className="reject-reason-field">
                            <label htmlFor="reject-reason">
                                Reason for Rejection <span style={{ color: "#d32f2f" }}>*</span>
                            </label>
                            <textarea
                                id="reject-reason"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="Please provide a reason for rejecting this document..."
                                rows="4"
                                style={{
                                    width: "100%",
                                    padding: "10px",
                                    borderRadius: "6px",
                                    border: "1px solid #ddd",
                                    fontSize: "14px",
                                    fontFamily: "inherit",
                                    resize: "vertical",
                                    minHeight: "80px",
                                }}
                            />
                        </div>
                        <div className="reject-confirm-actions">
                            <button className="reject-cancel-btn" onClick={handleCancelReject}>
                                Cancel
                            </button>
                            <button
                                className="reject-confirm-btn"
                                onClick={handleConfirmReject}
                                disabled={!rejectReason.trim()}
                                style={{
                                    opacity: !rejectReason.trim() ? 0.5 : 1,
                                    cursor: !rejectReason.trim() ? "not-allowed" : "pointer",
                                }}>
                                Yes, Reject
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Spinner Overlay */}
            {(showSpinner || loading) && (
                <div className="spinner-overlay">
                    <div className="spinner"></div>
                </div>
            )}
        </div>
    );
}

export default App;
