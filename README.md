# Signature Anywhere - Insurance Medics

## Developer Guide

A Salesforce-integrated React application for multi-signer document workflows with PDF rendering, signature capture, and automated document processing.

---

## Table of Contents

1. [URL Parameters & Authentication Flow](#url-parameters--authentication-flow)
2. [Application Architecture](#application-architecture)
3. [Salesforce Integration](#salesforce-integration)
4. [Data Structure & State Management](#data-structure--state-management)
5. [PDF Rendering & Coordinate System](#pdf-rendering--coordinate-system)
6. [Cross-Tab/Cross-Window Synchronization](#cross-tabcross-window-synchronization)

---

## URL Parameters & Authentication Flow

### URL Parameter Schema

The application is launched via LWC application that construct URLs with encrypted query parameters. These parameters identify the user and document to be signed.

#### Required Parameters

```
https://app-url.com/?q=<base64_encoded_encrypted_params>
```

Or unencrypted (legacy):

```
https://app-url.com/?recordId=<id>&accessToken=<token>&instanceUrl=<url>&priority=<num>
```

#### Parameter Details

| Parameter      | Type    | Required | Description                                                  |
| -------------- | ------- | -------- | ------------------------------------------------------------ |
| `recordId`     | String  | Yes      | Salesforce `Document__c` record ID (18-char)                 |
| `accessToken`  | String  | Optional | Salesforce OAuth access token (session ID or JWT)            |
| `instanceUrl`  | String  | Yes      | Salesforce instance URL (e.g., `https://na1.salesforce.com`) |
| `priority`     | Integer | Yes      | Current signer's priority in signing order (1-based)         |
| `clientId`     | String  | Yes      | OAuth Connected App Client ID for token refresh              |
| `clientSecret` | String  | Yes      | OAuth Connected App Client Secret for token refresh          |
| `orgId`        | String  | Yes      | Salesforce Organization ID for audit trail                   |
| `localeKey`    | String  | Optional | User's locale (e.g., `en_US`) for date formatting            |
| `timeZoneKey`  | String  | Optional | User's timezone (e.g., `America/New_York`)                   |

### Encryption Flow

**Location**: [src/utils/encryption.js](src/utils/encryption.js)

```javascript
// Encryption (Apex side)
const encrypted = encryptUrlParams({
    recordId: "a015g00000XXXXX",
    accessToken: "00D5g000000...",
    instanceUrl: "https://na1.salesforce.com",
    priority: 1,
});
// URL: ?q=<base64_encrypted_data>

// Decryption (React app side)
const params = decryptUrlParams(encryptedString);
```

**Algorithm**: AES-256-CBC with PBKDF2 key derivation

-   **Key Derivation**: PBKDF2 with 100,000 iterations
-   **IV**: One hardcoded IV for simplicity (not ideal for production)
-   **Encoding**: Base64 URL-safe encoding for query params

### Authentication State Management

**Location**: [App.jsx](src/App.jsx) lines 57-64

```javascript
const [salesforceConfig, setSalesforceConfig] = useState(null);
// Structure:
{
  recordId: "a015g00000XXXXX",
  accessToken: "00D5g000000...",
  instanceUrl: "https://na1.salesforce.com",
  clientId: "3MVG9...",
  clientSecret: "1234567890..."
}
```

### Token Refresh Flow

**Location**: [App.jsx](src/App.jsx) lines ~130-180

When a Salesforce API call returns `401 Unauthorized`:

1. **Check for refresh credentials**: Verify `clientId` and `clientSecret` exist
2. **Request new token**: POST to `<instanceUrl>/services/oauth2/token`
3. **Update state**: Store new `accessToken` in `salesforceConfig`
4. **Retry original request**: Automatically retry the failed API call
5. **Fallback**: If refresh fails, show user-friendly error and reload page

```javascript
const refreshAccessToken = async () => {
    const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    const data = await response.json();
    return data.access_token;
};
```

### Initial Load Sequence

**Location**: [App.jsx](src/App.jsx) lines ~200-350

1. **Parse URL params**: Extract from `window.location.search`
2. **Decrypt if needed**: Call `decryptUrlParams()` if `encrypted` param exists
3. **Validate parameters**: Check all required params present
4. **Store in state**: Set `salesforceConfig`, `urlPriority`, etc.
5. **Fetch document**: Call `fetchDocumentAndPdf()`
6. **Check document status**: Validate not expired/rejected/completed
7. **Render PDF**: Initialize `pdfjs-dist` and render all pages
8. **Setup overlays**: Render signature/field buttons based on priority

---

## Application Architecture

### Component Hierarchy

```
App.jsx (Main Orchestrator)
├── PDF Rendering Layer
│   ├── Canvas elements (one per page)
│   └── Preview thumbnails (desktop only)
│
├── Overlay Layer (per-page)
│   ├── SignatureOverlay.jsx
│   │   └── Multiple SignatureButton.jsx components
│   └── FieldOverlay.jsx (legacy, being phased out)
│       └── Multiple FieldButton.jsx components
│
├── Modal Layer
│   ├── SignatureModal.jsx
│   │   ├── DrawSignature.jsx (Tab 1)
│   │   └── TypeSignature.jsx (Tab 2)
│   └── FieldModal.jsx
│
├── Status Layer
│   └── Toast.jsx (notifications)
│
└── Routes
    ├── ThankYou.jsx (success page)
    ├── Rejected.jsx (rejection page)
    └── NotFound.jsx (404 page)
```

### State Management

**Location**: [App.jsx](src/App.jsx) lines 27-91

#### Core State Categories

**1. App State**

```javascript
const [showSpinner, setShowSpinner] = useState(false); // Loading overlay
const [loading, setLoading] = useState(false); // General loading
const [error, setError] = useState(null); // Error messages
const [toast, setToast] = useState({
    // Toast notifications
    isVisible: false,
    message: "",
    type: "success",
});
```

**2. Document Status Flags**

```javascript
const [isInactive, setIsInactive] = useState(false); // Status__c != "Pending"
const [isExpired, setIsExpired] = useState(false); // Past Expiration_Date__c
const [isRejectedSimultaneous, setIsRejectedSimultaneous] = useState(false);
const [isSubmitted, setIsSubmitted] = useState(false); // Already signed by current user
```

**3. PDF Properties**

```javascript
const [pdfFile, setPdfFile] = useState(null); // PDFDocumentProxy from pdfjs
const [originalPdfBytes, setOriginalPdfBytes] = useState(null); // ArrayBuffer
const [totalPages, setTotalPages] = useState(0);
const [pdfPageFormat, setPdfPageFormat] = useState({
    // A4 default
    width: 595,
    height: 842,
    orientation: "portrait",
});
const [canvasScale, setCanvasScale] = useState(1); // Dynamic scale factor
```

**4. Document Data**

```javascript
const [documentRecord, setDocumentRecord] = useState(null); // Full Document__c record
const [signatureData, setSignatureData] = useState([]); // Nested priority structure
const [initialSignatureData, setInitialSignatureData] = useState([]); // For change detection
const [fieldData, setFieldData] = useState([]); // Legacy flat fields
```

**5. Session Tracking**

```javascript
const [sessionSignedKeys, setSessionSignedKeys] = useState(new Set());
const [sessionFilledKeys, setSessionFilledKeys] = useState(new Set());
// Tracks which fields were signed/filled in current session (not just loaded from Salesforce)
// Used to show delete buttons only for newly-signed items
```

**6. User Context**

```javascript
const [userIpAddress, setUserIpAddress] = useState(null);
const [userLocation, setUserLocation] = useState(null);
const [userDeviceUniqueKey, setUserDeviceUniqueKey] = useState(null);
```

### Ref Management

```javascript
const canvasRefsArray = useRef([]); // Array of canvas refs for each PDF page
const pdfDocRef = useRef(null); // PDFDocument instance from pdf-lib
const resizeTimeoutRef = useRef(null); // Debounce timer for window resize
const broadcastChannelRef = useRef(null); // Cross-tab communication channel
```

### Data Flow Diagram

```
URL Params → Decrypt → Parse
                ↓
        Fetch Document__c
                ↓
    Extract Signing_Details__c JSON
                ↓
    Parse nested priority structure
                ↓
        Fetch PDF ContentVersion
                ↓
    Render with pdfjs-dist (canvas)
                ↓
    Render overlay buttons (filtered by priority)
                ↓
    User signs/fills → Update state
                ↓
    Merge signatures with pdf-lib
                ↓
    Upload signed PDF to Salesforce
                ↓
    Update Document__c.Signing_Details__c
                ↓
    Create Signature__c audit records
                ↓
    Navigate to ThankYou page
```

---

## Salesforce Integration

### Salesforce Object Model

#### Document\_\_c (Custom Object)

**Purpose**: Parent record storing document metadata and signing details

**Key Fields**:

```
Document__c
├── Id (Primary Key)
├── Name (Document title)
├── Signing_Details__c (Long Text, JSON structure)
├── Uploaded_Document_Id__c (Lookup to ContentVersion)
├── Status__c (Picklist: "Pending", "Completed", "Rejected", "Expired")
├── Expiration_Date__c (DateTime)
├── Created_Date__c (DateTime)
├── Allow_Rejection__c (Checkbox)
└── Rejection_Reason__c (Long Text)
```

**Signing_Details\_\_c JSON Structure**:

```json
[
    {
        "priority": 1,
        "email": "signer1@example.com",
        "name": "First Signer",
        "fields": [
            {
                "index": 0,
                "type": "signature",
                "pageNumber": 1,
                "xPercent": 10.5,
                "yPercent": 20.3,
                "widthPercent": 15.0,
                "heightPercent": 5.0,
                "signed": true,
                "imageUrl": "data:image/png;base64,...",
                "timestamp": "2026-01-05T10:30:00Z",
                "ipAddress": "192.168.1.1",
                "location": "San Francisco, CA",
                "device": "Chrome 120 on Windows 10"
            }
        ]
    }
]
```

#### ContentVersion (Standard Object)

**Purpose**: Stores PDF binary data

**Key Fields**:

```
ContentVersion
├── Id
├── ContentDocumentId (Links to ContentDocument)
├── VersionData (Blob - PDF binary)
├── Title (Filename)
├── PathOnClient (Original filename)
└── FileType (e.g., "PDF")
```

#### Signature\_\_c (Custom Object)

**Purpose**: Child audit records for each individual signature

**Key Fields**:

```
Signature__c
├── Id
├── Document__c (Master-Detail to Document__c)
├── Field_Index__c (Number - matches index in Signing_Details__c)
├── Signer_Email__c (Email)
├── Signer_Name__c (Text)
├── Signature_Image__c (Long Text - base64 data URL)
├── Signing_Details__c (Long Text - JSON metadata)
├── Timestamp__c (DateTime)
├── IP_Address__c (Text)
├── Location__c (Text)
└── Device__c (Text)
```

### API Endpoints

All Salesforce API calls use REST API with OAuth authentication.

#### 1. Fetch Document Record

**Location**: [App.jsx](src/App.jsx) lines ~400-450

```javascript
const fetchDocumentRecord = async (recordId, accessToken, instanceUrl) => {
    const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/Document__c/${recordId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
    });
    return await response.json();
};
```

**Returns**:

```json
{
    "Id": "a015g00000XXXXX",
    "Name": "Employment Contract",
    "Signing_Details__c": "[{\"priority\":1,...}]",
    "Uploaded_Document_Id__c": "0685g00000YYYYY",
    "Status__c": "Pending",
    "Expiration_Date__c": "2026-01-10T23:59:59Z",
    "Allow_Rejection__c": true
}
```

#### 2. Fetch PDF ContentVersion

**Location**: [App.jsx](src/App.jsx) lines ~450-500

```javascript
const fetchPdfContent = async (contentVersionId, accessToken, instanceUrl) => {
    const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/ContentVersion/${contentVersionId}/VersionData`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    return await response.arrayBuffer(); // PDF binary
};
```

#### 3. Upload Signed PDF

**Location**: [App.jsx](src/App.jsx) lines ~1500-1600

**Step 1**: Create ContentVersion with PDF binary

```javascript
const uploadSignedPdf = async (pdfBytes, recordId, accessToken, instanceUrl) => {
    // Convert PDF bytes to base64
    const base64Pdf = Buffer.from(pdfBytes).toString("base64");

    const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/ContentVersion`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            Title: `Signed_Document_${Date.now()}`,
            PathOnClient: "signed_document.pdf",
            VersionData: base64Pdf,
            FirstPublishLocationId: recordId, // Link to Document__c
        }),
    });
    return await response.json();
};
```

**Step 2**: Update Document\_\_c with new ContentVersion ID

```javascript
await fetch(`${instanceUrl}/services/data/v60.0/sobjects/Document__c/${recordId}`, {
    method: "PATCH",
    headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        Uploaded_Document_Id__c: newContentVersionId,
        Signing_Details__c: JSON.stringify(updatedSignatureData),
    }),
});
```

#### 4. Update Document Status

**Location**: [App.jsx](src/App.jsx) lines ~1700-1750

```javascript
const updateDocumentStatus = async (recordId, status, accessToken, instanceUrl) => {
    await fetch(`${instanceUrl}/services/data/v60.0/sobjects/Document__c/${recordId}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            Status__c: status, // "Completed", "Rejected", etc.
        }),
    });
};
```

#### 5. Create Signature Audit Records

**Location**: [App.jsx](src/App.jsx) lines ~1800-1900

```javascript
const createSignatureRecords = async (documentId, signatureData, accessToken, instanceUrl) => {
    const records = signatureData
        .filter((sig) => sig.signed && sig.imageUrl)
        .map((sig) => ({
            Document__c: documentId,
            Field_Index__c: sig.index,
            Signer_Email__c: sig.email,
            Signer_Name__c: sig.name,
            Signature_Image__c: sig.imageUrl,
            Signing_Details__c: JSON.stringify({
                timestamp: sig.timestamp,
                ipAddress: sig.ipAddress,
                location: sig.location,
                device: sig.device,
            }),
        }));

    // Bulk create using Composite API
    await fetch(`${instanceUrl}/services/data/v60.0/composite/sobjects`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            allOrNone: false,
            records: records.map((r) => ({
                attributes: { type: "Signature__c" },
                ...r,
            })),
        }),
    });
};
```

### Error Handling

All Salesforce API calls implement user-friendly error handling:

**Location**: [App.jsx](src/App.jsx) lines ~130-150

```javascript
const makeSalesforceRequest = async (fetchFn) => {
    try {
        const response = await fetchFn();

        if (response.status === 401) {
            // Token expired - attempt refresh
            const newToken = await refreshAccessToken();
            setSalesforceConfig((prev) => ({ ...prev, accessToken: newToken }));
            // Retry request
            return await fetchFn();
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    } catch (error) {
        console.error("Salesforce API Error:", error);
        setToast({
            isVisible: true,
            message: "Failed to communicate with Salesforce. Please try again.",
            type: "error",
        });
        throw error;
    }
};
```

---

## Data Structure & State Management

### Priority-Based Nested Structure

**Critical Pattern**: The application uses a priority-based nested structure for multi-signer workflows. This is the core data model that drives the entire signing process.

#### Structure Schema

```typescript
type SignatureData = Array<{
    priority: number; // Signing order (1-based)
    email: string; // Signer's email
    name: string; // Signer's full name
    accepted?: boolean; // Whether signer accepted T&C
    fields: Array<{
        index: number; // Field identifier (may repeat across signers)
        type: "signature" | "initials" | "text" | "date" | "number" | "email" | "checkbox";
        pageNumber: number; // PDF page (1-based)
        xPercent: number; // X position as % of page width
        yPercent: number; // Y position as % of page height
        widthPercent: number; // Width as % of page width
        heightPercent: number; // Height as % of page height
        signed?: boolean; // For signatures/initials
        imageUrl?: string; // Base64 data URL for signatures
        filled?: boolean; // For other field types
        value?: any; // Field value (text, date, number, etc.)
        timestamp?: string; // ISO 8601 datetime
        ipAddress?: string; // Signer's IP
        location?: string; // GPS + reverse geocoded address
        device?: string; // Parsed user agent
        _parentSigner?: object; // Internal reference to parent signer object
    }>;
}>;
```

#### Example

```json
[
    {
        "priority": 1,
        "email": "employee@company.com",
        "name": "John Doe",
        "accepted": true,
        "fields": [
            {
                "index": 0,
                "type": "signature",
                "pageNumber": 1,
                "xPercent": 10.5,
                "yPercent": 80.2,
                "widthPercent": 20.0,
                "heightPercent": 8.0,
                "signed": true,
                "imageUrl": "data:image/png;base64,iVBORw0KG...",
                "timestamp": "2026-01-05T14:30:00Z",
                "ipAddress": "192.168.1.100",
                "location": "San Francisco, CA, USA",
                "device": "Chrome 120 on Windows 10"
            },
            {
                "index": 1,
                "type": "text",
                "pageNumber": 1,
                "xPercent": 50.0,
                "yPercent": 30.0,
                "widthPercent": 30.0,
                "heightPercent": 5.0,
                "filled": true,
                "value": "Software Engineer"
            },
            {
                "index": 2,
                "type": "date",
                "pageNumber": 2,
                "xPercent": 10.0,
                "yPercent": 90.0,
                "widthPercent": 15.0,
                "heightPercent": 4.0,
                "filled": true,
                "value": "01/05/2026"
            }
        ]
    },
    {
        "priority": 2,
        "email": "hr@company.com",
        "name": "Jane Smith",
        "fields": [
            {
                "index": 0,
                "type": "signature",
                "pageNumber": 1,
                "xPercent": 10.5,
                "yPercent": 90.0,
                "widthPercent": 20.0,
                "heightPercent": 8.0,
                "signed": false
            }
        ]
    }
]
```

### Legacy Flat Structure (Backward Compatibility)

**Location**: [App.jsx](src/App.jsx) lines ~175-190

The app also supports legacy flat structures without the `fields` array:

```json
[
    {
        "index": 0,
        "type": "signature",
        "pageNumber": 1,
        "xPercent": 10.5,
        "yPercent": 80.2,
        "widthPercent": 20.0,
        "heightPercent": 8.0,
        "signed": false,
        "priority": 1,
        "email": "signer@example.com"
    }
]
```

**Detection**: Check for `entry.fields` array to determine structure type.

### Priority-Based Visibility

**Location**: [SignatureOverlay.jsx](src/components/SignatureOverlay.jsx) lines 28-47

Users only see fields based on their priority:

1. **Current priority fields** (editable): All fields where `priority === urlPriority`
2. **Lower priority filled fields** (read-only): Fields where `priority < urlPriority` AND `signed: true` or `filled: true`
3. **Never show higher priority fields**: Fields where `priority > urlPriority` (prevents out-of-order signing)

```javascript
const getVisibleFields = (signatureData, currentPriority) => {
    return signatureData.filter((signer) => {
        if (signer.priority === currentPriority) {
            // Show all fields for current signer (editable)
            return true;
        } else if (signer.priority < currentPriority) {
            // Show only filled/signed fields from previous signers (read-only)
            return signer.fields.some((f) => f.signed || f.filled);
        }
        // Hide future signers' fields
        return false;
    });
};
```

### Index Uniqueness

**Critical**: Field `index` values may repeat across different signers. To uniquely identify a field, use:

```javascript
const uniqueKey = `${priority}-${index}-${type}`;
// Example: "1-0-signature", "2-0-signature"
```

This is why `signerObject` must be passed to update functions in `signatureUtils.js`.

---

## PDF Rendering & Coordinate System

### PDF Libraries

**1. pdfjs-dist** (Rendering)

-   **Purpose**: Render PDF pages to HTML5 Canvas
-   **Version**: 5.4.394
-   **Worker**: [src/pdfjs/pdf.worker.min.mjs](src/pdfjs/pdf.worker.min.mjs)
-   **Usage**: Initial document display, page thumbnails

**2. pdf-lib** (Manipulation)

-   **Purpose**: Modify PDF (embed signatures, merge fields)
-   **Version**: 1.17.1
-   **Usage**: Final step before upload to Salesforce

### Coordinate Systems

#### 1. PDF Internal Coordinates

**Units**: Points (1/72 inch)
**Origin**: Bottom-left corner
**A4 Dimensions**: 595 × 842 points

```javascript
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
```

#### 2. Canvas Rendering Coordinates

**Units**: Pixels
**Origin**: Top-left corner
**Dimensions**: Dynamic based on viewport

**Scale Calculation**: [App.jsx](src/App.jsx) lines ~600-650

```javascript
const calculateScale = () => {
    const canvasWidth = 800; // Fixed width for main canvas
    const scale = canvasWidth / pdfPageFormat.width;
    setCanvasScale(scale);
    return scale;
};

// Render page with scale
page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: canvasScale }),
});
```

#### 3. Overlay Button Coordinates

**Units**: Percentages (0-100)
**Origin**: Top-left corner (matches canvas)
**Storage**: `xPercent`, `yPercent`, `widthPercent`, `heightPercent`

**Positioning**: [SignatureButton.jsx](src/components/SignatureButton.jsx) lines ~80-100

```javascript
const buttonStyle = {
    position: "absolute",
    left: `${xPercent}%`,
    top: `${yPercent}%`,
    width: `${widthPercent}%`,
    height: `${heightPercent}%`,
};
```

**Benefits**:

-   Responsive: Works across all screen sizes
-   DPI-independent: No hardcoded pixel values
-   PDF-agnostic: Works with any page size

### Coordinate Conversion

#### Canvas to PDF (for merging signatures)

**Location**: [App.jsx](src/App.jsx) lines ~1200-1300

```javascript
const convertPercentToPdfCoords = (xPercent, yPercent, widthPercent, heightPercent, pageFormat) => {
    const x = (xPercent / 100) * pageFormat.width;
    const y = pageFormat.height - (yPercent / 100) * pageFormat.height - (heightPercent / 100) * pageFormat.height;
    // ↑ Y-axis flip: Canvas (top-origin) → PDF (bottom-origin)

    const width = (widthPercent / 100) * pageFormat.width;
    const height = (heightPercent / 100) * pageFormat.height;

    return { x, y, width, height };
};
```

**Key Point**: Y-axis flip is critical because:

-   Canvas: Y increases downward (top-left origin)
-   PDF: Y increases upward (bottom-left origin)

### PDF Rendering Flow

**Location**: [App.jsx](src/App.jsx) lines ~700-900

```javascript
const renderAllPages = async (pdfDocument) => {
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const canvas = canvasRefsArray.current[pageNum - 1];
        const ctx = canvas.getContext("2d");

        const viewport = page.getViewport({ scale: canvasScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: ctx,
            viewport: viewport,
        }).promise;
    }
};
```

### PDF Merge Flow

**Location**: [App.jsx](src/App.jsx) lines ~1200-1500

```javascript
const mergePdfWithSignatures = async (originalBytes, signatureData) => {
    // 1. Load PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();

    // 2. Iterate through all signed/filled fields
    for (const signer of signatureData) {
        for (const field of signer.fields) {
            if (!field.signed && !field.filled) continue;

            const page = pages[field.pageNumber - 1];
            const { x, y, width, height } = convertPercentToPdfCoords(field.xPercent, field.yPercent, field.widthPercent, field.heightPercent, pdfPageFormat);

            if (field.type === "signature" || field.type === "initials") {
                // 3a. Embed signature image
                const imageBytes = await fetch(field.imageUrl).then((r) => r.arrayBuffer());
                const image = await pdfDoc.embedPng(imageBytes);
                page.drawImage(image, { x, y, width, height });
            } else if (field.type === "text" || field.type === "email") {
                // 3b. Draw text field value
                const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                page.drawText(field.value, {
                    x,
                    y: y + height / 2, // Center vertically
                    size: 12,
                    font,
                    color: rgb(0, 0, 0),
                });
            } else if (field.type === "date") {
                // 3c. Draw formatted date
                const dateStr = formatDate(field.value, localeKey);
                page.drawText(dateStr, { x, y, size: 12 });
            } else if (field.type === "checkbox") {
                // 3d. Draw checkbox
                if (field.value) {
                    page.drawRectangle({
                        x,
                        y,
                        width: height, // Square
                        height,
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 2,
                    });
                    page.drawText("✓", {
                        x: x + 2,
                        y: y + 2,
                        size: height - 4,
                    });
                }
            }
        }
    }

    // 4. Save modified PDF
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
};
```

### ArrayBuffer Consumption Issue

**Location**: [App.jsx](src/App.jsx) lines ~292

**Problem**: `pdfjs-dist` consumes/detaches the ArrayBuffer, making it unusable for `pdf-lib`.

**Solution**: Create a copy before passing to `pdfjs`:

```javascript
const fetchPdfContent = async (contentVersionId) => {
    const arrayBuffer = await response.arrayBuffer();

    // Store original for pdf-lib
    setOriginalPdfBytes(arrayBuffer);

    // Create copy for pdfjs (will be consumed)
    const pdfBytesCopy = arrayBuffer.slice(0);
    const pdfDocument = await pdfjsLib.getDocument(pdfBytesCopy).promise;
    setPdfFile(pdfDocument);
};
```

---

## Cross-Tab/Cross-Window Synchronization

### Challenge

Multiple scenarios where duplicate submissions can occur:

1. **Same browser, multiple tabs**: User opens document in two tabs, signs in both
2. **Different browsers**: User opens in Chrome and Firefox simultaneously
3. **Different devices**: User starts signing on phone, continues on desktop
4. **Network delays**: User clicks submit multiple times due to slow response

### Solution 1: BroadcastChannel API (Same-Origin Tabs)

**Location**: [App.jsx](src/App.jsx) lines ~100-120

**Purpose**: Synchronize state across tabs opened in the same browser window

```javascript
useEffect(() => {
    const currentUrl = window.location.href;
    const channelName = `document-sync-${btoa(currentUrl).replace(/=/g, "")}`;

    if (typeof BroadcastChannel !== "undefined") {
        broadcastChannelRef.current = new BroadcastChannel(channelName);

        // Listen for messages from other tabs
        broadcastChannelRef.current.onmessage = (event) => {
            if (event.data.type === "DOCUMENT_SUBMITTED") {
                setToast({
                    isVisible: true,
                    message: "Document was submitted in another tab. Refreshing...",
                    type: "info",
                });
                setTimeout(() => window.location.reload(), 1500);
            }
        };
    }

    return () => {
        if (broadcastChannelRef.current) {
            broadcastChannelRef.current.close();
        }
    };
}, []);
```

**Flow**:

1. User submits in Tab A
2. Tab A broadcasts `DOCUMENT_SUBMITTED` message
3. Tab B receives message
4. Tab B shows toast: "Document was submitted in another tab. Refreshing..."
5. Tab B reloads after 1.5 seconds
6. Tab B now shows updated state (already submitted)

**Limitations**:

-   Only works for tabs within same browser/origin
-   Does not work across different browsers/devices
-   No polling overhead (event-driven)

### Solution 2: Pre-Submission Check (All Cases)

**Location**: [App.jsx](src/App.jsx) lines ~2000-2100

**Purpose**: Prevent duplicate submissions from any source (different browsers, devices, windows)

```javascript
const handleSaveAndSubmit = async () => {
    // 1. PRE-SUBMISSION CHECK: Query Salesforce before processing
    try {
        const currentDoc = await fetchDocumentRecord(salesforceConfig.recordId, salesforceConfig.accessToken, salesforceConfig.instanceUrl);

        const currentSigningDetails = JSON.parse(currentDoc.Signing_Details__c || "[]");

        // 2. Check if current user's priority already has all fields filled
        const currentUserSigner = currentSigningDetails.find((s) => s.priority === urlPriority);
        if (currentUserSigner) {
            const allFieldsFilled = currentUserSigner.fields.every((f) => {
                if (f.type === "signature" || f.type === "initials") {
                    return f.signed === true;
                } else {
                    return f.filled === true;
                }
            });

            if (allFieldsFilled) {
                // 3. Already submitted - show toast and reload
                setToast({
                    isVisible: true,
                    message: "This document was already submitted. Refreshing...",
                    type: "info",
                });
                setTimeout(() => window.location.reload(), 1500);
                return; // Stop submission process
            }
        }
    } catch (error) {
        console.error("Pre-submission check failed:", error);
        // Continue with submission if check fails (graceful fallback)
    }

    // 4. Proceed with normal submission if check passed
    await generateAndUploadPdf();
};
```

**Benefits**:

-   Works across all browsers/devices/windows
-   No polling overhead (only checks on submit button click)
-   Graceful fallback: proceeds with submission if check fails
-   Source of truth: Salesforce database state
-   User-friendly error messages instead of technical errors

### Combined Strategy

| Scenario                            | Solution             | Trigger      |
| ----------------------------------- | -------------------- | ------------ |
| Same browser, Tab A submits first   | BroadcastChannel     | Event-driven |
| Same browser, Tab B tries to submit | Pre-submission check | Button click |
| Different browser/device            | Pre-submission check | Button click |
| Network delay, double-click         | Pre-submission check | Button click |

### Error Messages (User-Friendly)

**Location**: [App.jsx](src/App.jsx) lines ~140-160

All technical errors replaced with clear messages:

```javascript
// Before
throw new Error("Failed to upload ContentVersion: 500 Internal Server Error");

