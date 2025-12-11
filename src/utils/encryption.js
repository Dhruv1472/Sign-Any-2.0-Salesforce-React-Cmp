// URL Parameter Encryption/Decryption Utility
// Matches Salesforce Apex encryption method using AES-256-CBC with fixed IV

const ENCRYPTION_KEY = "SignatureAnywhereSecretKey32"; // Must match Apex ENCRYPTION_KEY
const FIXED_IV = "SignatureAnyIV16"; // Must match Apex fixed IV (16 bytes)

/**
 * Prepares the encryption key - pads or truncates to 32 bytes
 */
function prepareKey(key) {
    const encoder = new TextEncoder();
    let keyBytes = encoder.encode(key);

    if (keyBytes.length < 32) {
        // Pad with spaces on the left to match Apex leftPad behavior
        const paddedKey = key.padStart(32, " ").substring(0, 32);
        keyBytes = encoder.encode(paddedKey);
    } else if (keyBytes.length > 32) {
        // Truncate to 32 bytes
        keyBytes = keyBytes.slice(0, 32);
    }

    return keyBytes;
}

/**
 * Imports the key for Web Crypto API
 */
async function importKey(keyBytes) {
    return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * Converts ArrayBuffer to Base64 URL-safe string
 */
function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Converts Base64 URL-safe string to ArrayBuffer
 */
function base64UrlToArrayBuffer(base64Url) {
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");

    // Add padding if needed
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const base64Padded = base64 + padding;

    const binary = atob(base64Padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Encrypts URL parameters using AES-256-CBC (matches Apex encryption)
 * @param {string} queryString - The query string to encrypt (e.g., "priority=1&recordId=abc...")
 * @param {string} key - Encryption key (defaults to ENCRYPTION_KEY)
 * @returns {Promise<string>} - Base64 URL-safe encrypted string
 *
 * @example
 * const encrypted = await encryptUrlParams("priority=1&recordId=a00gL00000SxJ3JQAV&accessToken=abc");
 * console.log(encrypted); // "3R7T05Eouq61gHdolt4h0x..."
 */
export async function encryptUrlParams(queryString, key = ENCRYPTION_KEY) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(queryString);

        // Prepare key (pad/truncate to 32 bytes)
        const keyBytes = prepareKey(key);
        const cryptoKey = await importKey(keyBytes);

        // Use fixed IV (16 bytes for AES-CBC)
        const iv = encoder.encode(FIXED_IV);

        // Encrypt the data using AES-CBC
        const encryptedData = await crypto.subtle.encrypt(
            {
                name: "AES-CBC",
                iv: iv,
            },
            cryptoKey,
            data
        );

        // Convert to Base64 URL-safe string
        return arrayBufferToBase64Url(encryptedData);
    } catch (error) {
        console.error("Encryption error:", error);
        throw new Error("Failed to encrypt URL parameters");
    }
}

/**
 * Decrypts URL parameters using AES-256-CBC (matches Apex decryption)
 * @param {string} encryptedString - The Base64 URL-safe encrypted string
 * @param {string} key - Decryption key (defaults to ENCRYPTION_KEY)
 * @returns {Promise<string>} - Decrypted query string
 *
 * @example
 * const decrypted = await decryptUrlParams("3R7T05Eouq61gHdolt4h0x...");
 * console.log(decrypted); // "priority=1&recordId=a00gL00000SxJ3JQAV&accessToken=abc"
 */
export async function decryptUrlParams(encryptedString, key = ENCRYPTION_KEY) {
    if (!encryptedString) {
        return "";
    }

    try {
        const encoder = new TextEncoder();

        // Convert Base64 URL-safe string to ArrayBuffer
        const encryptedData = base64UrlToArrayBuffer(encryptedString);

        // Prepare key (pad/truncate to 32 bytes) - must match Apex
        const keyBytes = prepareKey(key);
        const cryptoKey = await importKey(keyBytes);

        // Use fixed IV (16 bytes for AES-CBC) - must match Apex
        const iv = encoder.encode(FIXED_IV);

        // Decrypt the data using AES-CBC
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: "AES-CBC",
                iv: iv,
            },
            cryptoKey,
            encryptedData
        );

        // Convert to string
        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    } catch (error) {
        console.error("Decryption error:", error);
        throw new Error("Failed to decrypt URL parameters. Invalid or tampered data.");
    }
}

/**
 * Helper function to parse decrypted query string into an object
 * @param {string} queryString - Query string like "key1=value1&key2=value2"
 * @returns {Object} - Object with key-value pairs
 *
 * @example
 * const params = parseQueryString("priority=1&recordId=abc");
 * console.log(params); // { priority: "1", recordId: "abc" }
 */
export function parseQueryString(queryString) {
    const params = {};
    const pairs = queryString.split("&");

    for (const pair of pairs) {
        const [key, value] = pair.split("=");
        if (key) {
            params[decodeURIComponent(key)] = decodeURIComponent(value || "");
        }
    }

    return params;
}

/**
 * Helper function to build query string from object
 * @param {Object} params - Object with key-value pairs
 * @returns {string} - Query string like "key1=value1&key2=value2"
 *
 * @example
 * const queryString = buildQueryString({ priority: 1, recordId: "abc" });
 * console.log(queryString); // "priority=1&recordId=abc"
 */
export function buildQueryString(params) {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
}
