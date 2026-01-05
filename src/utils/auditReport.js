import html2pdf from "html2pdf.js";

const A4_WIDTH = 595;
const A4_HEIGHT = 842;

/**
 * Format timestamp with smaller timezone text
 * @param {string} timestamp - The timestamp string to format
 * @returns {string} Formatted timestamp HTML
 */
const formatTimestamp = (timestamp) => {
    if (!timestamp || timestamp === "--") return "--";

    // Check if timestamp contains AM or PM followed by timezone
    const ampmRegex = /(.*?\d:\d\d)\s(.*?)$/;
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

/**
 * Generate HTML content for audit report
 * @param {Object} doc - Document record from Salesforce
 * @param {Array} sigData - Signature data array
 * @param {string} orgId - Salesforce organization ID
 * @param {number} totalPages - Total number of pages in document
 * @param {boolean} showCompletedOnly - Whether to show only completed signatures
 * @returns {Promise<void>}
 */
export const generateAuditHTML = async (doc, sigData, orgId, totalPages, showCompletedOnly = false, localeKey = 'en-US', timeZone = 'UTC') => {
    // Only include signature fields (those with type="signature"), exclude other field types
    const allFields = sigData.flatMap((s) =>
        (s.fields || [])
            .filter((f) => (f.type || f.fieldType || "").toLowerCase() === "signature") // Only include fields with type="signature"
            .map((f) => ({ ...f, signerName: s.name || "--", signerEmail: s.email || "--" }))
    );

    // Always calculate counts based on ALL signatures
    const signedFields = allFields.filter((f) => f.filled);
    const pendingFields = allFields.filter((f) => !f.filled);

    // Filter fields to display in table based on showCompletedOnly flag
    const displayFields = showCompletedOnly ? signedFields : allFields;

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

            /* Prevent page breaks inside signature rows */
            #audit-html .signature-row {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }

            /* Add some spacing before rows to help with page breaks */
            #audit-html .signature-row:not(:first-child) {
                page-break-before: auto;
            }

            /* Add margin to top of each page */
            @page {
                margin-top: 24px;
            }

            /* Add extra top padding for signature rows that might start a new page */
            #audit-html .signature-row {
                margin-top: 4px;
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
                        <td style="text-align:right;color:black; padding-right:18px;">${new Date(doc.CreatedDate).toLocaleString(localeKey, { timeZone })}</td>
                        
                        <td style="color:gray; padding-right:18px;">Document ID:</td>
                        <td style="text-align:right;color:black; padding-left:18px;">${doc.Id || ""}</td>
                    </tr>
                    <tr>
                        <td style="color:gray; padding-right:18px;">Document Name:</td>
                        <td style="text-align:right;color:black; padding-right:18px;">${doc.Document_Name__c && doc.Document_Name__c.length > 25 ? doc.Document_Name__c.slice(0, 25) + "..." : doc.Document_Name__c || ""}</td>
                        
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
                        ${displayFields
                            .map(
                                (f) => `
                        <tr class="signature-row" style="border-top:1px solid #E2E8F0; page-break-inside: avoid; break-inside: avoid;">
                            <td style="padding:8px 0 8px 18px; text-align:center;">
                                ${
                                    f.imageUrl
                                        ? `<img src="${f.imageUrl}" 
                                        style="height:auto;width:auto;max-height:55px;max-width:110px;object-fit:contain;background:#fff;" />`
                                        : `<div style="border:1px solid #CBD5E0;height:35px;width:60px;border-radius:4px;background:#fff;display:flex;align-items:center;justify-content:center;margin:auto;">
                                            <span style="font-size:11px;color:#555;">#${f.index}</span>
                                    </div>`
                                }
                            </td>
                            <td style="padding:8px; vertical-align:middle;">
                                <table style="width:100%; border-collapse:collapse;">
                                    <tr>
                                        <td style="color:gray; padding-right:12px; width:80px;">Sign Type:</td>
                                        <td style="color:black;">
                                            <span style="color:#0066FF; font-weight:600;background:#E0F0FF;padding:0px 8px 0px 8px;border-radius:8px;font-size:9px;display:inline-flex;align-items:center;justify-content:center;">
                                                ${(f.signatureType || "--").toUpperCase()}
                                            </span>
                                        </td>
                                    </tr>
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
                                        <td style="color:gray; padding-right:12px; width:50px;">U Id:</td>
                                        <td style="color:black;">${f.deviceUniqueKey || "--"}</td>
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

/**
 * Convert audit HTML to PDF
 * @param {Object} pageFormat - PDF page format {width, height, orientation}
 * @returns {Promise<ArrayBuffer>} PDF as ArrayBuffer
 */
export const convertAuditHTMLToPDF = async (pageFormat) => {
    const element = document.getElementById("audit-html");

    element.style.visibility = "visible";
    element.style.position = "static";
    element.style.zIndex = "9999";

    await new Promise((res) => setTimeout(res, 400));

    // Use detected PDF page format for audit report
    const pageWidth = pageFormat.width || A4_WIDTH;
    const pageHeight = pageFormat.height || A4_HEIGHT;
    const orientation = pageFormat.orientation || "portrait";

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

    const arrayBuffer = await pdfBlob.arrayBuffer();

    element.style.visibility = "hidden";
    element.style.position = "absolute";
    element.style.top = "-9999px";
    // Clean up injected HTML to prevent any lingering scoped styles
    element.innerHTML = "";

    return arrayBuffer;
};