// After
setToast({
    isVisible: true,
    message: "Failed to upload the signed document. Please try again.",
    type: "error",
});
```

**Categories**:

-   Document fetching: "Unable to load the document. Please refresh the page."
-   PDF loading: "Failed to load the PDF. The file may be corrupted."
-   Upload errors: "Failed to upload the signed document. Please try again."
-   Token refresh: "Your session has expired. Please reload the page."
-   Network errors: "Network error. Please check your connection and try again."

---

## Developer Setup

### Prerequisites

-   Node.js 18+ and npm
-   Salesforce Developer/Sandbox org with custom objects deployed
-   OAuth Connected App configured (for token refresh)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd signature-anywhere-insurance-medics

# Install dependencies
npm install

# Start development server
npm run dev
```

### Development Commands

```bash
npm run dev      # Vite dev server at http://localhost:5173
npm run build    # Production build to dist/
npm run preview  # Preview production build
npm run lint     # ESLint static analysis
```

### Testing with Salesforce

**1. Deploy Visualforce Pages**

Deploy [src/vfpages/SignatureDocumentPage.page](src/vfpages/SignatureDocumentPage.page) and [SignaturePage.page](src/vfpages/SignaturePage.page) to your Salesforce org.

**2. Create Test Document**

```apex
Document__c doc = new Document__c(
    Name = 'Test Employment Contract',
    Status__c = 'Pending',
    Expiration_Date__c = Date.today().addDays(30),
    Allow_Rejection__c = true,
    Signing_Details__c = '[{"priority":1,"email":"test@example.com","name":"Test Signer","fields":[{"index":0,"type":"signature","pageNumber":1,"xPercent":10,"yPercent":80,"widthPercent":20,"heightPercent":8}]}]'
);
insert doc;
```

