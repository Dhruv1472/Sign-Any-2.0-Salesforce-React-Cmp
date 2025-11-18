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

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";

// A4 page dimensions in pixels at 72 DPI
const A4_WIDTH = 595;
const A4_HEIGHT = 842;

function App() {
    const [pdfFile, setPdfFile] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isExpired, setIsExpired] = useState(false); // Track if document is expired
    const [initialAccepted, setInitialAccepted] = useState(false); // Show initial accept/reject popup on first load
    const [signatureData, setSignatureData] = useState([]);
    const [fieldData, setFieldData] = useState([]); // Fields data
    const [documentRecord, setDocumentRecord] = useState(null);
    const [pageDimensions, setPageDimensions] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
    const [currentSignature, setCurrentSignature] = useState(null);
    const [currentField, setCurrentField] = useState(null);
    const [toast, setToast] = useState({ isVisible: false, message: "", type: "success" });
    const [salesforceConfig, setSalesforceConfig] = useState(null);
    const [urlPriority, setUrlPriority] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false); // Track if document has been submitted
    const [sessionSignedKeys, setSessionSignedKeys] = useState(new Set()); // Track signatures signed in this session
    const [sessionFilledKeys, setSessionFilledKeys] = useState(new Set()); // Track fields filled in this session
    const [originalPdfBytes, setOriginalPdfBytes] = useState(null); // Store original PDF bytes for modification
    const [initialSignatureData, setInitialSignatureData] = useState([]); // Store initial signature data to detect changes
    const [initialFieldData, setInitialFieldData] = useState([]); // Store initial field data to detect changes
    const [orgIdState, setOrgIdState] = useState(null); // Salesforce Organization Id
    const canvasRefsArray = useRef([]);
    const pdfDocRef = useRef(null);

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

            // Store original PDF bytes for later modification
            // setOriginalPdfBytes(typedArray);
        } catch (error) {
            console.error("Error loading PDF:", error);
            setError("Error loading PDF file");
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
                            fieldsWithImages.push({
                                fieldIndex: field.index,
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
                console.log("No signature records to upsert");
                return true;
            }

            console.log("recordsToUpsert==> ", recordsToUpsert);

            // Use Promise.all to create/update records individually
            const upsertPromises = recordsToUpsert.map(async (record) => {
                const isUpdate = !!record.Id;
                const method = isUpdate ? "PATCH" : "POST";
                const apiUrl = isUpdate 
                    ? `${instanceUrl}/services/data/v65.0/sobjects/Signature__c/${record.Id}`
                    : `${instanceUrl}/services/data/v65.0/sobjects/Signature__c`;

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
                    throw new Error(`Failed to ${isUpdate ? 'update' : 'create'} Signature record (Field Index: ${record.Field_Index__c}): ${response.status} ${response.statusText} - ${errorText}`);
                }

                const result = await response.json();
                return result;
            });

            // Execute all upsert operations in parallel
            const results = await Promise.all(upsertPromises);
            console.log("Signature records upserted successfully:", results);
            return true;
        } catch (error) {
            console.error("Error upserting Signature records:", error);
            throw error;
        }
    };

    // Fetch Document__c record to get ContentVersion ID
    const fetchDocumentRecord = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;
            const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(`SELECT Id, Uploaded_Document_Id__c, Signing_Details__c, Status__c, CreatedDate, CreatedBy.Name, CreatedBy.Email, Email_Subject__c, Document_Name__c, Expiration_Date__c FROM Document__c WHERE Id='${documentId}' LIMIT 1`)}`;
            // Salesforce REST API endpoint to get Document__c record
            // const apiUrl = `${instanceUrl}/services/data/v65.0/query/?q=${encodeURIComponent(objQuery)}`;

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

            let documentData = await response.json();
            documentData = documentData.records[0];
            console.log('documentData', documentData);
            
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
                                // Process nested fields
                                entry.fields.forEach((field) => {
                                    const typeLower = typeof field.type === "string" ? field.type.toLowerCase() : "";
                                    const isFieldType = ["text", "date", "number", "email", "checkbox", "initials"].includes(typeLower);
                                    const isSignatureType = ["signature"].includes(typeLower) || (!isFieldType && !field.fieldType);
                                    
                                    if (isFieldType) {
                                        parsedFieldData.push({
                                            ...field,
                                            fieldType: typeLower,
                                            filled: Boolean(field.filled),
                                            // Attach signer info to field
                                            signerPriority: entry.priority,
                                            signerEmail: entry.email,
                                            signerName: entry.name,
                                        });
                                    } else if (isSignatureType) {
                                        parsedSignatureData.push({
                                            ...entry,
                                            signed: Boolean(entry.signed),
                                        });
                                    }
                                });
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
            
            console.log("Fetched Signature__c records:", signatureRecords);
            
            // Create a map of fieldIndex -> signature data
            // Store with both string and number keys to handle type mismatches
            const signatureMap = new Map();
            signatureRecords.forEach((record) => {
                try {
                    const sigDetails = JSON.parse(record.Signing_Details__c);
                    const fieldIndex = record.Field_Index__c;
                    // Store with original value (string)
                    signatureMap.set(fieldIndex, sigDetails);
                    // Also store with number if it's numeric
                    if (!isNaN(fieldIndex)) {
                        signatureMap.set(Number(fieldIndex), sigDetails);
                    }
                    // Also store with string if it's a number
                    signatureMap.set(String(fieldIndex), sigDetails);
                    console.log(`Mapped field index ${fieldIndex} to signature data:`, sigDetails);
                } catch (e) {
                    console.warn(`Failed to parse Signature record ${record.Id}:`, e);
                }
            });

            // Merge imageUrl data back into parsedSignatureData fields
            parsedSignatureData = parsedSignatureData.map((sig) => {
                if (sig.fields && Array.isArray(sig.fields)) {
                    return {
                        ...sig,
                        fields: sig.fields.map((field) => {
                            console.log(`Looking up signature data for field index: ${field.index} (type: ${typeof field.index})`);
                            const sigData = signatureMap.get(field.index);
                            if (sigData) {
                                console.log(`Found signature data for field ${field.index}:`, sigData);
                                return {
                                    ...field,
                                    imageUrl: sigData.imageUrl || null,
                                    ipAddress: sigData.ipAddress || field.ipAddress || "",
                                    timestamp: sigData.timestamp || field.timestamp || "",
                                    filled: Boolean(sigData.imageUrl), // Set filled based on imageUrl presence
                                };
                            } else {
                                console.log(`No signature data found for field ${field.index}`);
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
                setPageDimensions([]);
                pdfDocRef.current = null;
                canvasRefsArray.current = [];
                setLoading(false);
                return;
            }

            console.log(`Fetched ContentVersion ID: ${contentVersionId}`);
            console.log(`Signature Data:`, sigData);
            console.log(`Field Data:`, fieldDataFromRecord);

            // Store document record and data directly (no parsing needed)
            setDocumentRecord(documentData);
            const signatures = Array.isArray(sigData) ? sigData : [];
            const fields = Array.isArray(fieldDataFromRecord) ? fieldDataFromRecord : [];
            setSignatureData(signatures);
            setFieldData(fields);
            
            // Store initial data to detect changes later
            setInitialSignatureData(JSON.parse(JSON.stringify(signatures)));
            setInitialFieldData(JSON.parse(JSON.stringify(fields)));

            // Step 2: Fetch PDF from ContentVersion
            await fetchPdfFromContentVersion(contentVersionId, currentToken, instanceUrl);
        } catch (error) {
            console.error("Error in fetchDocumentAndPdf:", error);
            setError(`Failed to load document: ${error.message}`);
        } finally {
            setLoading(false);
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

            console.log("Document record updated successfully");
            return true;
        } catch (error) {
            console.error("Error updating Document record:", error);
            throw error;
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
            console.log("Signed PDF uploaded successfully. ContentVersion ID:", result.id);
            return result.id;
        } catch (error) {
            console.error("Error uploading signed PDF to Salesforce:", error);
            throw error;
        }
    };

    // Check URL parameters on mount
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const accessToken = urlParams.get("act");
        const recordId = urlParams.get("recordId");
        const instanceUrl = urlParams.get("instanceUrl");
        const clientId = urlParams.get("clientId");
        const clientSecret = urlParams.get("clientSecret");
        const priority = urlParams.get("priority");

        // Parse and store priority if provided
        const parsedPriority = priority ? parseInt(priority, 10) : 1;
        setUrlPriority(parsedPriority);

        if (recordId && instanceUrl) {
            // Store Salesforce config for later use
            setSalesforceConfig({ accessToken, recordId, instanceUrl, clientId, clientSecret });

            // Fetch Document__c record and then PDF
            fetchDocumentAndPdf(recordId, accessToken, instanceUrl, clientId, clientSecret);

            // Also fetch Organization Id
            fetchOrganizationId(accessToken, instanceUrl, clientId, clientSecret)
                .then((id) => setOrgIdState(id))
                .catch(() => setOrgIdState(null));
        }

        // window.history.replaceState({}, document.title, window.location.pathname);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const renderPage = async (pdf, pageNumber, canvas, targetWidth) => {
        if (!canvas) {
            console.error("Canvas not available for page", pageNumber);
            return null;
        }

        const page = await pdf.getPage(pageNumber);
        const originalViewport = page.getViewport({ scale: 1 });

        // Calculate scale to fit target width or use original dimensions
        const pageWidth = originalViewport.width || A4_WIDTH;
        const pageHeight = originalViewport.height || A4_HEIGHT;
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

        setPageDimensions(dimensions);
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


    // Handle signature button click - will open signature modal
    const handleSignatureClick = (signature) => {
        if (isSubmitted) return;
        console.log("Signature clicked:", signature);
        setCurrentSignature(signature);
        setIsModalOpen(true);
    };

    // Handle signature save from modal
    const handleSignatureSave = async (imageData, signature, signatureType) => {
        console.log("signatureType==> ", signatureType);
        console.log("imageData==> ", imageData);
        console.log("signature==> ", signature);
        // Validate that this is actually a signature, not a field
        if (signature.fieldType) {
            console.error("Attempted to save signature image to a field:", signature);
            return;
        }

        try {
            // 1. Get user's public IP address
            const ipRes = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipRes.json();
            const ipAddress = ipData.ip;

            const timeStamp = new Date().toLocaleString();
            let userAgent = navigator.userAgent || "Unknown Device";

            // Extract OS and Chrome version
            const osMatch = userAgent.match(/\(([^;]+);/);
            const osVersion = osMatch ? osMatch[1].trim() : "Unknown OS";

            const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
            const chromeVersion = chromeMatch ? chromeMatch[1] : "Unknown Chrome Version";

            // Final clean string
            const deviceInfo = `${osVersion} Chrome/${chromeVersion}`;
            console.log("extractedDeviceInfo==> ", deviceInfo);

            let locationInfo = await getLocationLive();
            console.log("locationInfo==> ", locationInfo);
            // Get the parent signer object (attached in handleSignatureClick)
            const signerObject = signature._parentSigner;
            
            // 2. Update signatures array with image and ipAddress, passing signer object for correct matching
            let updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData, signature.type, signerObject);
            console.log("updatedSignatures==> ", updatedSignatures);
            
            // 3. Insert ipAddress in the correct signer's fields only
            updatedSignatures = updatedSignatures.map(sig => {
                // Only update the fields if this is the correct signer
                if (sig.fields && Array.isArray(sig.fields)) {
                    const isCorrectSigner = signerObject && (sig.priority === signerObject.priority || sig.email === signerObject.email);
                    if (isCorrectSigner) {
                        return {
                            ...sig,
                            fields: sig.fields.map(field => {
                                if (field.index === signature.index) {
                                    return {
                                        ...field,
                                        ipAddress,
                                        deviceInfo,
                                        locationInfo,
                                        timeStamp,
                                        signatureType,      
                                        filled: true        
                                    };
                                }
                                return field;
                            })
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

    // Handle modal close
    const handleModalClose = () => {
        setIsModalOpen(false);
        setCurrentSignature(null);
    };

    // Handle signature deletion
    const handleSignatureDelete = (signature) => {
        console.log("Delete signature:", signature);
        
        // Get the parent signer object (attached in handleSignatureClick)
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

    // Handle field button click
    const handleFieldClick = (field) => {
        if (isSubmitted) return;
        console.log("Field clicked:", field);
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

    // Handle field save from modal
    const handleFieldSave = (value, field) => {
        // Validate that this is actually a field, not a signature
        if (!field.fieldType) {
            console.error("Attempted to save field value to a signature:", field);
            return;
        }
        
        console.log("Field saved:", field.index, value);
        const updatedFields = updateFieldWithValue(fieldData, field.index, value, field.fieldType || field.type);
        setFieldData(updatedFields);

        // Track that this field was filled in the current session
        setSessionFilledKeys((prev) => new Set(prev).add(field.index));
    };

    // Handle field modal close
    const handleFieldModalClose = () => {
        setIsFieldModalOpen(false);
        setCurrentField(null);
    };

    // Handle field deletion
    const handleFieldDelete = (field) => {
        console.log("Delete field:", field);
        const updatedFields = deleteFieldValue(fieldData, field.index, field.fieldType || field.type);
        setFieldData(updatedFields);

        // Remove from session filled keys
        setSessionFilledKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(field.index);
            return newSet;
        });
    };

    // Handle Save & Submit
    const handleSaveAndSubmit = async () => {
        // Validate if all signature fields are filled for current priority
        const unfilledFields = signatureData
            .filter(sig => sig.priority == urlPriority)
            .flatMap(sig => sig.fields || [])
            .filter(field => !field.filled);

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
                const filledFieldsNew = signatureData
                    .flatMap(sig => sig.fields || [])
                    .filter(field => field.filled && field.imageUrl);

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
                        const pdfY = pageHeight - ((field.yPercent / 100) * pageHeight) - ((field.heightPercent / 100) * pageHeight);
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
                        const pdfY = pageHeight - ((field.yPercent / 100) * pageHeight) - ((field.heightPercent / 100) * pageHeight);
                        const pdfWidth = (field.widthPercent / 100) * pageWidth;
                        const pdfHeight = (field.heightPercent / 100) * pageHeight;

                        // Format the value based on field type
                        let displayValue = "";
                        let isCheckbox = false;
                        let checkboxChecked = false;
                        
                        if (field.fieldType === "checkbox") {
                            isCheckbox = true;
                            // Handle both boolean and string values
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
                                    x: checkboxX + (checkboxSize * 0.1),
                                    y: checkboxY + (checkboxSize * 0.1) + 22,
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
                                y: pdfY + (pdfHeight / 2) - (fontSize / 3),
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
					const buildAuditData = () => {
						if (!documentRecord) return null;
						// Document information
						const createdDate = documentRecord.CreatedDate ? new Date(documentRecord.CreatedDate) : null;
						const modifiedDate = documentRecord.LastModifiedDate ? new Date(documentRecord.LastModifiedDate) : null;
						let emailSubject = documentRecord.Email_Subject__c || null;
						let ownerName = documentRecord.CreatedBy.Name || null;
						let ownerEmail = documentRecord.CreatedBy.Email || null;

						const documentName = documentRecord.Document_Name__c || documentRecord.Name || "";
						const orgId = orgIdState || "";
						
						// Signatures summary - handle both flat and nested field structures
						const sigs = Array.isArray(signatureData) ? signatureData : [];
						
						// Flatten all signature fields from nested structure
						const allSignatureFields = [];
						sigs.forEach((sig, sigIdx) => {
							if (sig.fields && Array.isArray(sig.fields)) {
								// New nested structure - extract fields
								sig.fields
                                .filter(f => (f.type || f.fieldType) === "signature")
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
								});
							}
						});
						
						const totalSignatures = allSignatureFields.length;
						const signedCount = allSignatureFields.filter(s => s.imagePresent).length;
						const pendingCount = totalSignatures - signedCount;
						
						return {
							createdDate,
							modifiedDate,
							emailSubject,
							ownerName,
							ownerEmail,
							documentName,
							orgId,
							documentId: documentRecord.Id,
							documentStatus: pendingCount > 0 ? "Pending" : "Signed",
							totalSignatures,
							signedCount,
							pendingCount,
							signatures: allSignatureFields,
						};
					};
					const data = buildAuditData();
					if (data) {
						// Get page dimensions dynamically from first page
						let PW = A4_WIDTH;
						let PH = A4_HEIGHT;
						try {
							const sz = pages[0]?.getSize();
							if (sz && sz.width && sz.height) {
								PW = sz.width;
								PH = sz.height;
							}
						} catch (e) {
                            console.log("Exception in build data");
                        }

						// Dynamic spacing based on page dimensions
						const margin = Math.max(32, PW * 0.05); 
						const headerHeight = Math.max(28, PH * 0.033);
						const headerTitleSize = Math.max(14, PH * 0.017);
						const sectionTitleSize = Math.max(10, PH * 0.012);
						const textSize = Math.max(10, PH * 0.0105);
						const lineHeight = Math.max(14, PH * 0.017);
						const sectionSpacing = Math.max(16, PH * 0.019);
						const boxSpacing = Math.max(8, PW * 0.01);
						const rowHeight = Math.max(60, PH * 0.071);
						const imgHeight = Math.max(50, rowHeight * 0.83);
						const tableHeaderHeight = Math.max(24, PH * 0.028);

						// Embed font once
						const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

						// Styles
						const blue = rgb(0.12, 0.59, 0.95);
						const darkBlue = rgb(0.10, 0.46, 0.82);
						const green = rgb(0.18, 0.49, 0.20);
						const orange = rgb(0.96, 0.49, 0.00);
						const gray = rgb(0.2, 0.2, 0.2);
						const lightGray = rgb(0.93, 0.95, 0.97);

						// Helper function to format dates
						const fmt = (d) => (d ? new Date(d).toLocaleString() : "");

						// Function to draw a single audit report page
						const drawAuditPage = async (page, startYFromTop, signaturesToDraw) => {
							// Helper function to draw text on the page
							const drawText = (text, opts) => page.drawText(String(text ?? ""), { font, ...opts });

							// Helper function to center text
							const centerText = (text, size, boxX, boxW, yFromBottom, color) => {
								const t = String(text ?? "");
								const w = font.widthOfTextAtSize(t, size);
								const cx = boxX + (boxW - w) / 2;
								drawText(t, { x: cx, y: yFromBottom, size, color });
							};
							
							// startYFromTop is distance from top, convert to distance from bottom
							let currentYFromTop = startYFromTop; // Track from top for calculations
							let currentYFromBottom = PH - currentYFromTop; // Convert to bottom-up for drawing

							// Header bar (at top of page)
							const headerBarYFromBottom = PH - currentYFromTop;
							page.drawRectangle({ 
								x: margin, 
								y: headerBarYFromBottom - headerHeight,
								width: PW - (margin * 2), 
								height: headerHeight, 
								color: blue, 
								borderColor: darkBlue, 
								borderWidth: 1 
							});
							const title = "Audit Report";
							const titleWidth = font.widthOfTextAtSize(title, headerTitleSize);
							const titleX = margin + (PW - (margin * 2) - titleWidth) / 2;
							drawText(title, { 
								x: titleX, 
								y: headerBarYFromBottom - (headerHeight / 2) - (headerTitleSize / 3), 
								size: headerTitleSize, 
								color: rgb(1, 1, 1) 
							});
							currentYFromTop += headerHeight + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Document Info box
							const docInfoBoxHeight = Math.max(120, PH * 0.126);
							const docInfoYFromBottom = PH - currentYFromTop;
							page.drawRectangle({ 
								x: margin, 
								y: docInfoYFromBottom - docInfoBoxHeight, // Rectangle bottom Y
								width: PW - (margin * 2), 
								height: docInfoBoxHeight, 
								color: lightGray, 
								borderColor: rgb(0.88, 0.88, 0.88), 
								borderWidth: 2 
							});
							
							// Document Information title
							const docInfoTitle = "Document Information";
							const docInfoTitleWidth = font.widthOfTextAtSize(docInfoTitle, sectionTitleSize);
							const docInfoTitleX = margin + (PW - (margin * 2) - docInfoTitleWidth) / 2;
							drawText(docInfoTitle, { 
								x: docInfoTitleX - 10, 
								y: docInfoYFromBottom - (sectionTitleSize * 1.5), 
								size: headerTitleSize, 
								color: darkBlue 
							});

							// Document info fields
							const leftX = margin + 16;
							const rightX = (PW / 2) + 8;
							let infoYFromBottom = docInfoYFromBottom - (sectionTitleSize * 2) - lineHeight;
							const writeKV = (kx, kyFromBottom, k, v) => {
								drawText(`${k}`, { x: kx, y: kyFromBottom, size: textSize, color: gray });
								const valueX = kx + Math.max(120, PW * 0.15);
								drawText(v || "", { x: valueX, y: kyFromBottom, size: textSize, color: gray });
							};

							// Left column
							writeKV(leftX, infoYFromBottom, "Sent Date:", fmt(data.createdDate));
							infoYFromBottom -= lineHeight;
							writeKV(leftX, infoYFromBottom, "Document Name:", data.documentName);
							infoYFromBottom -= lineHeight;
							writeKV(leftX, infoYFromBottom, "Document Owner:", data.ownerName);
							infoYFromBottom -= lineHeight;
							writeKV(leftX, infoYFromBottom, "Document Owner Email:", data.ownerEmail);
							infoYFromBottom -= lineHeight;
							writeKV(leftX, infoYFromBottom, "Email Subject:", data.emailSubject);

							// Right column
							let infoYRFromBottom = docInfoYFromBottom - (sectionTitleSize * 2) - lineHeight;
							// writeKV(rightX, infoYRFromBottom, "Last Viewed Date:", fmt(data.modifiedDate));
							// infoYRFromBottom -= lineHeight;
							writeKV(rightX, infoYRFromBottom, "Document ID:", data.documentId || "");
							infoYRFromBottom -= lineHeight;
							writeKV(rightX, infoYRFromBottom, "Org id:", data.orgId || "");
							infoYRFromBottom -= lineHeight;
							writeKV(rightX, infoYRFromBottom, "Document Status:", data.documentStatus);
							infoYRFromBottom -= lineHeight;
							writeKV(rightX, infoYRFromBottom, "Document Pages:", totalPages);

							currentYFromTop += docInfoBoxHeight + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Signature Summary title
							const summaryTitle = "Signature Summary";
							const summaryTitleWidth = font.widthOfTextAtSize(summaryTitle, sectionTitleSize);
							const summaryTitleX = margin + (PW - (margin * 2) - summaryTitleWidth) / 2;
							drawText(summaryTitle, { 
								x: summaryTitleX - 16 , 
								y: currentYFromBottom - 6, 
								size: headerTitleSize, 
								color: darkBlue 
							});
							currentYFromTop += (sectionTitleSize * 1.5) + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Signature summary boxes
							const boxHeight = Math.max(50, PH * 0.059);
							const boxYFromBottom = currentYFromBottom + 16;
							const totalBoxWidth = PW - (margin * 2);
							const boxW = (totalBoxWidth - (boxSpacing * 2)) / 3;
							const offsets = [margin, margin + boxW + boxSpacing, margin + (boxW + boxSpacing) * 2];
							const labels = ["Total Signatures", "Signed", "Pending"];
							const values = [data.totalSignatures, data.signedCount, data.pendingCount];
							const colors = [blue, green, orange];
							const valueSize = Math.max(16, PH * 0.019);
							const labelSize = Math.max(9, PH * 0.011);

							for (let i = 0; i < 3; i++) {
								const bx = offsets[i];
								page.drawRectangle({ 
									x: bx, 
									y: boxYFromBottom - boxHeight , // Rectangle bottom Y
									width: boxW, 
									height: boxHeight, 
									color: rgb(0.97, 0.97, 0.97), 
									borderColor: rgb(0.85, 0.85, 0.85), 
									borderWidth: 2 
								});
								centerText(String(values[i] ?? 0), valueSize, bx, boxW, boxYFromBottom - (boxHeight * 0.4), colors[i]);
								centerText(labels[i], labelSize, bx, boxW, boxYFromBottom - (boxHeight * 0.75), gray);
							}
							currentYFromTop += boxHeight + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Signature Events title
							const eventsTitle = "Signature Events";
							const eventsTitleWidth = font.widthOfTextAtSize(eventsTitle, headerTitleSize);
							const eventsTitleX = margin + (PW - (margin * 2) - eventsTitleWidth) / 2;
							drawText(eventsTitle, { 
								x: eventsTitleX, 
								y: currentYFromBottom + 14, 
								size: headerTitleSize, 
								color: darkBlue 
							});
							currentYFromTop += (headerTitleSize * 1.5) + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Table column widths (dynamic)
							const totalTblW = PW - (margin * 2);
							const padding = Math.max(6, PW * 0.008);
							const imgColW = Math.max(120, PW * 0.18);
							const statusColW = Math.max(70, PW * 0.1);
                            const signatureTypeColW = Math.max(70, PW * 0.1);
							const internalGaps = padding * 3;
							const remW = totalTblW - (imgColW + statusColW + internalGaps);
							const sigDetailsColW = Math.max(120, Math.floor(remW / 2));
							const userColW = Math.max(120, remW - sigDetailsColW);
							const colXs = [
								margin + padding,
								margin + padding + imgColW + padding,
								margin + padding + imgColW + padding + statusColW + padding,
								margin + padding + imgColW + padding + statusColW + padding + sigDetailsColW + padding
							];

							// Table header
							const headerYFromBottom = currentYFromBottom;
							page.drawRectangle({ 
								x: margin, 
								y: headerYFromBottom - tableHeaderHeight + 44 , // Rectangle bottom Y
								width: totalTblW, 
								height: tableHeaderHeight, 
								color: darkBlue 
							});
							const header = ["Signature", "Signature Type", "Signature Details", "User Details"];
							const headerSizes = [imgColW, statusColW, sigDetailsColW, userColW];
							const headerTextSize = Math.max(9, PH * 0.011);
							for (let i = 0; i < header.length; i++) {
								const hw = font.widthOfTextAtSize(header[i], headerTextSize);
								const colStart = colXs[i];
								const colW = headerSizes[i];
								const hx = colStart + (colW - hw) / 2;
								drawText(header[i], { 
									x: hx, 
									y: headerYFromBottom - (tableHeaderHeight / 2) - (headerTextSize / 3) + 44, 
									size: headerTextSize, 
									color: rgb(1, 1, 1) 
								});
							}
							currentYFromTop += tableHeaderHeight + sectionSpacing;
							currentYFromBottom = PH - currentYFromTop;

							// Calculate available space for signature rows
							const bottomMargin = Math.max(40, PH * 0.047);
							const availableHeight = currentYFromBottom - bottomMargin;
							const maxRowsPerPage = Math.floor(availableHeight / rowHeight);

							// Draw signature rows
							const rowTextSize = Math.max(8, PH * 0.0095);
							let rowYFromBottom = currentYFromBottom;
							let rowsDrawn = 0;

                            for (const sign of signaturesToDraw) {
								if (rowsDrawn >= maxRowsPerPage) break;

                                // const status = sign.imagePresent ? "SIGNED" : "PENDING";
                                // const statusColor = sign.imagePresent ? green : orange;
                                console.log('sign signatureType', sign.signatureType);
                                const signatureType = sign.signatureType || "--";

								// Draw signature thumbnail if available
                                if (sign.imagePresent && sign.imageUrl) {
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
										const imgW = imgColW - (padding * 2);
										const imgH = imgHeight;
										const imgYFromBottom = rowYFromBottom - (rowHeight - imgH) / 2;
										// Border around image
										page.drawRectangle({ 
											x: colXs[0] - 2, 
											y: imgYFromBottom - imgH + 50, // Rectangle bottom Y
											width: imgW + 4, 
											height: imgH + 4, 
											borderColor: rgb(0.75, 0.75, 0.75), 
											borderWidth: 1 
										});
										page.drawImage(img, { 
											x: colXs[0], 
											y: imgYFromBottom - imgH + 50, // Image bottom Y
											width: imgW, 
											height: imgH 
										});
									} catch (e) {
										// Fallback to id text if image fails
                                        drawText(`#${sign.index}`, { 
											x: colXs[0], 
											y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3), 
											size: rowTextSize, 
											color: gray 
										});
									}
								} else {
                                    drawText(`#${sign.index}`, { 
										x: colXs[0], 
										y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3), 
										size: rowTextSize, 
										color: gray 
									});
								}

								// Status (centered)
								const statusW = font.widthOfTextAtSize(status, rowTextSize);
								const statusX = colXs[1] + (statusColW - statusW) / 2;
								// drawText(status, { 
								// 	x: statusX, 
								// 	y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3) + 50, 
								// 	size: rowTextSize, 
								// 	color: statusColor 
								// });
                                const typeW = font.widthOfTextAtSize(signatureType, rowTextSize);
                                const typeX = colXs[1] + (signatureTypeColW - typeW) / 2;
                                drawText(signatureType, { 
                                    x: typeX, 
                                    y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3) + 50, 
                                    size: rowTextSize,
                                    color: gray
                                });


								// Signature details
                                const signedOn = sign.timeStamp || new Date().toLocaleString();
                                const sigDetails = sign.imagePresent ? `IP: ${sign.ipAddress || "--"}` : "--";
                                let deviceInfo = sign.imagePresent ? `Device: ${sign.deviceInfo || "--"}` : "--";
                                let locationInfo = sign.imagePresent ? `Location: ${sign.locationInfo || "--"}` : "--";
                                // Draw IP
                                drawText(sigDetails, { 
                                    x: colXs[2], 
                                    y: rowYFromBottom - (rowHeight * 0.28) + 50, 
                                    size: rowTextSize, 
                                    color: gray 
                                });
                                // Draw Signed On
                                drawText(`Signed On: ${signedOn}`, { 
                                    x: colXs[2], 
                                    y: rowYFromBottom - (rowHeight * 0.45) + 50, 
                                    size: rowTextSize, 
                                    color: gray 
                                });
                                // Draw Device Info with extra spacing below Signed On
                                drawText(deviceInfo, { 
                                    x: colXs[2], 
                                    y: rowYFromBottom - (rowHeight * 0.62) + 50, 
                                    size: rowTextSize, 
                                    color: gray 
                                });
                                drawText(locationInfo, { 
                                    x: colXs[2], 
                                    y: rowYFromBottom - (rowHeight * 0.79) + 50, 
                                    size: rowTextSize, 
                                    color: gray 
                                });

								// User details
                                drawText(`Name: ${sign.signeeName || "--"}`, { 
									x: colXs[3], 
									y: rowYFromBottom - (rowHeight * 0.35) + 50, 
									size: rowTextSize, 
									color: gray 
								});
                                drawText(`Email: ${sign.signeeEmail || "--"}`, { 
									x: colXs[3], 
									y: rowYFromBottom - (rowHeight * 0.65) + 50, 
									size: rowTextSize, 
									color: gray 
								});

								rowYFromBottom -= rowHeight;
								rowsDrawn++;
							}

							return rowsDrawn;
						};

						// Calculate how many signatures can fit on first page
						// Use already declared dynamic spacing variables
						const docInfoBoxHeight = Math.max(140, PH * 0.166);
						const boxHeight = Math.max(50, PH * 0.059);
						const bottomMargin = Math.max(40, PH * 0.047);
						
						const fixedSectionsHeight = 
							margin + // top margin
							headerHeight + sectionSpacing + // header
							docInfoBoxHeight + sectionSpacing + // document info
							(sectionTitleSize * 1.5) + sectionSpacing + // summary title
							boxHeight + sectionSpacing + // summary boxes
							(headerTitleSize * 1.5) + sectionSpacing + // events title
							tableHeaderHeight + sectionSpacing + // table header
							bottomMargin; // bottom margin

						const availableHeight = PH - fixedSectionsHeight;
						const maxRowsPerPage = Math.floor(availableHeight / rowHeight);

						// Create first page and draw initial content
						let currentPage = pdfDoc.addPage([PW, PH]);
						let signaturesRemaining = [...data.signatures];
						let pageNum = 1;

						while (signaturesRemaining.length > 0) {
							// Draw the page (only draw header sections on first page)
							if (pageNum === 1) {
								// Determine how many signatures to draw on first page
								const signaturesToDraw = signaturesRemaining.slice(0, maxRowsPerPage);
								const startY = margin; // Always start from top margin
								await drawAuditPage(currentPage, startY, signaturesToDraw);
								// Remove drawn signatures
								signaturesRemaining = signaturesRemaining.slice(signaturesToDraw.length);
							} else {
								// For subsequent pages, only draw table header and rows
								// Helper function to draw text on the page
								const drawText = (text, opts) => currentPage.drawText(String(text ?? ""), { font, ...opts });
								
								// Use bottom-up coordinates (pdf-lib system)
								let currentYFromTop = margin;
								let currentYFromBottom = PH - currentYFromTop;
								
								// Page continuation header
								const continuationTitle = `Signature Events (continued) - Page ${pageNum}`;
								const continuationTitleWidth = font.widthOfTextAtSize(continuationTitle, headerTitleSize);
								const continuationTitleX = margin + (PW - (margin * 2) - continuationTitleWidth) / 2;
								drawText(continuationTitle, { 
									x: continuationTitleX, 
									y: currentYFromBottom, 
									size: headerTitleSize, 
									color: darkBlue 
								});
								currentYFromTop += (headerTitleSize * 1.5) + sectionSpacing;
								currentYFromBottom = PH - currentYFromTop;

								// Table header
								const tableHeaderHeight = Math.max(24, PH * 0.028);
								const totalTblW = PW - (margin * 2);
								const padding = Math.max(6, PW * 0.008);
								const imgColW = Math.max(120, PW * 0.18);
								const statusColW = Math.max(70, PW * 0.1);
								const signatureTypeColW = Math.max(70, PW * 0.1);
								const internalGaps = padding * 3;
								const remW = totalTblW - (imgColW + statusColW + internalGaps);
								const sigDetailsColW = Math.max(120, Math.floor(remW / 2));
								const userColW = Math.max(120, remW - sigDetailsColW);
								const colXs = [
									margin + padding,
									margin + padding + imgColW + padding,
									margin + padding + imgColW + padding + statusColW + padding,
									margin + padding + imgColW + padding + statusColW + padding + sigDetailsColW + padding
								];

								const headerYFromBottom = currentYFromBottom;
								currentPage.drawRectangle({ 
									x: margin, 
									y: headerYFromBottom - tableHeaderHeight, // Rectangle bottom Y
									width: totalTblW, 
									height: tableHeaderHeight, 
									color: darkBlue 
								});
								const header = ["Signature", "Signature Type", "Signature Details", "User Details"];
								const headerSizes = [imgColW, statusColW, sigDetailsColW, userColW];
								const headerTextSize = Math.max(9, PH * 0.011);
								for (let i = 0; i < header.length; i++) {
									const hw = font.widthOfTextAtSize(header[i], headerTextSize);
									const colStart = colXs[i];
									const colW = headerSizes[i];
									const hx = colStart + (colW - hw) / 2;
									drawText(header[i], { 
										x: hx, 
										y: headerYFromBottom - (tableHeaderHeight / 2) - (headerTextSize / 3), 
										size: headerTextSize, 
										color: rgb(1, 1, 1) 
									});
								}
								currentYFromTop += tableHeaderHeight + sectionSpacing;
								currentYFromBottom = PH - currentYFromTop;

								// Calculate how many rows can fit on continuation page
								const rowHeight = Math.max(60, PH * 0.071);
								const rowTextSize = Math.max(8, PH * 0.0095);
								const imgHeight = Math.max(50, rowHeight * 0.83);
								const availableHeight = currentYFromBottom - bottomMargin;
								const maxRowsOnThisPage = Math.floor(availableHeight / rowHeight);
								
								// Determine how many signatures to draw on this continuation page
								const signaturesToDraw = signaturesRemaining.slice(0, maxRowsOnThisPage);
								let rowYFromBottom = currentYFromBottom;

                                for (const sign of signaturesToDraw) {
                                    const status = sign.imagePresent ? "SIGNED" : "PENDING";
                                    const statusColor = sign.imagePresent ? green : orange;
                                    const signatureType = sign.signatureType || "--";

									// Draw signature thumbnail if available
                                    if (sign.imagePresent && sign.imageUrl) {
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
											const imgW = imgColW - (padding * 2);
											const imgH = imgHeight;
											const imgYFromBottom = rowYFromBottom - (rowHeight - imgH) / 2;
											currentPage.drawRectangle({ 
												x: colXs[0] - 2, 
												y: imgYFromBottom - imgH - 2, // Rectangle bottom Y
												width: imgW + 4, 
												height: imgH + 4, 
												borderColor: rgb(0.75, 0.75, 0.75), 
												borderWidth: 1 
											});
											currentPage.drawImage(img, { 
												x: colXs[0], 
												y: imgYFromBottom - imgH, // Image bottom Y
												width: imgW, 
												height: imgH 
											});
										} catch (e) {
                                            drawText(`#${sign.index}`, { 
												x: colXs[0], 
												y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3), 
												size: rowTextSize, 
												color: gray 
											});
										}
									} else {
                                        drawText(`#${sign.index}`, { 
											x: colXs[0], 
											y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3), 
											size: rowTextSize, 
											color: gray 
										});
									}

									const statusW = font.widthOfTextAtSize(status, rowTextSize);
									const statusX = colXs[1] + (statusColW - statusW) / 2;
									// drawText(status, { 
									// 	x: statusX, 
									// 	y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3), 
									// 	size: rowTextSize, 
									// 	color: statusColor 
									// });
                                    const typeW = font.widthOfTextAtSize(signatureType, rowTextSize);
                                    const typeX = colXs[1] + (signatureTypeColW - typeW) / 2;
                                    drawText(signatureType, { 
                                        x: typeX, 
                                        y: rowYFromBottom - (rowHeight / 2) - (rowTextSize / 3) + 50, 
                                        size: rowTextSize,
                                        color: gray
                                    });

                                    const signedOn = sign.timeStamp || new Date().toLocaleString();
                                    const sigDetails = sign.imagePresent ? `IP: ${sign.ipAddress || "--"}` : "--";
                                    let deviceInfo = sign.imagePresent ? `Device: ${sign.deviceInfo || "--"}` : "--";
                                    let locationInfo = sign.imagePresent ? `Device: ${sign.locationInfo || "--"}` : "--";

									drawText(sigDetails, { 
										x: colXs[2], 
										y: rowYFromBottom - (rowHeight * 0.28) + 50, 
										size: rowTextSize, 
										color: gray 
									});
									drawText(`Signed On: ${signedOn}`, { 
										x: colXs[2], 
										y: rowYFromBottom - (rowHeight * 0.45) + 50, 
										size: rowTextSize, 
										color: gray 
									});
                                    drawText(deviceInfo, { 
                                        x: colXs[2], 
                                        y: rowYFromBottom - (rowHeight * 0.62) + 50, 
                                        size: rowTextSize, 
                                        color: gray 
                                    });
                                    drawText(locationInfo, { 
                                        x: colXs[2], 
                                        y: rowYFromBottom - (rowHeight * 0.79) + 50, 
                                        size: rowTextSize, 
                                        color: gray 
                                    });

                                    drawText(`Name: ${sign.signeeName || "--"}`, { 
										x: colXs[3], 
										y: rowYFromBottom - (rowHeight * 0.35), 
										size: rowTextSize, 
										color: gray 
									});
                                    drawText(`Email: ${sign.signeeEmail || "--"}`, { 
										x: colXs[3], 
										y: rowYFromBottom - (rowHeight * 0.65), 
										size: rowTextSize, 
										color: gray 
									});

									rowYFromBottom -= rowHeight;
								}
								
								// Remove drawn signatures
								signaturesRemaining = signaturesRemaining.slice(signaturesToDraw.length);
							}

							// If more signatures remain, create a new page
							if (signaturesRemaining.length > 0) {
								pageNum++;
								currentPage = pdfDoc.addPage([PW, PH]);
							}
						}
					}
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
                    const allFieldsFilled = signatureData.every(sig => 
                        (sig.fields || []).every(field => field.filled)
                    );

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
                    Status__c: "Rejected"
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
                        Status__c: "Rejected"
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
                type: "error"
            });

        } catch (error) {
            console.error("Reject error:", error);
            setToast({
                isVisible: true,
                message: `Error rejecting document: ${error.message}`,
                type: "error"
            });
        }
    };


    // Close toast
    const handleCloseToast = () => {
        setToast({ isVisible: false, message: "", type: "success" });
    };

    // Check if Save & Submit button should be shown
    const shouldShowSaveButton = () => {
        // If already submitted in this session, hide button
        
        if (isSubmitted) {
            console.log(1);
            return false;
        }

        // Get all fields for current priority from all signatures
        const currentPriorityFields = signatureData
            .filter((sig) => sig.priority == urlPriority)
            .flatMap(sig => sig.fields || []);
            
        const initialPriorityFields = initialSignatureData
            .filter((sig) => sig.priority == urlPriority)
            .flatMap(sig => sig.fields || []);

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
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
            );
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
                    <svg
                        className="expired-svg"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                    </svg>
                    </div>

                    <h3 className="expired-title">Document Expired</h3>

                    <p className="expired-message">
                    This document has expired and is no longer available for signing.
                    </p>

                    <p className="expired-hint">
                    Please contact the document owner if you believe this is an error.
                    </p>

                    <button className="expired-button">Contact Support</button>
                </div>
                )}


            {pdfFile && !isExpired && (
                <>
                    <div className="pdf-container">
                        <div className="heading">
                            <h1 class="document-header">Send Document for Signing</h1>
                        </div>
                        <div className="content-section">
                            <div className="preview-section">
                                <div className="pages">
                                    {Array.from({ length: totalPages }, (_, index) => {
                                        const pageNumber = index + 1;
                                        return (
                                            <div key={index} className="preview-page-wrapper" onClick={() => handleScrollToPage(pageNumber)} >
                                                <div className="preview-canvas-wrapper">
                                                    <canvas ref={(el) => (canvasRefsArray.current[`thumb-${index}`] = el)} className="preview-thumbnail"/>                                                </div>
                                                <div className="preview-page-number">{pageNumber}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {shouldShowSaveButton() && (
                                    <div className="bottom-bar">
                                        <div className="bottom-bar-left">
                                            <input
                                                type="checkbox"
                                                checked={initialAccepted}
                                                onChange={(e) => setInitialAccepted(e.target.checked)}
                                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                                            />
                                            <span> I have accept the <a target="_blank" href="https://mvclouds.com/products/signature-anywhere" className="termAndConditionLink">t & c ↗</a></span>
                                        </div>
                                        <div className="bottom-bar-right">
                                                <div className="action-btns">
                                                    <button className="reject-btn" onClick={handleReject}>
                                                        Reject
                                                    </button>
                                                    <button className="save-submit-btn" onClick={handleSaveAndSubmit} disabled={!initialAccepted}>
                                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M17.8452 4.0874C19.1239 3.66152 20.3408 4.87805 19.9146 6.15674L15.6724 18.8823C15.2246 20.2247 13.3986 20.4032 12.6987 19.1733L10.1675 14.7222L12.6685 12.2222C12.9141 11.9765 12.9141 11.5782 12.6685 11.3325C12.4228 11.0868 12.0245 11.0868 11.7788 11.3325L9.27686 13.8335L4.82764 11.3032C3.59725 10.6034 3.77671 8.77723 5.11963 8.32959L17.8452 4.0874Z" fill="white"/>
                                                        </svg>
                                                        Submit
                                                    </button>
                                                </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="canvas-container">
                                <div class="pdf-header">
                                    <h4>Document Preview</h4>
                                    <span> {totalPages} pages</span>
                                    <div class="pdf-file-info">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M6 3C4.89688 3 4 3.89688 4 5V17C4 18.1031 4.89688 19 6 19H8.5V15.5C8.5 14.3969 9.39687 13.5 10.5 13.5H16V8.32812C16 7.79688 15.7906 7.2875 15.4156 6.9125L12.0844 3.58438C11.7094 3.20938 11.2031 3 10.6719 3H6ZM14.1719 8.5H11.25C10.8344 8.5 10.5 8.16563 10.5 7.75V4.82812L14.1719 8.5ZM10.5 14.875C10.1562 14.875 9.875 15.1562 9.875 15.5V19.5C9.875 19.8438 10.1562 20.125 10.5 20.125C10.8438 20.125 11.125 19.8438 11.125 19.5V18.625H11.5C12.5344 18.625 13.375 17.7844 13.375 16.75C13.375 15.7156 12.5344 14.875 11.5 14.875H10.5ZM11.5 17.375H11.125V16.125H11.5C11.8438 16.125 12.125 16.4062 12.125 16.75C12.125 17.0938 11.8438 17.375 11.5 17.375ZM14.5 14.875C14.1562 14.875 13.875 15.1562 13.875 15.5V19.5C13.875 19.8438 14.1562 20.125 14.5 20.125H15.5C16.3969 20.125 17.125 19.3969 17.125 18.5V16.5C17.125 15.6031 16.3969 14.875 15.5 14.875H14.5ZM15.125 18.875V16.125H15.5C15.7063 16.125 15.875 16.2937 15.875 16.5V18.5C15.875 18.7063 15.7063 18.875 15.5 18.875H15.125ZM17.875 15.5V19.5C17.875 19.8438 18.1562 20.125 18.5 20.125C18.8438 20.125 19.125 19.8438 19.125 19.5V18.125H20C20.3438 18.125 20.625 17.8438 20.625 17.5C20.625 17.1562 20.3438 16.875 20 16.875H19.125V16.125H20C20.3438 16.125 20.625 15.8438 20.625 15.5C20.625 15.1562 20.3438 14.875 20 14.875H18.5C18.1562 14.875 17.875 15.1562 17.875 15.5Z" fill="#FF8282" />
                                        </svg>
                                        <span>{documentRecord?.Document_Name__c || 'document'}</span>
                                    </div>
                                </div>
                                {Array.from({ length: totalPages }, (_, index) => {
                                    const pageNumber = index + 1;
                                    return (
                                        <div key={index} className="page-wrapper" data-page={pageNumber}>
                                            <div className="page-number">Page {pageNumber}</div>
                                            <div className="canvas-wrapper">
                                                <canvas ref={(el) => (canvasRefsArray.current[index] = el)}></canvas>
                                                {signatureData.length > 0 && <SignatureOverlay pageNumber={pageNumber} priority={urlPriority} signatures={signatureData} onSign={handleSignatureClick} onDelete={handleSignatureDelete} isSubmitted={isSubmitted} sessionSignedKeys={sessionSignedKeys} />}
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
                                    <input
                                        type="checkbox"
                                        checked={initialAccepted}
                                        onChange={(e) => setInitialAccepted(e.target.checked)}
                                        style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                                    />
                                    <span> I have accept the <a target="_blank" href="https://mvclouds.com/products/signature-anywhere" className="termAndConditionLink">t & c ↗</a></span>
                                </div>
                                <div className="bottom-bar-right">
                                    <div className="action-btns">
                                        <button className="reject-btn" onClick={handleReject}>
                                            Reject
                                        </button>
                                        <button className="save-submit-btn" onClick={handleSaveAndSubmit} disabled={!initialAccepted}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M17.8452 4.0874C19.1239 3.66152 20.3408 4.87805 19.9146 6.15674L15.6724 18.8823C15.2246 20.2247 13.3986 20.4032 12.6987 19.1733L10.1675 14.7222L12.6685 12.2222C12.9141 11.9765 12.9141 11.5782 12.6685 11.3325C12.4228 11.0868 12.0245 11.0868 11.7788 11.3325L9.27686 13.8335L4.82764 11.3032C3.59725 10.6034 3.77671 8.77723 5.11963 8.32959L17.8452 4.0874Z" fill="white"/>
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

            {!pdfFile && !loading && !error && !isExpired &&(
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
