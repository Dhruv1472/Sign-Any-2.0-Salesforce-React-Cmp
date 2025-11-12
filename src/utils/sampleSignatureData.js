/**
 * Sample Signature Data for Testing
 *
 * This file contains example signature configurations that can be used
 * for testing the signature placement functionality.
 */

// Example 1: Single signature on page 1
export const singleSignatureExample = [
    {
        key: "client_signature",
        buttonName: "Sign Here",
        page: 1,
        x: 50, // Center horizontally
        y: 85, // Near bottom
        width: 150,
        priority: 1,
        signed: false,
        imageUrl: null,
        type: "signature", // signature, text, or initials
    },
];

// Example 2: Multiple signatures with priority
export const multipleSignaturesExample = [
    {
        key: "client_signature",
        buttonName: "Client Signature",
        page: 1,
        x: 30,
        y: 80,
        width: 140,
        priority: 1,
        signed: false,
        imageUrl: null,
        type: "signature",
    },
    {
        key: "witness_signature",
        buttonName: "Witness Signature",
        page: 1,
        x: 70,
        y: 80,
        width: 140,
        priority: 2,
        signed: false,
        imageUrl: null,
        type: "signature",
    },
    {
        key: "notary_signature",
        buttonName: "Notary Signature",
        page: 1,
        x: 50,
        y: 90,
        width: 140,
        priority: 3,
        signed: false,
        imageUrl: null,
        type: "signature",
    },
];

// Example 3: Signatures across multiple pages
export const multiPageSignaturesExample = [
    {
        key: "initial_page1",
        buttonName: "Initial",
        page: 1,
        x: 90,
        y: 95,
        width: 80,
        priority: 1,
        signed: false,
        imageUrl: null,
    },
    {
        key: "initial_page2",
        buttonName: "Initial",
        page: 2,
        x: 90,
        y: 95,
        width: 80,
        priority: 2,
        signed: false,
        imageUrl: null,
    },
    {
        key: "final_signature",
        buttonName: "Final Signature",
        page: 3,
        x: 50,
        y: 85,
        width: 150,
        priority: 3,
        signed: false,
        imageUrl: null,
    },
];

// Example 4: Signature with existing image (pre-signed)
export const preSignedExample = [
    {
        key: "existing_signature",
        buttonName: "Sign Here",
        page: 1,
        x: 50,
        y: 85,
        width: 150,
        priority: 1,
        signed: true,
        imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
    {
        key: "next_signature",
        buttonName: "Witness Sign",
        page: 1,
        x: 50,
        y: 92,
        width: 150,
        priority: 2,
        signed: false,
        imageUrl: null,
    },
];

/**
 * Helper function to generate signature data for testing
 */
export const generateTestSignatureData = (count = 1, startPage = 1) => {
    const signatures = [];
    const types = ["signature", "text", "initials"];
    for (let i = 0; i < count; i++) {
        signatures.push({
            key: `signature_${i + 1}`,
            buttonName: `Sign ${i + 1}`,
            page: startPage + Math.floor(i / 3), // 3 signatures per page
            x: 30 + (i % 3) * 20, // Distribute horizontally
            y: 85 + (i % 2) * 5, // Alternate vertical position
            width: 120,
            priority: i + 1,
            signed: false,
            imageUrl: null,
            type: types[i % 3], // Cycle through types
        });
    }
    return signatures;
};