**3. Upload PDF**

```apex
ContentVersion cv = new ContentVersion(
    Title = 'Employment_Contract.pdf',
    PathOnClient = 'Employment_Contract.pdf',
    VersionData = Blob.valueOf('%PDF-1.4...'), // PDF binary
    FirstPublishLocationId = doc.Id
);
insert cv;

doc.Uploaded_Document_Id__c = cv.Id;
update doc;
```

**4. Access via Visualforce**

```
https://your-instance.salesforce.com/apex/SignatureDocumentPage?id=<Document__c Id>&priority=1
```

### Local Development (Without Salesforce)

**Mock Data**: [src/utils/sampleSignatureData.js](src/utils/sampleSignatureData.js)

```javascript
// In App.jsx, comment out Salesforce fetch
useEffect(() => {
    // Disable Salesforce API
    // fetchDocumentAndPdf();

    // Use mock data instead
    setSignatureData(sampleSignatureData);
    setFieldData(sampleFieldData);

    // Load local PDF for testing
    fetch("/sample.pdf")
        .then((r) => r.arrayBuffer())
        .then(renderPdf);
}, []);
```

---

**End of Part 1**

This completes the first part of the developer guide covering:
✅ URL Parameters & Authentication Flow
✅ Application Architecture
✅ Salesforce Integration
✅ Data Structure & State Management
✅ PDF Rendering & Coordinate System
✅ Cross-Tab/Cross-Window Synchronization

