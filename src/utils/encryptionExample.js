/**
 * Example Usage of URL Encryption for Signature Anywhere
 * 
 * This file demonstrates how to generate encrypted URLs for the signature app.
 * In production, this encryption should be done on the server-side (Salesforce/backend).
 */

import { encryptUrlParams, decryptUrlParams, buildQueryString, parseQueryString } from './encryption.js';

/**
 * Example: Generate an encrypted URL for a signer
 */
async function generateEncryptedUrl() {
    // Example parameters that would normally come from Salesforce
    const params = {
        priority: "1",
        recordId: "a00gL00000SxJ3JQAV",
        act: "00D8L0000003abc!AQEAQNxyz123...", // accessToken
        instanceUrl: "https://yourinstance.salesforce.com",
        clientId: "your_client_id",
        clientSecret: "your_client_secret"
    };

    // Build query string
    const queryString = buildQueryString(params);
    console.log("Original query string:", queryString);

    // Encrypt the query string
    const encrypted = await encryptUrlParams(queryString);
    console.log("Encrypted:", encrypted);

    // Generate the final URL
    const baseUrl = "https://d2v56xk8b57aaf.cloudfront.net/";
    const encryptedUrl = `${baseUrl}?q=${encrypted}`;
    console.log("\nEncrypted URL:");
    console.log(encryptedUrl);

    return encryptedUrl;
}

/**
 * Example: Decrypt and verify a URL
 */
async function verifyEncryptedUrl(encryptedString) {
    try {
        // Decrypt
        const decrypted = await decryptUrlParams(encryptedString);
        console.log("\nDecrypted query string:", decrypted);

        // Parse into object
        const params = parseQueryString(decrypted);
        console.log("Parsed parameters:", params);

        return params;
    } catch (error) {
        console.error("Decryption failed:", error.message);
        return null;
    }
}

/**
 * Example: Test with the provided encrypted URL
 */
async function testProvidedUrl() {
    const encryptedQuery = "3R7T05Eouq61gHdolt4h0x0T9qLjWzl3Vu7t8NP6PH8Hb4GSoX1wniocuD0KKJad3kiCRNc0esjHtmp30bAs8iEwC80b8o-F7zRE8IbSrxfb9-d6kZCG_60GyiloDN2RkvusripWSDWtcgiOrCqP-7x07jaEiXNVPYyES3pgbPkQfNcJHFXQiiQAuM6ApLv-x3xgp7X_8NqS4s465dwmMRR56BC6Be3pSysp1DWVwuPo3WKtaaHS-OXE6uhGcJpRvusqkWkPS-oweNnebj6H4HSxWrO8KYPKLJAplc7uttMv08C_A57NJ6kejfaApSvV9zB3L40KNsfzn8wEnZVL0o5YSDyrxm2TPi5he2yXHTsvdF0gcwFnfsgWSo7tE3YW";
    
    console.log("Testing provided encrypted URL...");
    await verifyEncryptedUrl(encryptedQuery);
}

// Run examples (uncomment in browser console or Node.js environment)
// generateEncryptedUrl();
// testProvidedUrl();

export { generateEncryptedUrl, verifyEncryptedUrl, testProvidedUrl };
