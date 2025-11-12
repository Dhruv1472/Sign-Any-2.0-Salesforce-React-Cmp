import { useState, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import { Buffer } from "buffer";
import "./pdfjs/pdf.worker.min.mjs";
import "./App.css";
import SignatureOverlay from "./components/SignatureOverlay";
import SignatureModal from "./components/SignatureModal";
import Toast from "./components/Toast";
import { updateSignatureWithImage, deleteSignatureImage } from "./utils/signatureUtils";

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
    const [signatureData, setSignatureData] = useState([]);
    const [documentRecord, setDocumentRecord] = useState(null);
    const [pageDimensions, setPageDimensions] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSignature, setCurrentSignature] = useState(null);
    const [toast, setToast] = useState({ isVisible: false, message: "", type: "success" });
    const [salesforceConfig, setSalesforceConfig] = useState(null);
    const [urlPriority, setUrlPriority] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false); // Track if document has been submitted
    const [sessionSignedKeys, setSessionSignedKeys] = useState(new Set()); // Track signatures signed in this session
    const [originalPdfBytes, setOriginalPdfBytes] = useState(null); // Store original PDF bytes for modification
    const [initialSignatureData, setInitialSignatureData] = useState([]); // Store initial signature data to detect changes
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

    // Fetch Document__c record to get ContentVersion ID
    const fetchDocumentRecord = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Salesforce REST API endpoint to get Document__c record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/Document__c/${documentId}`;

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

            const documentData = await response.json();
            const contentVersionId = documentData.Uploaded_Document_Id__c;
            const signatureDataJson = documentData.Signing_Details__c;

            if (!contentVersionId) {
                throw new Error("Uploaded_Document_Id__c field is empty in Document__c record");
            }

            // Parse signature data if available
            let parsedSignatureData = [];
            if (signatureDataJson) {
                try {
                    parsedSignatureData = JSON.parse(signatureDataJson);
                } catch (parseError) {
                    console.warn("Failed to parse Signing_Details__c:", parseError);
                }
            }

            return { contentVersionId, currentToken, documentData, signatureData: parsedSignatureData };
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

    // Main function to fetch Document and then PDF
    const fetchDocumentAndPdf = async (documentId, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        setLoading(true);
        setError(null);

        try {
            // Step 1: Fetch Document__c record to get ContentVersion ID and signature data
            const { contentVersionId, currentToken, documentData, signatureData: sigData } = await fetchDocumentRecord(documentId, accessToken, instanceUrl, clientId, clientSecret);

            console.log(`Fetched ContentVersion ID: ${contentVersionId}`);
            console.log(`Signature Data:`, sigData);

            // Store document record and signature data directly (no parsing needed)
            setDocumentRecord(documentData);
            const signatures = Array.isArray(sigData) ? sigData : [];
            setSignatureData(signatures);
            
            // Store initial signature data to detect changes later
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

    // Update Document__c record with signature data
    const updateDocumentRecord = async (documentId, signatureData, accessToken, instanceUrl, clientId = null, clientSecret = null) => {
        try {
            let currentToken = accessToken;

            // Salesforce REST API endpoint to update Document__c record
            const apiUrl = `${instanceUrl}/services/data/v65.0/sobjects/Document__c/${documentId}`;

            // Convert signature data to JSON string
            const signatureDataJson = JSON.stringify(signatureData);

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

        if (accessToken && recordId && instanceUrl) {
            // Store Salesforce config for later use
            setSalesforceConfig({ accessToken, recordId, instanceUrl, clientId, clientSecret });

            // Fetch Document__c record and then PDF
            fetchDocumentAndPdf(recordId, accessToken, instanceUrl, clientId, clientSecret);
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

    // Handle signature button click - will open signature modal
    const handleSignatureClick = (signature) => {
        console.log("Signature clicked:", signature);
        setCurrentSignature(signature);
        setIsModalOpen(true);
    };

    // Handle signature save from modal
    const handleSignatureSave = (imageData, signature) => {
        console.log("Signature saved:", signature.index);
        const updatedSignatures = updateSignatureWithImage(signatureData, signature.index, imageData);
        setSignatureData(updatedSignatures);

        // Track that this signature was signed in the current session
        setSessionSignedKeys((prev) => new Set(prev).add(signature.index));
    };

    // Handle modal close
    const handleModalClose = () => {
        setIsModalOpen(false);
        setCurrentSignature(null);
    };

    // Handle signature deletion
    const handleSignatureDelete = (signature) => {
        console.log("Delete signature:", signature);
        const updatedSignatures = deleteSignatureImage(signatureData, signature.index);
        setSignatureData(updatedSignatures);

        // Remove from session signed keys
        setSessionSignedKeys((prev) => {
            const newSet = new Set(prev);
            newSet.delete(signature.index);
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
                const filledFields = signatureData
                    .flatMap(sig => sig.fields || [])
                    .filter(field => field.filled && field.imageUrl);

                // Process each signature field
                for (const field of filledFields) {
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

                    // Update Document record with signature data
                    await updateDocumentRecord(salesforceConfig.recordId, signatureData, salesforceConfig.accessToken, salesforceConfig.instanceUrl, salesforceConfig.clientId, salesforceConfig.clientSecret);

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

    // Close toast
    const handleCloseToast = () => {
        setToast({ isVisible: false, message: "", type: "success" });
    };

    // Check if Save & Submit button should be shown
    const shouldShowSaveButton = () => {
        // If already submitted in this session, hide button
        if (isSubmitted) {
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
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [totalPages]);

    return (
        <div className="app">
            {loading && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p>Loading PDF from Salesforce...</p>
                    </div>
                </div>
            )}

            {error && !pdfFile && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p style={{ color: "#d32f2f" }}>The URL is not right. Please contact the owner or sender of this link.</p>
                    </div>
                </div>
            )}

            {pdfFile && (
                <>
                    <div className="pdf-container">
                        <div className="canvas-container">
                            {Array.from({ length: totalPages }, (_, index) => {
                                const pageNumber = index + 1;
                                return (
                                    <div key={index} className="page-wrapper">
                                        <div className="page-number">Page {pageNumber}</div>
                                        <div className="canvas-wrapper">
                                            <canvas ref={(el) => (canvasRefsArray.current[index] = el)}></canvas>
                                            {signatureData.length > 0 && <SignatureOverlay pageNumber={pageNumber} priority={urlPriority} signatures={signatureData} onSign={handleSignatureClick} onDelete={handleSignatureDelete} isSubmitted={isSubmitted} sessionSignedKeys={sessionSignedKeys} />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="bottom-bar">
                        <div className="bottom-bar-left">
                            <span className="total-pages-text">Total Pages: {totalPages}</span>
                        </div>
                        <div className="bottom-bar-right">
                            {shouldShowSaveButton() && (
                                <button className="save-submit-btn" onClick={handleSaveAndSubmit}>
                                    Save & Submit
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}

            {!pdfFile && !loading && !error && (
                <div className="placeholder">
                    <div className="placeholder-content">
                        <p>The URL is incorrect. Please contact the owner or sender of this link.</p>
                    </div>
                </div>
            )}

            <SignatureModal isOpen={isModalOpen} onClose={handleModalClose} onSave={handleSignatureSave} signature={currentSignature} title={currentSignature?.type === "text" ? "Enter Text" : currentSignature?.type === "initials" ? "Enter Initials" : "Create Signature"} />
            <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={handleCloseToast} />
        </div>
    );
}

export default App;