**Please prompt me to generate Part 2**, which will cover:

-   All Components (detailed breakdown)
-   Pages (ThankYou, Rejected, NotFound)
-   Libraries and Dependencies
-   Utilities (signatureUtils, auditReport, encryption)
-   Edge Cases & Debugging Tips

---

## Part 2: Components, Pages, Libraries & Utilities

---

## Components Deep Dive

### SignatureButton Component

**File**: [src/components/SignatureButton.jsx](src/components/SignatureButton.jsx)  
**Purpose**: Renders signature/initials buttons or displays existing signature images  
**Dependencies**: SignatureButton.css

#### Props

```typescript
interface SignatureButtonProps {
    signature: {
        key: string; // Unique identifier
        buttonName: string; // Button label ("Sign Here", "Enter Initials")
        signed: boolean; // Legacy: whether signature exists
        filled: boolean; // Nested: whether field is completed
        imageUrl: string; // Base64 data URL of signature image
        disabled: boolean; // Read-only state
        timeStamp: string; // Signature timestamp
        timestamp: string; // Alternative timestamp field
        _parentSigner: {
            // Reference to parent signer object
            name: string;
            priority: number;
        };
    };
    onSign: (signature) => void; // Callback to open signature modal
    onDelete: (signature) => void; // Callback to delete signature
    canDelete: boolean; // Show delete button
    canvasScale: number; // Scale factor for responsive sizing
    hasStoredSignature: boolean; // Whether stored signature exists
    onReuseSignature: (signature) => void; // Callback to reuse stored signature
}
```

#### Rendering Logic

**State 1: Empty Signature (No Stored Signature)**

```jsx
<button className="signature-button">Sign Here</button>
```

**State 2: Empty Signature (With Stored Signature)**

```jsx
<div className="signature-button-split-container">
  <button className="signature-button-reuse">
    Sign Here
  </button>
  <button className="signature-button-new">
    <svg><!-- Pen icon --></svg>
  </button>
</div>
```

-   Left button: Reuses stored signature
-   Right button: Opens modal to create new signature

**State 3: Completed Signature**

```jsx
<div className="signature-image-container">
  <img src={imageUrl} alt="Signature" />
  {canDelete && <button className="signature-delete-btn">×</button>}
</div>
<div className="signature-footer">
  <span>{signerName}</span> | <span>{timestamp}</span>
</div>
```

#### Responsive Sizing

All dimensions scale with `canvasScale`:

-   Delete button: `24 * canvasScale`px
-   Font size: `14 * canvasScale`px
-   Border width: `2 * canvasScale`px
-   Footer font: `9.85 * canvasScale + 0.52`px

**Usage Example**:

```jsx
<SignatureButton
    signature={{
        key: "1-0-signature",
        buttonName: "Sign Here",
        filled: false,
        disabled: false,
    }}
    onSign={handleOpenModal}
    canvasScale={1.2}
    hasStoredSignature={true}
    onReuseSignature={handleReuse}
/>
```

---

### SignatureModal Component

**File**: [src/components/SignatureModal.jsx](src/components/SignatureModal.jsx)  
**Purpose**: Tabbed modal for capturing signatures via Draw or Type  
**Dependencies**: SignatureModal.css, DrawSignature.jsx, TypeSignature.jsx

#### Props

```typescript
interface SignatureModalProps {
    isOpen: boolean; // Modal visibility
    onClose: () => void; // Close callback
    onSave: (base64Image, signature, activeTab) => void; // Save callback
    signature: {
        widthPercent: number; // Signature box width
        heightPercent: number; // Signature box height
    };
    title: string; // Modal title (default: "Create Signature")
    adminProperties: {
        // Admin configuration
        Hide_Pen_And_Erase__c: boolean;
        Hide_Undo_Redo__c: boolean;
        Hide_Brush_Size__c: boolean;
        Default_Brush_Size__c: number;
        Hide_Available_Fonts__c: boolean;
        Hide_Bold_Option__c: boolean;
        Hide_Italic_Option__c: boolean;
        Hide_Font_Size_Option__c: boolean;
        Default_Font_Size__c: number;
        Default_Font_Style__c: string;
        Available_Fonts__c: string; // Comma-separated font list
    };
    pdfPageFormat: {
        width: number; // PDF page width (595 for A4)
        height: number; // PDF page height (842 for A4)
    };
}
```

#### Canvas Sizing Logic

**Dynamic Sizing Based on Aspect Ratio**:

