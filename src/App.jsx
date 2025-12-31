import { useState, useRef, useEffect } from "react";

import { Buffer } from "buffer";
import "./pdfjs/pdf.worker.min.mjs";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { useNavigate } from "react-router-dom";

import SignatureOverlay from "./components/SignatureOverlay";
import SignatureModal from "./components/SignatureModal";
import FieldOverlay from "./components/FieldOverlay";
import FieldModal from "./components/FieldModal";
import Toast from "./components/Toast";

import { updateSignatureWithImage, deleteSignatureImage, updateFieldWithValue, deleteFieldValue, updateNestedFieldValue, deleteNestedFieldValue } from "./utils/signatureUtils";
import { decryptUrlParams, parseQueryString, encryptUrlParams, buildQueryString } from "./utils/encryption";
import { generateAuditHTML, convertAuditHTMLToPDF } from "./utils/auditReport";

import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";

const A4_WIDTH = 595;
const A4_HEIGHT = 842;

function App() {
    const navigate = useNavigate();

    // App State
    const [showSpinner, setShowSpinner] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState({ isVisible: false, message: "", type: "success" });

    // Document Status Flags
    const [isInactive, setIsInactive] = useState(false);
    const [isExpired, setIsExpired] = useState(false);
    const [isRejectedSimultaneous, setIsRejectedSimultaneous] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);

    // URL Parameters
    const [urlPriority, setUrlPriority] = useState(null);

    // PDF Properties
    const [pdfFile, setPdfFile] = useState(null);
    const [originalPdfBytes, setOriginalPdfBytes] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [pdfPageFormat, setPdfPageFormat] = useState({ width: A4_WIDTH, height: A4_HEIGHT, orientation: "portrait" });
    const [canvasScale, setCanvasScale] = useState(1);

    // Document Properties
    const [salesforceConfig, setSalesforceConfig] = useState(null);
    const [adminProperties, setAdminProperties] = useState(null);
    const [documentRecord, setDocumentRecord] = useState(null);
    const [orgIdState, setOrgIdState] = useState(null);
    const [localeKey, setLocaleKey] = useState(null);
    const [timeZoneKey, setTimeZoneKey] = useState(null);

    // Field and Signature Properties
    const [signatureData, setSignatureData] = useState([]);
    const [initialSignatureData, setInitialSignatureData] = useState([]);
    const [fieldData, setFieldData] = useState([]);
    const [initialAccepted, setInitialAccepted] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);

    const [currentSignature, setCurrentSignature] = useState(null);
    const [currentField, setCurrentField] = useState(null);

    const [sessionSignedKeys, setSessionSignedKeys] = useState(new Set());
    const [sessionFilledKeys, setSessionFilledKeys] = useState(new Set());

    // User Info
    const [userIpAddress, setUserIpAddress] = useState(null);
    const [userLocation, setUserLocation] = useState(null);
    const [userDeviceUniqueKey, setUserDeviceUniqueKey] = useState(null);

    // Reject Modal State
    const [showRejectConfirm, setShowRejectConfirm] = useState(false);
    const [rejectReason, setRejectReason] = useState("");

    const canvasRefsArray = useRef([]);
    const pdfDocRef = useRef(null);
    const resizeTimeoutRef = useRef(null);
    const broadcastChannelRef = useRef(null);

    // State for storing first signature/initial for quick reuse (same priority only)
    const [storedSignature, setStoredSignature] = useState({ signBase64: null, arrStored: [], signatureType: "" });
    const [storedInitials, setStoredInitials] = useState({ signBase64: null, arrStored: [], signatureType: "" });

    // Setup BroadcastChannel for cross-tab communication
    useEffect(() => {
        const currentUrl = window.location.href;

        // Create a unique channel name based on the document URL
        const channelName = `document-sync-${btoa(currentUrl).replace(/=/g, "")}`;

        // Create the broadcast channel
        if (typeof BroadcastChannel !== "undefined") {
            broadcastChannelRef.current = new BroadcastChannel(channelName);

            broadcastChannelRef.current.onmessage = (event) => {
                if (event.data.type === "DOCUMENT_SUBMITTED") {
                    setToast({ isVisible: true, message: "Document was submitted in another tab. Refreshing...", type: "success" });

                    // Reload the page after a short delay to show the toast
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                }
            };
        } else {
            console.warn("BroadcastChannel API is not supported in this browser");
        }

        // Cleanup: close the channel when component unmounts
        return () => {
            if (broadcastChannelRef.current) {
                broadcastChannelRef.current.close();
            }
        };
    }, []);

    // Warn user before leaving if there are unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = ""; // Required for Chrome
        };

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, []);

    // Parse URL parameters on initial load
    useEffect(() => {
        const parseUrlParams = async () => {
            let accessToken, recordId, instanceUrl, clientId, clientSecret, priority;

            const urlParams = new URLSearchParams(window.location.search);
            const encryptedQuery = urlParams.get("q");
            if (encryptedQuery) {
                try {
                    // Decrypt the query string
                    const decryptedString = await decryptUrlParams(encryptedQuery);
                    const decryptedParams = parseQueryString(decryptedString);

                    // Extract parameters from decrypted string
                    accessToken = decryptedParams.act || decryptedParams.accessToken;
                    recordId = decryptedParams.recordId;
                    instanceUrl = decryptedParams.instanceUrl;
                    clientId = decryptedParams.clientId;
                    clientSecret = decryptedParams.clientSecret;
                    priority = decryptedParams.priority;
                } catch (error) {
                    console.error("Failed to decrypt URL:", error);
                    setError("Invalid or tampered URL. Please contact the sender for a new link.");
                    return;
                }
            } else {
                // Handle unencrypted URL (backward compatibility)
                accessToken = urlParams.get("act");
                recordId = urlParams.get("recordId");
                instanceUrl = urlParams.get("instanceUrl");
                clientId = urlParams.get("clientId");
                clientSecret = urlParams.get("clientSecret");
                priority = urlParams.get("priority");
            }

            const parsedPriority = priority ? parseInt(priority, 10) : 1;
            setUrlPriority(parsedPriority);

            if (recordId && instanceUrl) {
                setSalesforceConfig({ accessToken, recordId, instanceUrl, clientId, clientSecret });
                fetchAdminProperties(accessToken, instanceUrl, clientId, clientSecret);
                fetchOrganizationId(accessToken, instanceUrl, clientId, clientSecret);
                fetchDocumentAndPdf(recordId, accessToken, instanceUrl, clientId, clientSecret);
            }
        };

        parseUrlParams();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch IP address, location, and device unique key when the component mounts
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

                // Fetch device unique key (browser-based fingerprint)
                const deviceUniqueKey = await getDeviceUniqueKey();
                setUserDeviceUniqueKey(deviceUniqueKey);
            } catch (error) {
                console.warn("Could not fetch user info:", error);
                setUserIpAddress("Unknown IP");
                setUserLocation("Location Unavailable");
                setUserDeviceUniqueKey("Unavailable");
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

        try {
            // Step 1: Fetch Document__c record to get ContentVersion ID and signature/field data
            const { contentVersionId, currentToken, documentData, signatureData, fieldData, isExpired, isRejectedSimultaneous, isInactive } = await fetchDocumentRecord(documentId, accessToken, instanceUrl, clientId, clientSecret);

            if (documentData) {
                setDocumentRecord(documentData);
            }

            if (isInactive || isRejectedSimultaneous || isExpired) {
                setLoading(false);
                return;
            }

            const signatures = Array.isArray(signatureData) ? signatureData : [];
            setSignatureData(signatures);
            setInitialSignatureData(JSON.parse(JSON.stringify(signatures)));
            const fields = Array.isArray(fieldData) ? fieldData : [];
            setFieldData(fields);

            // Check if document is already submitted (Completed or Rejected status)
            if (documentData.Status__c === "Completed" || documentData.Status__c === "Rejected") {
                setIsSubmitted(true);
                // Show toast notification based on status
                if (documentData.Status__c === "Completed") {
                    setToast({ isVisible: true, message: "This document has already been signed and completed.", type: "info" });
                } else if (documentData.Status__c === "Rejected") {
                    setToast({ isVisible: true, message: "This document has been rejected.", type: "error" });
                }
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
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(`SELECT Id, Uploaded_Document_Id__c, Signing_Details__c, Status__c, CreatedDate, CreatedBy.Name, CreatedBy.Email, Email_Subject__c, Document_Name__c, Expiration_Date__c, Send_Emails_Simultaneously__c, Active__c, Store_On_Parent_Record__c, Record_ID__c FROM Document__c WHERE Id='${documentId}' LIMIT 1`)}`;

            let response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
            });

            // If token expired (401), try to refresh it
            if (response.status === 401 && clientId && clientSecret) {
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
                console.error(`Document fetch error: ${response.status} ${response.statusText}`);
                throw new Error("Unable to load the document. Please check the link and try again.");
            }

            const data = await response.json();
            const documentData = data.records[0];

            // Check if document is inactive
            if (documentData.Active__c === false) {
                setIsInactive(true);
                setDocumentRecord(documentData);
                setError(null);
                return { isInactive: true };
            }

            // Check if document is rejected with simultaneous emails
            if (documentData.Send_Emails_Simultaneously__c === true && documentData.Status__c === "Rejected") {
                setIsRejectedSimultaneous(true);
                setDocumentRecord(documentData);
                setError(null);
                return { isRejectedSimultaneous: true };
            }

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
            if (!contentVersionId) {
                throw new Error("Document not found. Please contact the sender for a new link.");
            }

            const signatureDataJson = documentData.Signing_Details__c;
            if (!signatureDataJson) {
                throw new Error("No signature data found for this document.");
            }

            // Parse signature and field data if available
            let parsedSignatureData = [];
            let parsedFieldData = [];
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
                        } else {
                            // Old flat structure (backward compatibility)
                            const typeLower = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
                            const isFieldType = ["text", "date", "number", "email", "checkbox"].includes(typeLower);
                            const isSignatureType = ["signature", "initials"].includes(typeLower) || (!isFieldType && !entry.fieldType);
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

                            // Helper function to generate default value based on field type
                            const getDefaultValueForField = (field, signerName, signerEmail) => {
                                if (field.defaultValue === "{defaultValue}") {
                                    const fieldType = (field.fieldType || field.type || "").toLowerCase();

                                    if (fieldType === "signature") {
                                        // For signature fields, use signer's full name
                                        return signerName || "";
                                    } else if (fieldType === "initials") {
                                        // For initials fields, extract first letter of each word
                                        if (!signerName) return "";
                                        return signerName
                                            .split(/\s+/)
                                            .map((word) => word.charAt(0).toUpperCase())
                                            .join("");
                                    } else if (fieldType === "email") {
                                        // For email fields, use signer's email
                                        return signerEmail || "";
                                    }
                                }
                                return field.defaultValue;
                            };

                            // Auto-fill readonly fields with default value if not already filled
                            if (field.readonly === true && !field.filled && field.defaultValue) {
                                return {
                                    ...field,
                                    value: getDefaultValueForField(field, sig.name, sig.email),
                                    filled: true,
                                };
                            }

                            // Auto-populate {defaultValue} fields for current user's priority
                            if (!field.filled && field.defaultValue === "{defaultValue}" && sig.priority == urlPriority) {
                                const fieldType = (field.fieldType || field.type || "").toLowerCase();
                                const computedValue = getDefaultValueForField(field, sig.name, sig.email);

                                // Replace {defaultValue} with computed value in defaultValue property
                                // This allows the value to be passed to modals for pre-population
                                // For text-based fields (text, email), auto-fill them immediately
                                // For signature-based fields (signature, initials), set defaultValue but don't auto-fill
                                if (computedValue) {
                                    const isTextBasedField = ["text", "email", "date", "number", "checkbox"].includes(fieldType);
                                    return {
                                        ...field,
                                        defaultValue: computedValue,
                                        value: isTextBasedField ? computedValue : field.value,
                                        filled: isTextBasedField ? true : field.filled,
                                    };
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
                                    deviceUniqueKey: sigData.deviceUniqueKey || field.deviceUniqueKey || "",
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
                console.error(`PDF fetch error: ${response.status} ${response.statusText}`);
                throw new Error("Unable to load the PDF document. Please refresh and try again.");
            }

            const arrayBuffer = await response.arrayBuffer();

            // Create a copy for pdf-lib before pdfjs consumes the original
            const arrayBufferCopy = arrayBuffer.slice(0);
            setOriginalPdfBytes(arrayBufferCopy);

            // Pass original to pdfjs (it will consume/detach this buffer)
            await loadPdfFromArrayBuffer(arrayBuffer, `Document_${contentVersionId}.pdf`);
        } catch (error) {
            console.error("Error fetching PDF from ContentVersion:", error);
            throw new Error("Failed to load the document. Please check your connection and try again.");
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
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent("SELECT Id, DefaultLocaleSidKey, TimeZoneSidKey FROM Organization LIMIT 1")}`;

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
                console.error(`Organization ID fetch error: ${response.status} ${response.statusText}`);
                throw new Error("Unable to verify your organization. Please contact support.");
            }

            const data = await response.json();
            if (data && data.records && data.records.length > 0) {
                const firstRecord = data.records[0];
                const locale = firstRecord.DefaultLocaleSidKey || "en_US";
                setLocaleKey(locale.replace("_", "-"));

                const timeZone = firstRecord.TimeZoneSidKey || null;
                setTimeZoneKey(timeZone);

                const id = firstRecord.Id || null;
                setOrgIdState(id);
            }
        } catch (e) {
            console.warn("Unable to fetch Organization Id:", e);
        }
    };

    // Fetch Admin_Properties__c custom setting from Salesforce
    const fetchAdminProperties = async (accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            const query = "SELECT Id, Email_Object_Field__c, Email_Address__c, Audit_Report_Behaviour__c, Available_Fonts__c, Default_Brush_Size__c, Default_Font_Size__c, Default_Font_Style__c, Hide_Available_Fonts__c, Hide_Bold_Option__c, Hide_Brush_Size__c, Hide_Font_Size_Option__c, Hide_Italic_Option__c, Hide_Pen_And_Erase__c, Hide_Undo_Redo__c, Send_Sign_Email__c, Store_Sign__c, Audit_Report_On_Every_Signature__c FROM Admin_Properties__c LIMIT 1";
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
                console.error(`Admin properties fetch error: ${response.status} ${response.statusToken}`);
                throw new Error("Unable to load document settings. Please contact support.");
            }

            const data = await response.json();
            const properties = data?.records?.[0] || null;
            setAdminProperties(properties);
        } catch (e) {
            console.warn("Unable to fetch Admin Properties:", e);
        }
    };

    const handleSignatureClick = (signature) => {
        if (isSubmitted) return;

        // Silent check: Only allow signing if signature belongs to current priority
        const signaturePriority = signature._parentSigner?.priority ?? (signature.priority || null);
        if (signaturePriority !== null && signaturePriority != urlPriority) {
            return; // Silently ignore - signature belongs to different priority
        }

        // Replace {defaultValue} with actual computed value for signature fields
        let processedSignature = { ...signature };
        if (signature.defaultValue === "{defaultValue}" && signature._parentSigner) {
            const fieldType = (signature.fieldType || signature.type || "").toLowerCase();
            const signerName = signature._parentSigner.name || "";
            const signerEmail = signature._parentSigner.email || "";
            const maxLength = signature.maxLength ? parseInt(signature.maxLength, 10) : null;

            let autoFilledValue = "";
            if (fieldType === "signature") {
                // For signature fields, use signer's full name
                autoFilledValue = signerName;
            } else if (fieldType === "initials") {
                // For initials fields, extract first letter of each word
                autoFilledValue = signerName
                    .split(/\s+/)
                    .map((word) => word.charAt(0).toUpperCase())
                    .join("");
            } else if (fieldType === "email") {
                // For email fields, use signer's email
                autoFilledValue = signerEmail;
            }

            // Truncate to maxLength if specified
            if (maxLength && autoFilledValue.length > maxLength) {
                autoFilledValue = autoFilledValue.substring(0, maxLength);
            }

            processedSignature.defaultValue = autoFilledValue;
        }

        setCurrentSignature(processedSignature);
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

        // Use pre-fetched IP, location, and device unique key data
        const ipAddress = userIpAddress || "Unknown IP";
        const locationInfo = userLocation || "Location Unavailable";
        const deviceUniqueKey = userDeviceUniqueKey || "Unavailable";

        // Format timestamp as "Nov 21 2025, HH:mm TimeZone" (24-hour format, no seconds)
        const now = new Date();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[now.getMonth()];
        const day = now.getDate();
        const year = now.getFullYear();
        const timeString = now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        // Get timezone abbreviation
        const timeZone = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
        const timeStamp = `${month} ${day} ${year}, ${timeString} ${timeZone}`;

        const userAgent = navigator.userAgent || "Unknown Device";

        const osMatch = userAgent.match(/\(([^;]+);/);
        const osVersion = osMatch ? osMatch[1].trim() : "Unknown OS";

        // Detect browser name and version (check specific browsers first, then fall back to generic)
        let browserName = "Unknown Browser";
        let browserVersion = "";

        if (navigator.brave && typeof navigator.brave.isBrave === "function") {
            // Brave browser detected
            const match = userAgent.match(/Chrome\/([\d.]+)/);
            browserName = "Brave";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Edg/")) {
            const match = userAgent.match(/Edg\/([\d.]+)/);
            browserName = "Edge";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("OPR/") || userAgent.includes("Opera")) {
            const match = userAgent.match(/(?:OPR|Opera)\/([\d.]+)/);
            browserName = "Opera";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Firefox/")) {
            const match = userAgent.match(/Firefox\/([\d.]+)/);
            browserName = "Firefox";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Safari/") && !userAgent.includes("Chrome")) {
            const match = userAgent.match(/Version\/([\d.]+)/);
            browserName = "Safari";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Chrome/")) {
            const match = userAgent.match(/Chrome\/([\d.]+)/);
            browserName = "Chrome";
            browserVersion = match ? match[1] : "";
        }

        const deviceInfo = `${osVersion} ${browserName}${browserVersion ? `/${browserVersion}` : ""}`;

        const signerObject = signature._parentSigner;

        // Create metadata object with all signature details
        const metadata = {
            ipAddress,
            deviceInfo,
            locationInfo,
            deviceUniqueKey,
            timeStamp,
            signatureType,
        };

        // Pass metadata to updateSignatureWithImage function
        const updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData, signature.type, signerObject, metadata);

        setSignatureData(updatedSignatures);
        setSessionSignedKeys((prev) => new Set(prev).add(signature.index));

        // Store first signature/initial for quick reuse (same priority only)
        const signatureTypeLower = (signature.type || "").toLowerCase();
        if (signatureTypeLower === "signature") {
            setStoredSignature((prev) => {
                // If no signature stored yet, store this one
                if (!prev.signBase64) {
                    return { signBase64: imageData, arrStored: [signature.index], signatureType: signatureType };
                }
                return prev;
            });
        } else if (signatureTypeLower === "initials") {
            setStoredInitials((prev) => {
                // If no initials stored yet, store this one
                if (!prev.signBase64) {
                    return { signBase64: imageData, arrStored: [signature.index], signatureType: signatureType };
                }
                return prev;
            });
        }

        // Hide spinner after signature is saved
        setShowSpinner(false);
    };

    // Handle reusing stored signature (one-click signing)
    const handleReuseSignature = async (signatureOrField) => {
        if (isSubmitted) return;

        // Silent check: Only allow signing if signature belongs to current priority
        const itemPriority = signatureOrField._parentSigner?.priority ?? (signatureOrField.priority || null);
        if (itemPriority !== null && itemPriority != urlPriority) {
            return; // Silently ignore - signature belongs to different priority
        }

        // Handle signature-type fields (signatures and initials)
        const itemType = (signatureOrField.type || "").toLowerCase();
        const signatureTypeLower = itemType;
        const storedData = signatureTypeLower === "initials" ? storedInitials : storedSignature;

        if (!storedData.signBase64) {
            console.warn("No stored signature/initial to reuse");
            return;
        }

        // Show spinner during signature application
        setShowSpinner(true);

        // Use pre-fetched IP, location, and device unique key data
        const ipAddress = userIpAddress || "Unknown IP";
        const locationInfo = userLocation || "Location Unavailable";
        const deviceUniqueKey = userDeviceUniqueKey || "Unavailable";

        // Format timestamp
        const now = new Date();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[now.getMonth()];
        const day = now.getDate();
        const year = now.getFullYear();
        const timeString = now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const timeZone = now.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
        const timeStamp = `${month} ${day} ${year}, ${timeString} ${timeZone}`;

        const userAgent = navigator.userAgent || "Unknown Device";
        const osMatch = userAgent.match(/\(([^;]+);/);
        const osVersion = osMatch ? osMatch[1].trim() : "Unknown OS";

        // Detect browser name and version (check specific browsers first, then fall back to generic)
        let browserName = "Unknown Browser";
        let browserVersion = "";

        if (navigator.brave && typeof navigator.brave.isBrave === "function") {
            // Brave browser detected
            const match = userAgent.match(/Chrome\/([\d.]+)/);
            browserName = "Brave";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Edg/")) {
            const match = userAgent.match(/Edg\/([\d.]+)/);
            browserName = "Edge";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("OPR/") || userAgent.includes("Opera")) {
            const match = userAgent.match(/(?:OPR|Opera)\/([\d.]+)/);
            browserName = "Opera";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Firefox/")) {
            const match = userAgent.match(/Firefox\/([\d.]+)/);
            browserName = "Firefox";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Safari/") && !userAgent.includes("Chrome")) {
            const match = userAgent.match(/Version\/([\d.]+)/);
            browserName = "Safari";
            browserVersion = match ? match[1] : "";
        } else if (userAgent.includes("Chrome/")) {
            const match = userAgent.match(/Chrome\/([\d.]+)/);
            browserName = "Chrome";
            browserVersion = match ? match[1] : "";
        }

        const deviceInfo = `${osVersion} ${browserName}${browserVersion ? `/${browserVersion}` : ""}`;

        const signerObject = signatureOrField._parentSigner;

        // Create metadata object
        const metadata = {
            ipAddress,
            deviceInfo,
            locationInfo,
            deviceUniqueKey,
            timeStamp,
            signatureType: storedData.signatureType,
        };

        // Apply stored signature to this field
        const updatedSignatures = updateSignatureWithImage(signatureData, signatureOrField.index, storedData.signBase64, signatureOrField.type, signerObject, metadata);
        setSignatureData(updatedSignatures);
        setSessionSignedKeys((prev) => new Set(prev).add(signatureOrField.index));

        // Update arrStored for the appropriate type
        if (signatureTypeLower === "initials") {
            setStoredInitials((prev) => ({
                ...prev,
                arrStored: [...prev.arrStored, signatureOrField.index],
            }));
        } else {
            setStoredSignature((prev) => ({
                ...prev,
                arrStored: [...prev.arrStored, signatureOrField.index],
            }));
        }

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
        if (isSubmitted) return;

        // Silent check: Only allow deletion if field belongs to current priority
        const fieldPriority = field._parentSigner?.priority ?? (field.priority || null);
        if (fieldPriority !== null && fieldPriority != urlPriority) {
            return; // Silently ignore - field belongs to different priority
        }

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
        if (isSubmitted) return;

        // Silent check: Only allow deletion if signature belongs to current priority
        const signaturePriority = signature._parentSigner?.priority ?? (signature.priority || null);
        if (signaturePriority !== null && signaturePriority != urlPriority) {
            return; // Silently ignore - signature belongs to different priority
        }

        const signerObject = signature._parentSigner;

        const updatedSignatures = deleteSignatureImage(signatureData, signature.index, signature.type, signerObject);
        setSignatureData(updatedSignatures);

        // Remove from session signed keys
        setSessionSignedKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(signature.index);
            return newSet;
        });

        // Update stored signature/initials management
        const signatureTypeLower = (signature.type || "").toLowerCase();

        if (signatureTypeLower === "signature") {
            setStoredSignature((prev) => {
                // Remove this index from arrStored
                const newArrStored = prev.arrStored.filter((idx) => idx !== signature.index);

                // If arrStored becomes empty, find the first signed signature for same priority
                if (newArrStored.length === 0) {
                    // Find first signed signature of same priority
                    const firstSignedSig = findFirstSignedSignature(updatedSignatures, urlPriority, "signature");
                    if (firstSignedSig) {
                        return { signBase64: firstSignedSig.imageUrl, arrStored: [firstSignedSig.index] };
                    }
                    // No signed signatures left, clear storage
                    return { signBase64: null, arrStored: [] };
                }

                return { ...prev, arrStored: newArrStored };
            });
        } else if (signatureTypeLower === "initials") {
            setStoredInitials((prev) => {
                // Remove this index from arrStored
                const newArrStored = prev.arrStored.filter((idx) => idx !== signature.index);

                // If arrStored becomes empty, find the first signed initial for same priority
                if (newArrStored.length === 0) {
                    // Find first signed initial of same priority
                    const firstSignedInitial = findFirstSignedSignature(updatedSignatures, urlPriority, "initials");
                    if (firstSignedInitial) {
                        return { signBase64: firstSignedInitial.imageUrl, arrStored: [firstSignedInitial.index] };
                    }
                    // No signed initials left, clear storage
                    return { signBase64: null, arrStored: [] };
                }

                return { ...prev, arrStored: newArrStored };
            });
        }
    };

    // Helper function to find first signed signature/initial for a given priority and type
    const findFirstSignedSignature = (signatures, priority, type) => {
        for (const sig of signatures) {
            if (sig.priority != priority) continue;

            const fields = sig.fields || [];
            for (const field of fields) {
                const fieldTypeLower = (field.type || "").toLowerCase();
                if (fieldTypeLower === type && field.filled && field.imageUrl) {
                    return { index: field.index, imageUrl: field.imageUrl };
                }
            }
        }
        return null;
    };

    const handleFieldClick = (field) => {
        if (isSubmitted) return;

        // Silent check: Only allow editing if field belongs to current priority
        const fieldPriority = field._parentSigner?.priority ?? (field.priority || null);
        if (fieldPriority !== null && fieldPriority != urlPriority) {
            return; // Silently ignore - field belongs to different priority
        }

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
        if (fType === "email" && field.defaultValue == "{defaultValue}") {
            const emailValue = field._parentSigner ? field._parentSigner.email || "" : "";
            const maxLength = field.maxLength ? parseInt(field.maxLength, 10) : null;
            // Truncate to maxLength if specified
            field.value = maxLength && emailValue.length > maxLength ? emailValue.substring(0, maxLength) : emailValue;
        } else if (fType === "date" && field.defaultValue === "TODAY") {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, "0");
            const day = String(today.getDate()).padStart(2, "0");
            field.value = `${year}-${month}-${day}`;
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
            setToast({ isVisible: true, message: `Please complete all required fields. ${unfilledRequiredFields.length} required field(s) remaining.`, type: "error" });
            return;
        }

        try {
            setShowSpinner(true);

            // STEP 1: Check if document was already submitted by this user in another window/browser
            if (salesforceConfig) {
                const { recordId, accessToken, instanceUrl, clientId, clientSecret } = salesforceConfig;

                try {
                    // Fetch current document status and check if it's already been updated
                    const query = `SELECT Id, Status__c, Document_Hash_Key__c, Signing_Details__c, Active__c FROM Document__c WHERE Id = '${recordId}' LIMIT 1`;
                    const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(query)}`;

                    let response = await fetch(apiUrl, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                    });

                    if (response.status === 401 && clientId && clientSecret) {
                        const newToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);
                        response = await fetch(apiUrl, {
                            method: "GET",
                            headers: {
                                Authorization: `Bearer ${newToken}`,
                                "Content-Type": "application/json",
                            },
                        });
                    }

                    if (response.ok) {
                        const data = await response.json();
                        const currentDoc = data?.records?.[0];

                        if (currentDoc && currentDoc.Signing_Details__c) {
                            try {
                                const parsedDetails = JSON.parse(currentDoc.Signing_Details__c);
                                const currentPriorityEntries = parsedDetails.filter((entry) => entry.priority == urlPriority);

                                if (currentPriorityEntries.length > 0) {
                                    // Check if all fields for this priority are already filled
                                    const allFieldsFilled = currentPriorityEntries.every((entry) => {
                                        if (entry.fields && Array.isArray(entry.fields)) {
                                            return entry.fields.every((field) => field.filled);
                                        }
                                        return entry.filled === true;
                                    });

                                    if (allFieldsFilled) {
                                        setShowSpinner(false);
                                        setToast({ isVisible: true, message: "This document was already submitted in another window. Refreshing...", type: "success" });

                                        // Reload after short delay
                                        setTimeout(() => {
                                            window.location.reload();
                                        }, 1500);
                                        return;
                                    }
                                }
                            } catch (parseError) {
                                console.warn("Could not parse Signing_Details__c:", parseError);
                            }
                        }
                        if (currentDoc && currentDoc.Active__c === false) {
                            setShowSpinner(false);
                            setToast({ isVisible: true, message: "Something went wrong. Refreshing...", type: "error" });
                            
                            // Reload after short delay
                            setTimeout(() => {
                                window.location.reload();
                            }, 1500);
                            return;
                        }
                    }
                } catch (checkError) {
                    console.warn("Error checking document status, proceeding with submission:", checkError);
                }
            }

            // STEP 2: Proceed with normal submission flow
            if (!originalPdfBytes) {
                throw new Error("Unable to process the document. Please refresh the page and try again.");
            }

            // Load the original PDF using pdf-lib
            const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
            const pages = pdfDoc.getPages();

            // Get all filled signature and initials fields across all signatures
            const filledFieldsNew = signatureData.flatMap((s) =>
                (s.fields || [])
                    .filter((f) => {
                        const fieldType = f.type.toLowerCase();
                        return fieldType === "signature" || fieldType === "initials";
                    })
                    .map((f) => ({ ...f, signerName: s.name || "--", signerEmail: s.email || "--" }))
            );

            for (const field of filledFieldsNew) {
                try {
                    const pageIndex = field.pageNumber - 1;
                    if (pageIndex < 0 || pageIndex >= pages.length) {
                        console.warn(`Invalid page number ${field.pageNumber} for field ${field.index}`);
                        continue;
                    }

                    const page = pages[pageIndex];
                    const { width: pageWidth, height: pageHeight } = page.getSize();

                    const imageBytes = await fetch(field.imageUrl).then((res) => res.arrayBuffer());

                    let image;
                    if (field.imageUrl.startsWith("data:image/jpeg") || field.imageUrl.startsWith("data:image/jpg")) {
                        image = await pdfDoc.embedJpg(imageBytes);
                    } else {
                        image = await pdfDoc.embedPng(imageBytes);
                    }

                    // Use percentage-based coordinates from the field data
                    const boxX = (field.xPercent / 100) * pageWidth;
                    const boxY = pageHeight - (field.yPercent / 100) * pageHeight - (field.heightPercent / 100) * pageHeight;
                    const boxWidth = (field.widthPercent / 100) * pageWidth;
                    const boxHeight = (field.heightPercent / 100) * pageHeight;

                    // Calculate image dimensions with "contain" behavior (maintain aspect ratio)
                    const imageDims = image.scale(1);
                    const imageAspectRatio = imageDims.width / imageDims.height;
                    const boxAspectRatio = boxWidth / boxHeight;

                    let drawWidth, drawHeight, drawX, drawY;

                    if (imageAspectRatio > boxAspectRatio) {
                        // Image is wider than box - fit to width
                        drawWidth = boxWidth;
                        drawHeight = boxWidth / imageAspectRatio;
                        drawX = boxX;
                        drawY = boxY + (boxHeight - drawHeight) / 2;
                    } else {
                        // Image is taller than box - fit to height
                        drawHeight = boxHeight;
                        drawWidth = boxHeight * imageAspectRatio;
                        drawX = boxX + (boxWidth - drawWidth) / 2;
                        drawY = boxY;
                    }

                    // Draw the image on the page with contain behavior
                    page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });

                    // Add timestamp and signer name below the signature
                    const signerName = field._parentSigner?.name || field.signerName;
                    const timestamp = field.timeStamp || field.timestamp;

                    if (signerName || timestamp) {
                        // Embed font for text
                        // const manrope = await fetch("https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap").then((res) => res.arrayBuffer());
                        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

                        const metadataText = `${signerName} | ${timestamp}`;

                        // Calculate font size relative to signature width (small text)
                        const fontSize = 8;
                        const maxWidth = boxWidth; // Max width is the signature box width
                        const textWidth = font.widthOfTextAtSize(metadataText, fontSize);

                        // Word wrapping logic for max 2 lines
                        let lines = [];
                        if (textWidth <= maxWidth) {
                            lines = [metadataText];
                        } else {
                            // Need to wrap - split into max 2 lines
                            const words = metadataText.split(" ");
                            let line1 = "";
                            let line2 = "";

                            for (let i = 0; i < words.length; i++) {
                                const testLine1 = line1 + (line1 ? " " : "") + words[i];
                                const testWidth = font.widthOfTextAtSize(testLine1, fontSize);

                                if (testWidth <= maxWidth) {
                                    line1 = testLine1;
                                } else {
                                    // Move to second line
                                    line2 = words.slice(i).join(" ");
                                    break;
                                }
                            }

                            lines = [line1, line2].filter((l) => l);
                            // If line2 still exceeds, truncate with ellipsis
                            if (lines[1]) {
                                const line2Width = font.widthOfTextAtSize(lines[1], fontSize);
                                if (line2Width > maxWidth) {
                                    let truncated = lines[1];
                                    while (font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth && truncated.length > 0) {
                                        truncated = truncated.slice(0, -1);
                                    }
                                    lines[1] = truncated + "...";
                                }
                            }
                        }

                        // Draw a subtle line above the text
                        page.drawLine({ start: { x: boxX, y: boxY - 1 }, end: { x: boxX + boxWidth, y: boxY - 1 }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });

                        // Draw each line of metadata text
                        lines.forEach((line, index) => {
                            const lineWidth = font.widthOfTextAtSize(line, fontSize);
                            const textX = boxX + (boxWidth - lineWidth) / 2;
                            const textY = boxY - fontSize - 2 - index * (fontSize + 2);

                            page.drawText(line, {
                                x: textX,
                                y: textY,
                                size: fontSize,
                                font: font,
                                color: rgb(0.4, 0.4, 0.4),
                            });
                        });
                    }
                } catch (error) {
                    console.error("Error adding signature to PDF:", field.index, error);
                }
            }

            // Get all filled fields from both flat fieldData and nested signatureData structures
            const flatFilledFields = fieldData.filter((field) => {
                const fieldType = (field.fieldType || field.type || "").toLowerCase();

                // Always include checkboxes regardless of their value (checked or unchecked)
                if (fieldType === "checkbox") {
                    return true;
                }

                // For other fields, check if they have a value
                const hasValue = field.value !== null && field.value !== undefined && field.value !== "";
                return (field.filled || hasValue) && hasValue;
            });

            // Get filled fields from nested structure (inside signatureData)
            const nestedFilledFields = signatureData.flatMap((sig) =>
                (sig.fields || []).filter((field) => {
                    // Check if it's a field type (not signature)
                    const fieldType = (field.fieldType || field.type || "").toLowerCase();
                    const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(fieldType);

                    if (!isFieldType) return false;

                    // Always include checkboxes regardless of their value (checked or unchecked)
                    if (fieldType === "checkbox") {
                        return true;
                    }

                    // For other fields, check if they have a value
                    const hasValue = field.value !== null && field.value !== undefined && field.value !== "";
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
                        // Match preview font size (15.6px in preview = 10px in PDF due to scaling)
                        const fontSize = 10;
                        const padding = 4;
                        const maxWidth = pdfWidth - padding * 2;
                        const lineHeight = fontSize * 1.25;

                        // Check if this is a multiline text field
                        const isMultiline = fieldType === "text" && field.multiline === true;

                        let lines = [];

                        if (isMultiline) {
                            // Split text into words and build lines that fit within maxWidth
                            const words = displayValue.split(" ");
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
                        } else {
                            // Single line - truncate with ellipsis if needed
                            let truncatedText = displayValue;
                            const textWidth = font.widthOfTextAtSize(truncatedText, fontSize);

                            if (textWidth > maxWidth) {
                                // Truncate and add ellipsis
                                while (font.widthOfTextAtSize(truncatedText + "...", fontSize) > maxWidth && truncatedText.length > 0) {
                                    truncatedText = truncatedText.slice(0, -1);
                                }
                                truncatedText += "...";
                            }
                            lines = [truncatedText];
                        }

                        // Calculate starting Y position from top of field
                        const textY = pdfY + pdfHeight - padding - fontSize;

                        // Draw each line
                        for (let i = 0; i < lines.length; i++) {
                            const currentY = textY - i * lineHeight;
                            // Only draw if within field bounds
                            if (currentY >= pdfY) {
                                page.drawText(lines[i], {
                                    x: pdfX + padding,
                                    y: currentY,
                                    size: fontSize,
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

            // Helper function to check if all signers have completed their signatures
            const areAllSignersComplete = () => {
                // Check if ALL signers (across all priorities) have completed their signatures
                return signatureData.every((signer) => {
                    const signerFields = signer.fields || [];
                    // Check if signer has at least one signature/initial field
                    const signatureFields = signerFields.filter((f) => {
                        const fType = (f.type || f.fieldType || "").toLowerCase();
                        return fType === "signature" || fType === "initials";
                    });

                    // If no signature fields, consider signer complete
                    if (signatureFields.length === 0) return true;

                    // Check if all required signature fields are filled
                    return signatureFields.every((f) => f.filled === true);
                });
            };

            const allSignersComplete = areAllSignersComplete();

            // Check audit report behavior setting
            const auditBehavior = adminProperties?.Audit_Report_Behaviour__c || "attached";
            const auditOnEverySignature = adminProperties?.Audit_Report_On_Every_Signature__c || false;
            let pdfBytes;
            let auditPdfBytes = null;

            if (auditBehavior === "separate") {
                // Separate mode: Generate audit as separate file
                if (auditOnEverySignature || allSignersComplete) {
                    // Generate audit on every signature if checkbox is enabled, or only when all signers complete
                    const showCompletedOnly = auditOnEverySignature && !allSignersComplete;
                    try {
                        await generateAuditHTML(documentRecord, signatureData, orgIdState, totalPages, pdfPageFormat, showCompletedOnly, localeKey, timeZoneKey);
                        auditPdfBytes = await convertAuditHTMLToPDF(pdfPageFormat);
                    } catch (e) {
                        console.warn("Failed to generate separate audit report:", e);
                    }
                }

                // Save signed PDF without audit report
                pdfBytes = await pdfDoc.save();
            } else {
                // Attached mode: Merge audit into PDF
                if (auditOnEverySignature || allSignersComplete) {
                    // Generate audit on every signature if checkbox is enabled, or only when all signers complete
                    const showCompletedOnly = auditOnEverySignature && !allSignersComplete;
                    try {
                        await generateAuditHTML(documentRecord, signatureData, orgIdState, totalPages, pdfPageFormat, showCompletedOnly, localeKey, timeZoneKey);
                    } catch (e) {
                        console.warn("Failed to append audit report page:", e);
                    }

                    // Merge audit report HTML as extra pages
                    const htmlPdfBytes = await convertAuditHTMLToPDF(pdfPageFormat);
                    const finalDoc = await PDFDocument.load(await pdfDoc.save());
                    const extraDoc = await PDFDocument.load(htmlPdfBytes);
                    const htmlPages = await finalDoc.copyPages(extraDoc, extraDoc.getPageIndices());
                    htmlPages.forEach((p) => finalDoc.addPage(p));

                    pdfBytes = await finalDoc.save();
                } else {
                    // No audit generation for intermediate steps when checkbox is disabled
                    pdfBytes = await pdfDoc.save();
                }
            }
            // Generate SHA-256 hash of the final PDF
            const pdfHash = await generatePdfHash(pdfBytes);

            // Upload to Salesforce if config is available
            if (salesforceConfig) {
                // Determine FirstPublishLocationId
                const firstPublishLocationId = salesforceConfig.recordId;

                // Upload signed PDF as ContentVersion
                let newContentVersionId = null;
                let temporaryContentVersionId = null;

                if (allSignersComplete) {
                    // All signers complete - upload as final document
                    newContentVersionId = await uploadSignedPdfToSalesforce(pdfBytes, firstPublishLocationId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret, documentRecord.Document_Name__c, "Signed");

                    // If Store_On_Parent_Record__c is true and Record_ID__c exists, create ContentDocumentLink
                    if (documentRecord?.Store_On_Parent_Record__c === true && documentRecord?.Record_ID__c) {
                        try {
                            await createContentDocumentLink(newContentVersionId, documentRecord.Record_ID__c, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);
                        } catch (error) {
                            console.error("Failed to create ContentDocumentLink on parent record:", error);
                            // Continue execution even if linking fails
                        }
                    }
                } else {
                    // Not all signers complete - upload as temporary document with priority number
                    temporaryContentVersionId = await uploadSignedPdfToSalesforce(pdfBytes, firstPublishLocationId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret, documentRecord.Document_Name__c, `Temporary - ${urlPriority}`);
                }

                // Upload separate audit report if configured
                if (auditPdfBytes && auditBehavior === "separate") {
                    try {
                        // Determine audit report title based on completion
                        const auditTitle = allSignersComplete ? "Audit Report" : `Temporary Audit Report - ${urlPriority}`;
                        await uploadSignedPdfToSalesforce(auditPdfBytes, firstPublishLocationId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret, documentRecord.Document_Name__c, auditTitle);
                    } catch (error) {
                        console.error("Failed to upload separate audit report:", error);
                    }
                }

                // Update Document record with signature, field data, PDF hash, and ContentVersion ID(s)
                await updateDocumentRecord(salesforceConfig.recordId, signatureData, fieldData, pdfHash, newContentVersionId, temporaryContentVersionId, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);

                // Mark as submitted
                setIsSubmitted(true);

                // Broadcast to other tabs that this document was submitted
                if (broadcastChannelRef.current) {
                    broadcastChannelRef.current.postMessage({
                        type: "DOCUMENT_SUBMITTED",
                        recordId: salesforceConfig.recordId,
                        timestamp: new Date().toISOString(),
                    });
                }

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

                // Broadcast to other tabs that this document was submitted
                if (broadcastChannelRef.current) {
                    broadcastChannelRef.current.postMessage({
                        type: "DOCUMENT_SUBMITTED",
                        timestamp: new Date().toISOString(),
                    });
                }

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
                message: "Failed to save your signatures. Please check your connection and try again.",
                type: "error",
            });
        } finally {
            // Hide spinner after save process completes
            setShowSpinner(false);
        }
    };

    // Upload signed PDF to Salesforce as ContentVersion
    const uploadSignedPdfToSalesforce = async (pdfBytes, firstPublishLocationId, accessToken, instanceUrl, clientId = null, clientSecret = null, documentName, documentType = "Signed") => {
        try {
            let currentToken = accessToken;

            // Convert PDF bytes to base64
            const base64Pdf = Buffer.from(pdfBytes).toString("base64");

            // Create ContentVersion record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentVersion`;

            const contentVersionData = {
                Title: `${documentName} - ${documentType}`,
                PathOnClient: `${documentName} - ${documentType}.pdf`,
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
                console.error(`Upload error details: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error("Failed to upload the signed document. Please try again.");
            }

            const result = await response.json();
            return result.id;
        } catch (error) {
            console.error("Error uploading signed PDF to Salesforce:", error);
            throw new Error("Failed to upload the signed document. Please check your connection and try again.");
        }
    };

    // Create ContentDocumentLink to link ContentDocument to a parent record
    const createContentDocumentLink = async (contentVersionId, parentRecordId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // First, get the ContentDocumentId from ContentVersionId
            const queryUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(`SELECT ContentDocumentId FROM ContentVersion WHERE Id='${contentVersionId}' LIMIT 1`)}`;

            let queryResponse = await fetch(queryUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
            });

            if (queryResponse.status === 401 && clientId && clientSecret) {
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);
                queryResponse = await fetch(queryUrl, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                });
            }

            if (!queryResponse.ok) {
                throw new Error(`Failed to query ContentDocument: ${queryResponse.status}`);
            }

            const queryData = await queryResponse.json();
            const contentDocumentId = queryData.records[0]?.ContentDocumentId;

            if (!contentDocumentId) {
                throw new Error("ContentDocumentId not found");
            }

            // Create ContentDocumentLink
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentDocumentLink`;
            const contentDocumentLinkData = {
                ContentDocumentId: contentDocumentId,
                LinkedEntityId: parentRecordId,
                ShareType: "V", // Viewer permission
                Visibility: "AllUsers",
            };

            let response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(contentDocumentLinkData),
            });

            if (response.status === 401 && clientId && clientSecret) {
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);
                response = await fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(contentDocumentLinkData),
                });
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`ContentDocumentLink creation error: ${response.status} - ${errorText}`);
                throw new Error("Failed to link document to parent record");
            }

            const result = await response.json();
            return result.id;
        } catch (error) {
            console.error("Error creating ContentDocumentLink:", error);
            throw error;
        }
    };

    // Update Document__c record with signature and field data
    const updateDocumentRecord = async (documentId, signatureData, fieldData, pdfHash, newContentVersionId, temporaryContentVersionId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Step 1: Save imageUrl data to Signature__c records
            await upsertSignatureRecords(documentId, signatureData, currentToken, instanceUrl, clientId, clientSecret);

            // Step 2: Remove imageUrl from signature data before saving to Document__c
            const sanitizedSignatureData = signatureData.map((sig) => {
                if (sig.priority == urlPriority) {
                    sig.signed = true;
                }
                if (sig.fields && Array.isArray(sig.fields)) {
                    return {
                        ...sig,
                        fields: sig.fields.map((field) => {
                            const { imageUrl: _, ...fieldWithoutImage } = field;
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

            // Add Temporary ContentVersion ID if provided (intermediate priority)
            if (temporaryContentVersionId) {
                updateData.Temporary_Content_Version_Id__c = temporaryContentVersionId;
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
                console.error(`Update error: ${response.status} ${response.statusText}`);
                throw new Error("Failed to save signature information. Please try again.");
            }

            return true;
        } catch (error) {
            console.error("Error updating Document record:", error);
            throw new Error("Failed to save your signatures. Please check your connection and try again.");
        }
    };

    // Create or update Signature__c records
    // Helper function to upload image as ContentVersion linked to Signature__c
    const uploadSignatureImage = async (signatureRecordId, imageUrl, fieldIndex, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Extract base64 data from data URL
            const base64Data = imageUrl.split(",")[1];
            if (!base64Data) {
                console.warn("No base64 data found in imageUrl");
                return null;
            }

            // Determine file extension from data URL
            const mimeType = imageUrl.split(";")[0].split(":")[1];
            const extension = mimeType.includes("png") ? "png" : "jpg";

            // Create ContentVersion record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/ContentVersion`;

            const contentVersionData = {
                Title: `Signature_${fieldIndex}`,
                PathOnClient: `Signature_${fieldIndex}.${extension}`,
                VersionData: base64Data,
                FirstPublishLocationId: signatureRecordId,
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
                console.error(`Failed to upload signature image: ${response.status} ${response.statusText} - ${errorText}`);
                return null;
            }

            const result = await response.json();
            return result.id;
        } catch (error) {
            console.error("Error uploading signature image:", error);
            return null;
        }
    };

    const upsertSignatureRecords = async (documentId, signatureData, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Check if Store_Sign__c is enabled in admin properties
            const storeSignatures = adminProperties?.Store_Sign__c === true;

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
                                deviceUniqueKey: field.deviceUniqueKey || "",
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
                                deviceUniqueKey: "",
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
                    deviceUniqueKey: field.deviceUniqueKey,
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
            const upsertPromises = recordsToUpsert.map(async (record, index) => {
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

                let signatureRecordId = record.Id;
                if (response.status === 201) {
                    const result = await response.json();
                    signatureRecordId = result.id;
                }

                // If Store_Sign__c is enabled and this field has an imageUrl, upload it as ContentVersion
                if (storeSignatures && fieldsWithImages[index]?.imageUrl && !isUpdate) {
                    await uploadSignatureImage(signatureRecordId, fieldsWithImages[index].imageUrl, record.Field_Index__c, currentToken, instanceUrl, clientId, clientSecret);
                }

                return { success: true, id: signatureRecordId };
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

    const handleReject = () => {
        setRejectReason("");
        setShowRejectConfirm(true);
    };

    const handleConfirmReject = async () => {
        // Validate that reason is provided
        if (!rejectReason.trim()) {
            setToast({ isVisible: true, message: "Please provide a reason for rejection", type: "error" });
            return;
        }
        
        setShowRejectConfirm(false);

        if (!salesforceConfig) return;

        const { recordId, accessToken, instanceUrl, clientId, clientSecret } = salesforceConfig;
        let currentToken = accessToken;

        try {
            setShowSpinner(true);
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/Document__c/${recordId}`;

            const currentUser = signatureData.find((sig) => sig.priority == urlPriority);
            const rejectorDetails = {
                name: currentUser?.name,
                email: currentUser?.email,
                priority: currentUser?.priority,
                rejectionDate: new Date().toISOString(),
                rejectionReason: rejectReason.trim(),
            }

            let response = await fetch(apiUrl, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    Status__c: "Rejected",
                    Rejector_Details__c: JSON.stringify(rejectorDetails),
                }),
            });

            // token refresh fallback
            if (response.status === 401 && clientId && clientSecret) {
                currentToken = await refreshAccessToken(instanceUrl, clientId, clientSecret);

                response = await fetch(apiUrl, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        Status__c: "Rejected",
                        Rejector_Details__c: JSON.stringify(rejectorDetails),
                    }),
                });
            }

            if (!response.ok) {
                console.error(`Reject status update error: ${response.status}`);
                throw new Error("Unable to reject the document. Please try again.");
            }

            // Navigate to rejected page and replace history so user can't go back
            navigate("/rejected", { replace: true });
            setShowSpinner(false);
        } catch (error) {
            console.error("Reject error:", error);
            setToast({
                isVisible: true,
                message: "Failed to reject the document. Please check your connection and try again.",
                type: "error",
            });
            setShowSpinner(false);
        }
    };

    const handleCancelReject = () => {
        setRejectReason("");
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
                console.error(`Token refresh error: ${response.status} ${response.statusText}`);
                throw new Error("Your session has expired. Please request a new link from the sender.");
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
            throw new Error("Your session has expired. Please request a new link from the sender.");
        }
    };

    // Refresh access token using client credentials
    // Helper to update access token in the url and component state so refresh persists across reloads
    const updateUrlAccessToken = async (token) => {
        try {
            const url = new URL(window.location.href);
            const encryptedQuery = url.searchParams.get("q");

            if (encryptedQuery) {
                // URL is encrypted - decrypt, update token, re-encrypt
                try {
                    const decryptedString = await decryptUrlParams(encryptedQuery);
                    const params = parseQueryString(decryptedString);
                    params.act = token;

                    const updatedQueryString = buildQueryString(params);
                    const newEncryptedQuery = await encryptUrlParams(updatedQueryString);

                    url.searchParams.set("q", newEncryptedQuery);
                    window.history.replaceState({}, document.title, url.toString());
                } catch (error) {
                    console.error("Failed to update encrypted URL:", error);
                }
            } else {
                // URL is not encrypted - update plaintext parameter
                url.searchParams.set("act", token);
                window.history.replaceState({}, document.title, url.toString());
            }

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

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const canvas = canvasRefsArray.current[pageNum - 1];
            if (canvas) {
                const dims = await renderPage(pdf, pageNum, canvas, targetWidth);
                dimensions.push(dims);
                // Update scale state with the first page's scale (all pages use same scale)
                if (pageNum === 1 && dims) {
                    setCanvasScale(dims.scale);
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
        const originalViewport = page.getViewport({ scale: 1.5 });

        const pageWidth = originalViewport.width || A4_WIDTH;
        const calculatedScale = targetWidth / pageWidth;

        const viewport = page.getViewport({ scale: 1.5 });
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
            // Check if geolocation is available
            if (!navigator.geolocation) {
                console.warn("Geolocation API not available");
                throw new Error("Geolocation not supported");
            }

            // Check if we're on HTTPS (required for geolocation in most browsers)
            if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
                console.warn("Geolocation requires HTTPS");
                throw new Error("HTTPS required");
            }

            // Try GPS first with improved options for cross-browser compatibility
            const coords = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error("Geolocation timeout"));
                }, 15000); // 15 second timeout

                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        clearTimeout(timeoutId);
                        resolve(position);
                    },
                    (error) => {
                        clearTimeout(timeoutId);
                        console.warn("Geolocation error:", error.code, error.message);
                        reject(error);
                    },
                    {
                        enableHighAccuracy: false, // False for faster response and better cross-browser support
                        timeout: 15000, // 15 seconds
                        maximumAge: 60000, // Accept cached position up to 10 minutes old
                    }
                );
            });

            const { latitude, longitude } = coords.coords;

            // Reverse geocode to city/state/country with proper headers
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`, {
                headers: {
                    "User-Agent": "SignatureApp/1.0", // Required by Nominatim usage policy
                },
            });

            if (!res.ok) {
                throw new Error("Geocoding failed");
            }

            const data = await res.json();
            const address = data.address || {};

            const city = address.city || address.state_district || address.town || address.village || "Unknown City";
            const state = address.state || "Unknown State";
            const country = address.country || "Unknown Country";
            console.log("Geolocation obtained:", city, state, country);
            return `${city}, ${state}, ${country}`;
        } catch (gpsError) {
            console.warn("GPS failed, attempting IP-based location fallback:", gpsError);

            return "Location Unavailable";
        }
    };

    const getDeviceUniqueKey = async () => {
        try {
            // Canvas fingerprint
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.fillText("Unique Device Test", 2, 2);
            const canvasData = canvas.toDataURL();

            // Collect stable browser signals
            const signals = {
                userAgent: navigator.userAgent,
                screen: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                cores: navigator.hardwareConcurrency || "unknown",
                platform: navigator.platform,
                language: navigator.language,
                canvas: canvasData.slice(0, 50) + "...",
            };

            // Generate hash
            const fingerprint = JSON.stringify(signals);
            const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
            const uniqueKey = Array.from(new Uint8Array(hashBuffer))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 32);

            localStorage.setItem("deviceUniqueKey", uniqueKey);

            return uniqueKey;
        } catch (error) {
            console.error("Error generating device unique key:", error.message);
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

            {(isRejectedSimultaneous || isInactive) && (
                <div className="expired-card">
                    <div className="expired-icon" style={{ color: "#d32f2f" }}>
                        <svg className="expired-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>

                    <h3 className="expired-title" style={{ color: "#d32f2f" }}>
                        Something Went Wrong
                    </h3>
                    <p className="expired-message">Facing issue with this document. Please try again later.</p>

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

            {/* {isInactive && <SomethingWentWrong />} */}

            {pdfFile && !isExpired && !isRejectedSimultaneous && !isInactive && (
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
                                                {signatureData.length > 0 && <SignatureOverlay key={`sig-overlay-${pageNumber}-${canvasScale}`} pageNumber={pageNumber} priority={urlPriority} signatures={signatureData} onSign={handleSignatureClick} onFieldClick={handleFieldClick} onFieldSave={handleFieldSave} onDelete={handleSignatureDelete} onFieldDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionSignedKeys={sessionSignedKeys} sessionFilledKeys={sessionFilledKeys} canvasScale={canvasScale} storedSignature={storedSignature} storedInitials={storedInitials} onReuseSignature={handleReuseSignature} sendEmailsSimultaneously={documentRecord?.Send_Emails_Simultaneously__c} />}
                                                {fieldData.length > 0 && <FieldOverlay key={`field-overlay-${pageNumber}-${canvasScale}`} pageNumber={pageNumber} priority={urlPriority} fields={fieldData} onFieldClick={handleFieldClick} onFieldSave={handleFieldSave} onDelete={handleFieldDelete} isSubmitted={isSubmitted} sessionFilledKeys={sessionFilledKeys} canvasScale={canvasScale} storedInitials={storedInitials} onReuseInitials={handleReuseSignature} sendEmailsSimultaneously={documentRecord?.Send_Emails_Simultaneously__c} />}
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
                                        <input type="checkbox" id="accept-terms" checked={initialAccepted} onChange={(e) => setInitialAccepted(e.target.checked)} style={{ cursor: "pointer", width: "18px", height: "18px", accentColor: "#2863eb" }} />
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

            {!pdfFile && !loading && !isExpired && !isRejectedSimultaneous && !isInactive && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p style={error ? { color: "#d32f2f" } : undefined}>{error ? "The URL is not right. Please contact the sender of this link." : "The URL is incorrect. Please contact the sender of this link."}</p>
                    </div>
                </div>
            )}

            <SignatureModal isOpen={isModalOpen} onClose={handleModalClose} onSave={handleSignatureSave} signature={currentSignature} title={currentSignature?.type === "initials" ? "Create Initials" : "Create Signature"} adminProperties={adminProperties} pdfPageFormat={pdfPageFormat} />
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
                            <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Please provide a reason for rejecting this document..." rows="4" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ddd", fontSize: "14px", fontFamily: "inherit", resize: "vertical", minHeight: "80px" }} />
                        </div>
                        <div className="reject-confirm-actions">
                            <button className="reject-cancel-btn" onClick={handleCancelReject}>
                                Cancel
                            </button>
                            <button className="reject-confirm-btn" onClick={handleConfirmReject} disabled={!rejectReason.trim()} style={{ opacity: !rejectReason.trim() ? 0.5 : 1, cursor: !rejectReason.trim() ? "not-allowed" : "pointer" }}>
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