```javascript
const THRESHOLD_RATIO = 1.6594202899;
const MAX_WIDTH = 453;
const MAX_HEIGHT = 274;

// Calculate signature aspect ratio accounting for page dimensions
const pageAspectRatio = pdfPageFormat.width / pdfPageFormat.height;
const signatureAspectRatio = (widthPercent / heightPercent) * pageAspectRatio;

if (signatureAspectRatio > THRESHOLD_RATIO) {
    // Wide box: fix width, calculate height
    canvasWidth = MAX_WIDTH;
    canvasHeight = MAX_WIDTH / signatureAspectRatio;
} else {
    // Tall box: fix height, calculate width
    canvasHeight = MAX_HEIGHT;
    canvasWidth = MAX_HEIGHT * signatureAspectRatio;
}
```

**Why This Matters**: Ensures signature canvas matches the aspect ratio of the target signature box on the PDF.

#### Tab Management

```javascript
const TABS = {
    DRAW: "draw",
    TYPE: "type",
};

const [activeTab, setActiveTab] = useState(TABS.TYPE); // Default to Type
```

#### Modal Actions

**Save**:

1. Check if `signatureData` exists (signature was drawn/typed)
2. Call `onSave(signatureData, signature, activeTab)`
3. Reset state and close modal

**Clear**:

1. Set `signatureData` to `null`
2. Increment `clearTrigger` (triggers child component clear)

**Close**:

1. Reset all state (data, tab, clearTrigger)
2. Call `onClose()`

---

### SignatureOverlay Component

**File**: [src/components/SignatureOverlay.jsx](src/components/SignatureOverlay.jsx)  
**Purpose**: Renders all signature/field buttons overlaid on a specific PDF page  
**Dependencies**: SignatureButton.jsx, FieldButton.jsx, SignatureOverlay.css

#### Props

```typescript
interface SignatureOverlayProps {
    pageNumber: number; // Current PDF page (1-indexed)
    priority: number; // Current user's priority
    signatures: Array<{
        // Nested signature data
        priority: number;
        fields: Array<{
            index: number;
            type: string;
            pageNumber: number;
            xPercent: number;
            yPercent: number;
            widthPercent: number;
            heightPercent: number;
            filled: boolean;
            value: any;
        }>;
    }>;
    onSign: (field) => void; // Open signature modal
    onFieldClick: (field) => void; // Open field modal
    onFieldSave: (field, value) => void; // Save inline field edit
    onDelete: (field) => void; // Delete signature
    onFieldDelete: (field) => void; // Delete field value
    isSubmitted: boolean; // Document submitted flag
    sessionSignedKeys: Set<number>; // Keys signed in session
    sessionFilledKeys: Set<number>; // Keys filled in session
    canvasScale: number; // Responsive scale factor
    storedSignature: {
        // Cached signature data
        signBase64: string;
        arrStored: number[];
    };
    storedInitials: {
        // Cached initials data
        signBase64: string;
        arrStored: number[];
    };
    onReuseSignature: (field) => void; // Reuse stored signature
    sendEmailsSimultaneously: boolean; // Simultaneous signing mode
}
```

#### Field Filtering Logic

**Sequential Mode** (`sendEmailsSimultaneously: false`):

-   **Show current priority fields**: All fields where `priority === urlPriority`
-   **Show lower priority filled fields**: Fields where `priority < urlPriority` AND `filled === true`
-   **Hide higher priority fields**: Never show `priority > urlPriority`

**Simultaneous Mode** (`sendEmailsSimultaneously: true`):

-   **Show current priority fields**: All fields where `priority === urlPriority`
-   **Show all filled fields**: Any field where `filled === true` regardless of priority

```javascript
const pageSignatures = signatures.filter((sig) => {
    const isCurrentPriority = sig.priority == priority;
    const isLowerPriority = sig.priority < priority;
    const isHigherPriority = sig.priority > priority;

    if (sendEmailsSimultaneously) {
        // Show all priorities' fields that match page number
        return sig?.fields?.some((field) => {
            if (field.pageNumber !== pageNumber) return false;
            if (isCurrentPriority) return true;
            return (isLowerPriority || isHigherPriority) && field.filled;
        });
    }

    // Sequential: don't show higher priority
    if (!isCurrentPriority && !isLowerPriority) return false;

    return sig?.fields?.some((field) => {
        if (field.pageNumber !== pageNumber) return false;
        if (isCurrentPriority) return true;
        return isLowerPriority && field.filled;
    });
});
```

#### Unique Key Generation

**Problem**: Multiple signers can have fields with the same `index` value.

**Solution**: Combine priority + index + type

```javascript
const uniqueKey = `${parentPriority}-${field.index}-${fieldType}`;
// Examples: "1-0-signature", "2-0-signature", "1-1-text"
```

#### Delete Button Logic

Show delete button only if:

1. Field belongs to current priority (`parentPriority == priority`)
2. Was signed/filled in current session (`sessionSignedKeys.has(index)`)
3. Document not yet submitted (`!isSubmitted`)

```javascript
const canDelete = !isSubmitted && isCurrentPriorityField && (isSignatureField ? sessionSignedKeys.has(field.index) : sessionFilledKeys?.has(field.index));
```

---

### FieldButton Component

**File**: [src/components/FieldButton.jsx](src/components/FieldButton.jsx)  
**Purpose**: Renders text/date/number/email/checkbox field buttons or displays filled values with inline editing  
**Dependencies**: FieldButton.css

#### Props

```typescript
interface FieldButtonProps {
    field: {
        key: string;
        fieldName: string;
        fieldType: "text" | "date" | "number" | "email" | "checkbox";
        value: any;
        filled: boolean;
        disabled: boolean;
        required: boolean;
        readonly: boolean;
        maxLength: number;
        min: number;
        max: number;
        decimals: number;
        allowNegative: boolean;
        exponentialNotation: boolean;
        minDate: string;
        maxDate: string;
        dateFormat: string;
        defaultValue: any;
    };
    onFieldClick: (field) => void; // Open modal
    onDelete: (field) => void; // Delete value
    onSave: (field, value) => void; // Save inline edit
    canDelete: boolean;
    disabled: boolean;
    canvasScale: number;
    storedInitials: object;
    onReuseInitials: (field) => void;
}
```

#### Field Types & Rendering

**1. Text/Number Fields (Inline Editing)**

**Empty State**:

```jsx
<button className="field-button" onClick={handleFieldClick}>
    Enter {fieldName}
</button>
```

**Filled State**:

```jsx
<div className="field-value-container" onClick={enableEditing}>
    <span className="field-value">{value}</span>
    {canDelete && <button onClick={handleDelete}>×</button>}
</div>
```

**Editing State**:

```jsx
<input ref={inputRef} type={fieldType === "number" ? "number" : "text"} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveInline} onKeyDown={(e) => e.key === "Enter" && handleSaveInline()} maxLength={maxLength} />
```

**2. Date Fields (Modal)**

**Empty**: Shows button with calendar icon  
**Filled**: Displays formatted date (e.g., "Jan 05 2026")

**3. Email Fields (Modal)**

**Empty**: Shows button with envelope icon  
**Filled**: Displays email address

**4. Checkbox Fields (Toggle)**

**Unchecked**: Empty checkbox outline  
**Checked**: Checkbox with checkmark

```jsx
<button onClick={toggleCheckbox}>
  {value ? (
    <svg><!-- Checkmark --></svg>
  ) : (
    <div className="checkbox-outline" />
  )}
</button>
```

#### Inline Validation

**Text/Number Fields**:

```javascript
const handleSaveInline = () => {
    // Required check
    if (required && !editValue.trim()) {
        alert("This field is required");
        return;
    }

    // Email validation
    if (fieldType === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editValue)) {
            alert("Please enter a valid email address");
            return;
        }
    }

    // Number validation
    if (fieldType === "number") {
        let num = Number(editValue.replace(/,/g, ""));
        if (isNaN(num)) {
            alert("Please enter a valid number");
            return;
        }
        if (allowNegative === false && num < 0) {
            alert("Negative numbers are not allowed");
            return;
        }
        if (min !== undefined && num < min) {
            alert(`Value must be ≥ ${min}`);
            return;
        }
        // ... more validations
    }

    onSave(field, editValue);
    setIsEditing(false);
};
```

#### Character Limit Warning

Shows tooltip when approaching maxLength:

```javascript
if (editValue.length >= maxLength - 10) {
    setShowLimitWarning(true);
    // Auto-hide after 3 seconds
    warningTimeoutRef.current = setTimeout(() => {
        setShowLimitWarning(false);
    }, 3000);
}
```

---

### FieldModal Component

**File**: [src/components/FieldModal.jsx](src/components/FieldModal.jsx)  
**Purpose**: Modal for capturing email, date, and other complex field values  
**Dependencies**: FieldModal.css

#### Props

```typescript
interface FieldModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (value) => void;
    field: {
        fieldType: "text" | "date" | "number" | "email" | "checkbox";
        fieldName: string;
        required: boolean;
        readonly: boolean;
        value: any;
        defaultValue: any;
        // Date-specific
        minDate: string;
        maxDate: string;
        dateFormat: string; // "MMM DD YYYY", "DD/MM/YYYY", etc.
        // Number-specific
        min: number;
        max: number;
        decimals: number;
        allowNegative: boolean;
        exponentialNotation: boolean;
    };
}
```

#### Date Formatting

**Custom Pattern Support**:

```javascript
const formatDateByPattern = (dateObj, pattern) => {
    const map = {
        YYYY: String(year),
        YY: String(year).slice(-2),
        MMMM: monthsLong[month], // "January"
        MMM: monthsShort[month], // "Jan"
        MM: pad2(month + 1), // "01"
        M: String(month + 1), // "1"
        DD: pad2(date), // "05"
        D: String(date), // "5"
    };

    return pattern.replace(/YYYY|MMMM|MMM|MM|YY|DD|M|D/g, (match) => map[match] || match);
};
```

**Examples**:

-   `"MMM DD YYYY"` → `"Jan 05 2026"`
-   `"DD/MM/YYYY"` → `"05/01/2026"`
-   `"MMMM D, YYYY"` → `"January 5, 2026"`

#### Date Validation

```javascript
const handleSave = () => {
    if (fieldType === "date" && value) {
        const selectedDate = new Date(value);

        if (minDate) {
            const minDateObj = new Date(minDate);
            if (selectedDate < minDateObj) {
                setError(`Date must be on or after ${minDate}`);
                return;
            }
        }

        if (maxDate) {
            const maxDateObj = new Date(maxDate);
            if (selectedDate > maxDateObj) {
                setError(`Date must be on or before ${maxDate}`);
                return;
            }
        }
    }

    onSave(formattedValue);
};
```

#### Number Formatting

**Decimal Control**:

```javascript
if (fieldType === "number" && decimals !== undefined) {
    const parts = String(value).split(".");
    if (parts[1] && parts[1].length > decimals) {
        setError(`Only ${decimals} decimal places allowed`);
        return;
    }
}
```

---

### DrawSignature Component

**File**: [src/components/signature-tabs/DrawSignature.jsx](src/components/signature-tabs/DrawSignature.jsx)  
**Purpose**: Canvas-based signature drawing with pen/eraser tools  
**Dependencies**: DrawSignature.css

#### Props

```typescript
interface DrawSignatureProps {
    onChange: (base64Image: string | null) => void;
    clearTrigger: number; // Increment to trigger clear
    hidePen: boolean; // Hide pen tool button
    hideEraser: boolean; // Hide eraser button
    hideUndo: boolean; // Hide undo button
    hideRedo: boolean; // Hide redo button
    hideBrushSize: boolean; // Hide brush size slider
    defaultPenSize: number; // 1-10
    defaultEraseSize: number; // 1-10
    minBrushSize: number;
    maxBrushSize: number;
    canvasWidth: number; // Canvas dimensions
    canvasHeight: number;
}
```

#### Drawing Engine

**Touch & Mouse Support**:

```javascript
const getPointerPosition = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
        x: clientX - rect.left,
        y: clientY - rect.top,
    };
};
```

**Drawing Logic**:

```javascript
const draw = (e) => {
    if (!isDrawing) return;

    const currentPoint = getPointerPosition(e);
    const ctx = canvas.getContext("2d");

    if (tool === "pen") {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = penSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    } else if (tool === "erase") {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = eraseSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    }

    if (lastPoint) {
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
    }

    setLastPoint(currentPoint);
};
```

#### Undo/Redo System

**History Management**:

```javascript
const [history, setHistory] = useState([]); // Array of canvas snapshots
const [historyStep, setHistoryStep] = useState(-1);

const saveToHistory = () => {
    const imageData = canvas.toDataURL("image/png");
    setHistory((prev) => {
        const newHistory = prev.slice(0, historyStep + 1);
        return [...newHistory, imageData];
    });
    setHistoryStep((prev) => prev + 1);
};

const undo = () => {
    if (historyStep > 0) {
        setHistoryStep((prev) => prev - 1);
        restoreFromHistory(historyStep - 1);
    }
};

const redo = () => {
    if (historyStep < history.length - 1) {
        setHistoryStep((prev) => prev + 1);
        restoreFromHistory(historyStep + 1);
    }
};
```

**When to Save History**:

-   After each stroke (on `mouseup`/`touchend`)
-   After erasing
-   After clearing canvas

#### Empty Canvas Detection

```javascript
const checkIfCanvasIsEmpty = () => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    // Check if any pixel has non-zero alpha
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) {
            return false; // Not empty
        }
    }
    return true; // Empty
};
```

**Why This Matters**: Prevents submitting blank signatures.

---

### TypeSignature Component

**File**: [src/components/signature-tabs/TypeSignature.jsx](src/components/signature-tabs/TypeSignature.jsx)  
**Purpose**: Text-based signature with font customization  
**Dependencies**: TypeSignature.css, Google Fonts

#### Props

```typescript
interface TypeSignatureProps {
    onChange: (base64Image: string | null) => void;
    clearTrigger: number;
    defaultValue: string;
    hideBold: boolean;
    hideItalic: boolean;
    hideFontStyle: boolean;
    hideFontSize: boolean;
    availableFonts: string[]; // Font family names
    defaultFontStyle: string;
    defaultFontSize: number;
    minFontSize: number;
    maxFontSize: number;
    fontSizeStep: number; // Size increment (e.g., 2)
    maxTextLength: number; // Character limit
    canvasWidth: number;
    canvasHeight: number;
}
```

#### Font Loading

**Wait for Fonts to Load**:

```javascript
useEffect(() => {
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            setFontsLoaded(true);
        });
    } else {
        setFontsLoaded(true); // Fallback
    }
}, []);
```

**Verify Specific Font Loaded**:

```javascript
const fontLoadCheck = async () => {
    const fontString = `${fontStyle} ${fontWeight} ${fontSize}px "${selectedFont}"`;

    if (!document.fonts.check(fontString)) {
        await document.fonts.load(fontString);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
};
```

**Why This Matters**: Prevents incorrect signature rendering if fonts haven't loaded yet.

#### Canvas Generation

**Dynamic Sizing**:

```javascript
// 1. Render text in preview container
<div
    ref={previewRef}
    style={{
        fontFamily: selectedFont,
        fontSize: `${adjustedFontSize(selectedFont, fontSize)}px`,
        fontWeight: isBold ? "bold" : "normal",
        fontStyle: isItalic ? "italic" : "normal",
    }}>
    {text}
</div>;

// 2. Measure actual rendered dimensions
const previewRect = previewContainer.getBoundingClientRect();
const textWidth = previewRect.width;
const textHeight = previewRect.height;

// 3. Create canvas matching dimensions
const canvas = canvasRef.current;
canvas.width = textWidth;
canvas.height = textHeight;

// 4. Draw text on canvas
const ctx = canvas.getContext("2d");
ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${selectedFont}"`;
ctx.fillStyle = "#000000";
ctx.textBaseline = "top";
ctx.fillText(text, 0, 0);

// 5. Convert to base64
const base64Image = canvas.toDataURL("image/png");
onChange(base64Image);
```

**Font Size Adjustment**:

```javascript
const adjustedFontSize = (font, size) => {
    // Some decorative fonts need scaling adjustments
    const adjustments = {
        Artecallya: 1.0,
        Maytra: 1.2,
        "Mr Dafoe": 1.1,
        // ...
    };
    return size * (adjustments[font] || 1.0);
};
```

#### Character Limit

```javascript
<input
  maxLength={maxTextLength}
  value={text}
  onChange={(e) => {
    const newText = e.target.value;
    if (newText.length <= maxTextLength) {
      setText(newText);
    }
  }}
/>
<div className="char-counter">
  {text.length} / {maxTextLength}
</div>
```

---

### Toast Component

**File**: [src/components/Toast.jsx](src/components/Toast.jsx)  
**Purpose**: Display temporary success/error/info notifications  
**Dependencies**: Toast.css

#### Props

```typescript
interface ToastProps {
    message: string;
    type: "success" | "error" | "info";
    isVisible: boolean;
    onClose: () => void;
    duration: number; // Auto-close after ms (default: 3000)
}
```

#### Auto-Close Timer

```javascript
useEffect(() => {
    if (isVisible && duration > 0) {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }
}, [isVisible, duration, onClose]);
```

#### Visual States

**Success**:

-   Green background
-   Checkmark icon
-   Used for: "Document submitted successfully"

**Error**:

-   Red background
-   Alert icon
-   Used for: "Failed to upload document"

**Info**:

-   Blue background
-   Info icon
-   Used for: "Document was submitted in another tab"

#### Usage Example

```javascript
const [toast, setToast] = useState({
    isVisible: false,
    message: "",
    type: "success",
});

// Show toast
setToast({
    isVisible: true,
    message: "Signature saved successfully",
    type: "success",
});

// Component
<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={() => setToast({ ...toast, isVisible: false })} duration={3000} />;
```

---

## Pages

### ThankYou Page

**File**: [src/pages/ThankYou.jsx](src/pages/ThankYou.jsx)  
**Route**: `/thankyou`  
**Purpose**: Success page shown after document submission

**Features**:

-   Animated checkmark icon (SVG animation)
-   Success message
-   3 status indicators:
    1. Document Signed ✓
    2. Submitted Successfully ✓
    3. Confirmation Sent ✓
-   Informational text about confirmation email

**Navigation**:

```javascript
// From App.jsx after successful submission
navigate("/thankyou");
```

**No State Management**: Static success page with no interactive elements.

---

### Rejected Page

**File**: [src/pages/Rejected.jsx](src/pages/Rejected.jsx)  
**Route**: `/rejected`  
**Purpose**: Confirmation page shown after document rejection

**Features**:

-   Animated X icon (SVG animation)
-   Rejection confirmation message
-   3 status indicators:
    1. Document Rejected ✗
    2. Status Updated ✗
    3. Notification Sent ✗
-   Informational text about sender notification

**Navigation**:

```javascript
// From App.jsx after rejection
navigate("/rejected");
```

**Styling**: Red theme to indicate rejection/cancellation.

---

### NotFound Page

**File**: [src/pages/NotFound.jsx](src/pages/NotFound.jsx)  
**Route**: `*` (catch-all)  
**Purpose**: Redirects any unknown routes back to root while preserving URL params

**Logic**:

```javascript
const NotFound = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // Extract search params from current location
        const searchParams = location.search;

        // Redirect to root page with preserved parameters
        navigate(`/${searchParams}`, { replace: true });
    }, [navigate, location]);

    return null; // No UI, immediate redirect
};
```

**Why This Matters**: Ensures authentication params aren't lost if user navigates to invalid URL.

---

## Libraries & Dependencies

### Production Dependencies

**React Ecosystem**:

```json
{
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "react-router-dom": "^7.9.6"
}
```

**PDF Libraries**:

```json
{
    "pdfjs-dist": "^5.4.394", // Rendering
    "pdf-lib": "^1.17.1" // Manipulation
}
```

**Utilities**:

```json
{
    "buffer": "^6.0.3", // Browser Buffer polyfill
    "html2pdf.js": "^0.12.1" // Audit report PDF generation
}
```

### Development Dependencies

```json
{
    "@vitejs/plugin-react": "^5.0.4",
    "vite": "^7.1.7",
    "eslint": "^9.36.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.22"
}
```

### Library Usage Details

#### 1. pdfjs-dist (PDF Rendering)

**Purpose**: Render PDF pages to HTML5 Canvas  
**Version**: 5.4.394  
**Location**: Used in [App.jsx](src/App.jsx)

**Setup**:

```javascript
import * as pdfjsLib from "pdfjs-dist";
import "./pdfjs/pdf.worker.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.mjs";
```

**Usage**:

```javascript
// Load PDF
const pdfDocument = await pdfjsLib.getDocument(pdfBytes).promise;

// Render page
const page = await pdfDocument.getPage(pageNumber);
const viewport = page.getViewport({ scale: canvasScale });

canvas.width = viewport.width;
canvas.height = viewport.height;

await page.render({
    canvasContext: ctx,
    viewport: viewport,
}).promise;
```

**Key Features**:

-   Web Worker for non-blocking rendering
-   Progressive loading
-   Text layer support (not used in this app)
-   Annotation support (not used in this app)

---

#### 2. pdf-lib (PDF Manipulation)

**Purpose**: Modify PDF by embedding signatures and field values  
**Version**: 1.17.1  
**Location**: Used in [App.jsx](src/App.jsx) for final PDF merge

**Setup**:

```javascript
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
```

**Usage**:

```javascript
// Load PDF
const pdfDoc = await PDFDocument.load(originalPdfBytes);
const pages = pdfDoc.getPages();

// Embed signature image
const imageBytes = await fetch(signatureUrl).then((r) => r.arrayBuffer());
const image = await pdfDoc.embedPng(imageBytes);

const page = pages[pageNumber - 1];
page.drawImage(image, {
    x: xCoord,
    y: yCoord,
    width: widthCoord,
    height: heightCoord,
});

// Draw text
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
page.drawText("John Doe", {
    x: xCoord,
    y: yCoord,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
});

// Save modified PDF
const pdfBytes = await pdfDoc.save();
```

**Supported Operations**:

-   Embed images (PNG, JPEG)
-   Draw text with system fonts
-   Draw shapes (rectangles, lines)
-   Merge/split PDFs (not used)
-   Form field manipulation (not used)

---

#### 3. buffer (Browser Polyfill)

**Purpose**: Provides Node.js Buffer API in browser  
**Version**: 6.0.3  
**Location**: Used for base64 encoding

**Setup**:

```javascript
import { Buffer } from "buffer";
```

**Usage**:

```javascript
// Convert PDF ArrayBuffer to base64 for Salesforce upload
const base64Pdf = Buffer.from(pdfBytes).toString("base64");

// Upload to Salesforce
const response = await fetch(salesforceUrl, {
    body: JSON.stringify({
        VersionData: base64Pdf,
    }),
});
```

---

#### 4. html2pdf.js (Audit Report Generation)

**Purpose**: Convert HTML audit report to PDF  
**Version**: 0.12.1  
**Location**: Used in [auditReport.js](src/utils/auditReport.js)

**Usage**:

```javascript
import html2pdf from "html2pdf.js";

export const convertAuditHTMLToPDF = async (htmlContent) => {
    const element = document.createElement("div");
    element.innerHTML = htmlContent;

    const options = {
        margin: [10, 10],
        filename: "audit_report.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };

    return await html2pdf().set(options).from(element).toPdf().output("blob");
};
```

**Features Used**:

-   HTML to Canvas conversion
-   Canvas to PDF conversion
-   Page break management
-   Image embedding

---

#### 5. react-router-dom (Routing)

**Purpose**: Client-side routing for SPA  
**Version**: 7.9.6  
**Location**: [main.jsx](src/main.jsx)

**Setup**:

```javascript
import { BrowserRouter, Routes, Route } from "react-router-dom";

<BrowserRouter>
    <Routes>
        <Route path="/" element={<App />} />
        <Route path="/thankyou" element={<ThankYou />} />
        <Route path="/rejected" element={<Rejected />} />
        <Route path="*" element={<NotFound />} />
    </Routes>
</BrowserRouter>;
```

**Hooks Used**:

-   `useNavigate()`: Programmatic navigation
-   `useLocation()`: Access current URL/params
-   `useParams()`: Extract URL parameters (not used)

---

### Build Tool: Vite

**Config**: [vite.config.js](vite.config.js)

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
});
```

**Key Features**:

-   **Fast HMR**: Hot Module Replacement for instant updates
-   **ES Modules**: Native ESM in development
-   **Optimized Build**: Rollup-based production builds
-   **Asset Handling**: Automatic code splitting

**Build Output**:

```bash
npm run build
# Output: dist/
#   - index.html
#   - assets/
#       - index-[hash].js
#       - index-[hash].css
```

---

## Utility Modules

### signatureUtils.js

**File**: [src/utils/signatureUtils.js](src/utils/signatureUtils.js)  
**Purpose**: Pure functions for signature/field data transformations

#### Type Guards

```javascript
const SIGNATURE_TYPES = new Set(["signature", "initials"]);
const FIELD_TYPES = new Set(["text", "date", "number", "email", "checkbox"]);

export const isSignatureEntry = (entry) => {
    const t = normalizeType(entry.type);
    if (SIGNATURE_TYPES.has(t)) return true;
    if (FIELD_TYPES.has(t)) return false;
    return !entry.fieldType; // Backward compat
};

export const isFieldEntry = (entry) => {
    const t = normalizeType(entry.fieldType || entry.type);
    return FIELD_TYPES.has(t);
};
```

#### Update Functions

**updateSignatureWithImage**:

```javascript
export const updateSignatureWithImage = (
    signatures, // Full nested array
    index, // Field index
    imageUrl, // Base64 signature image
    expectedType, // "signature" or "initials"
    signerObject, // Parent signer for priority matching
    metadata // { timestamp, ipAddress, location, device }
) => {
    return signatures.map((sig) => {
        if (sig.fields && Array.isArray(sig.fields)) {
            const hasMatchingField = sig.fields.some((f) => f.index === index);
            if (hasMatchingField) {
                // Verify correct signer by priority
                if (signerObject && sig.priority !== signerObject.priority) {
                    return sig; // Skip wrong signer
                }

                return {
                    ...sig,
                    fields: sig.fields.map((field) => {
                        if (field.index === index && isSignatureEntry(field)) {
                            return { ...field, signed: true, imageUrl, ...metadata };
                        }
                        return field;
                    }),
                };
            }
        }
        return sig;
    });
};
```

**updateNestedFieldValue**:

```javascript
export const updateNestedFieldValue = (signatures, index, value, expectedFieldType, signerObject) => {
    return signatures.map((sig) => {
        if (sig.fields && Array.isArray(sig.fields)) {
            if (signerObject && sig.priority !== signerObject.priority) {
                return sig;
            }

            return {
                ...sig,
                fields: sig.fields.map((field) => {
                    if (field.index === index && isFieldEntry(field)) {
                        return { ...field, filled: true, value };
                    }
                    return field;
                }),
            };
        }
        return sig;
    });
};
```

**Why signerObject is Critical**: Prevents updating field index 0 for signer A when you meant to update field index 0 for signer B.

---

### encryption.js

**File**: [src/utils/encryption.js](src/utils/encryption.js)  
**Purpose**: AES-256-CBC encryption/decryption for URL parameters

#### Algorithm Details

**Encryption**: AES-256-CBC  
**Key Derivation**: Fixed 32-byte key (matches Salesforce Apex)  
**IV**: Fixed 16-byte IV (matches Salesforce Apex)  
**Encoding**: Base64 URL-safe

**Why Fixed IV?**: Simplifies Apex/JS interop. Not ideal for general security, but acceptable for short-lived session tokens.

#### Functions

**encryptUrlParams**:

```javascript
export async function encryptUrlParams(queryString, key = ENCRYPTION_KEY) {
    const encoder = new TextEncoder();
    const data = encoder.encode(queryString);

    // Prepare 32-byte key
    const keyBytes = prepareKey(key);
    const cryptoKey = await importKey(keyBytes);

    // Fixed IV (matches Apex)
    const iv = encoder.encode(FIXED_IV);

    // Encrypt
    const encryptedData = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv }, cryptoKey, data);

    // Base64 URL-safe encode
    return arrayBufferToBase64Url(encryptedData);
}
```

**decryptUrlParams**:

```javascript
export async function decryptUrlParams(encryptedString, key = ENCRYPTION_KEY) {
    const keyBytes = prepareKey(key);
    const cryptoKey = await importKey(keyBytes);

    const iv = new TextEncoder().encode(FIXED_IV);
    const encryptedData = base64UrlToArrayBuffer(encryptedString);

    const decryptedData = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, cryptoKey, encryptedData);

    const decoder = new TextDecoder();
    const decryptedString = decoder.decode(decryptedData);

    // Parse key=value pairs
    return parseQueryString(decryptedString);
}
```

#### Query String Parsing

```javascript
export function parseQueryString(queryString) {
    const params = {};
    const pairs = queryString.split("&");

    for (const pair of pairs) {
        const [key, value] = pair.split("=");
        params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    }

    return params;
}
```

---

### auditReport.js

**File**: [src/utils/auditReport.js](src/utils/auditReport.js)  
**Purpose**: Generate HTML audit trail report and convert to PDF

#### Report Structure

**HTML Template**:

```html
<div style="background:#FFFFFF; padding:24px;">
    <!-- Header -->
    <div style="display:flex; justify-content:space-between;">
        <div>
            <h2>Document Audit Report</h2>
            <p>Document: {documentName}</p>
            <p>Organization: {orgId}</p>
        </div>
        <div>
            <p>Generated: {currentDate}</p>
            <p>Total Pages: {totalPages}</p>
        </div>
    </div>

    <!-- Statistics -->
    <div style="display:flex; gap:16px;">
        <div>{SVG_TOTAL} Total Signatures: {allFields.length}</div>
        <div>{SVG_SIGNED} Completed: {signedFields.length}</div>
        <div>{SVG_PENDING} Pending: {pendingFields.length}</div>
    </div>

    <!-- Signature Table -->
    <table>
        <thead>
            <tr>
                <th>Signer</th>
                <th>Email</th>
                <th>Status</th>
                <th>Timestamp</th>
                <th>Location</th>
                <th>Device</th>
            </tr>
        </thead>
        <tbody>
            {displayFields.map(field => (
            <tr>
                <td>{field.signerName}</td>
                <td>{field.signerEmail}</td>
                <td>{field.filled ? "✓ Signed" : "○ Pending"}</td>
                <td>{formatTimestamp(field.timestamp)}</td>
                <td>{field.location || "--"}</td>
                <td>{field.device || "--"}</td>
            </tr>
            ))}
        </tbody>
    </table>
</div>
```

#### Date Formatting

```javascript
const formatTimestamp = (timestamp) => {
    if (!timestamp || timestamp === "--") return "--";

    // Format: "Jan 5, 2026 2:30 PM PST"
    // Make timezone smaller
    const match = timestamp.match(/(.*?\d:\d\d)\s(.*)$/);
    if (match) {
        const mainPart = match[1];
        const timezonePart = match[2];
        return `${mainPart} <span style="font-size:9px;">${timezonePart}</span>`;
    }

    return timestamp;
};
```

#### PDF Generation

```javascript
export const convertAuditHTMLToPDF = async (htmlContent) => {
    const options = {
        margin: [10, 10],
        filename: "audit_report.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: {
            unit: "mm",
            format: "a4",
            orientation: "portrait",
        },
    };

    const element = document.createElement("div");
    element.innerHTML = htmlContent;

    return await html2pdf().set(options).from(element).toPdf().output("blob");
};
```

---

## Edge Cases & Debugging Tips

### Common Issues

#### 1. Duplicate Field Indices Across Signers

**Problem**: Signer 1 has field index 0, Signer 2 also has field index 0. Updating one updates both.

**Solution**: Always pass `signerObject` to update functions:

```javascript
updateSignatureWithImage(
    signatureData,
    0, // index
    imageUrl,
    "signature",
    field._parentSigner // ← Critical!
);
```

#### 2. ArrayBuffer Detached Error

**Problem**: `pdfjs-dist` consumes the ArrayBuffer, making it unusable for `pdf-lib`.

**Solution**: Create a copy before passing to pdfjs:

```javascript
const arrayBuffer = await response.arrayBuffer();
setOriginalPdfBytes(arrayBuffer); // Store original

const pdfBytesCopy = arrayBuffer.slice(0); // Create copy
const pdfDoc = await pdfjsLib.getDocument(pdfBytesCopy).promise;
```

#### 3. Y-Axis Coordinate Flip

**Problem**: Signature appears upside-down or in wrong position.

**Solution**: Remember to flip Y-axis when converting canvas → PDF:

```javascript
const y = pageHeight - (yPercent / 100) * pageHeight - height;
//        ↑ Flip: canvas origin is top, PDF origin is bottom
```

#### 4. Font Not Loading in TypeSignature

**Problem**: Signature renders with default font instead of selected font.

**Solution**: Wait for fonts to load:

```javascript
await document.fonts.load(`${fontWeight} ${fontSize}px "${fontFamily}"`);
await new Promise((resolve) => setTimeout(resolve, 50)); // Additional delay
```

#### 5. Token Expiry Mid-Session

**Problem**: User gets 401 error after working for an hour.

**Solution**: Implement token refresh:

```javascript
const makeSalesforceRequest = async (fetchFn) => {
    try {
        const response = await fetchFn();

        if (response.status === 401) {
            const newToken = await refreshAccessToken();
            setSalesforceConfig((prev) => ({ ...prev, accessToken: newToken }));
            return await fetchFn(); // Retry
        }

        return response;
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
};
```

### Debugging Commands

**Check Salesforce API Calls**:

```javascript
// Add to App.jsx
console.log("Salesforce Config:", salesforceConfig);
console.log("Document Record:", documentRecord);
console.log("Signature Data:", signatureData);
```

**Check PDF Rendering**:

```javascript
console.log("PDF Document:", pdfFile);
console.log("Total Pages:", totalPages);
console.log("Canvas Scale:", canvasScale);
```

**Check Overlay Positions**:

```javascript
// In SignatureOverlay.jsx
console.log("Page Signatures:", pageSignatures);
console.log("Unique Key:", uniqueKey);
console.log("Field Position:", {
    xPercent: field.xPercent,
    yPercent: field.yPercent,
    widthPercent: field.widthPercent,
    heightPercent: field.heightPercent,
});
```

**Check State Updates**:

```javascript
// Use React DevTools
// Components tab → Select component → View hooks
// Look for: signatureData, sessionSignedKeys, sessionFilledKeys
```

### Performance Tips

**1. Debounce Canvas Resize**:

```javascript
const resizeTimeoutRef = useRef(null);

window.addEventListener("resize", () => {
    clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
        recalculateScale();
        rerenderPdf();
    }, 300);
});
```

**2. Lazy Load PDF Pages**:

```javascript
// Only render visible pages in viewport
const observerRef = useRef(
    new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const pageNum = entry.target.dataset.pageNum;
                renderPage(pageNum);
            }
        });
    })
);
```

**3. Memoize Expensive Calculations**:

```javascript
const visibleFields = useMemo(() => {
    return filterFieldsByPriority(signatureData, urlPriority);
}, [signatureData, urlPriority]);
```

### Browser Compatibility

**Required APIs**:

-   Canvas API (all modern browsers)
-   Web Crypto API (all modern browsers)
-   BroadcastChannel API (no IE11)
-   Geolocation API (user permission required)
-   FileReader API (all modern browsers)

**Fallbacks**:

```javascript
// Check for BroadcastChannel support
if (typeof BroadcastChannel !== "undefined") {
    // Use cross-tab sync
} else {
    // Rely on pre-submission check only
}
```

---

## Development Checklist

**Before Starting Development**:

-   [ ] Install Node.js 18+
-   [ ] Run `npm install`
-   [ ] Configure Salesforce org with custom objects
-   [ ] Deploy Visualforce pages
-   [ ] Set up OAuth Connected App

**Before Committing**:

-   [ ] Run `npm run lint`
-   [ ] Test all field types (signature, text, date, email, checkbox)
-   [ ] Test multi-signer workflow (priority 1, 2, 3)
-   [ ] Test token refresh (simulate expiry)
-   [ ] Test cross-tab synchronization
-   [ ] Test mobile responsive design
-   [ ] Check console for errors

**Before Deployment**:

-   [ ] Run `npm run build`
-   [ ] Test production build with `npm run preview`
-   [ ] Verify PDF rendering in production
-   [ ] Test Salesforce API integration
-   [ ] Check error messages are user-friendly
-   [ ] Verify audit trail generation

---

**End of Part 2 - Developer Guide Complete**

This comprehensive guide covers all components, pages, libraries, utilities, and debugging strategies needed to maintain and extend the Signature Anywhere Insurance Medics application.
