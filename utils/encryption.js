const crypto = require("crypto");

/**
 * Encryption utilities for secure challenge data
 */

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16; // For CBC, this is always 16
const SALT_LENGTH = 64;

/**
 * Generate a secure challenge ID
 */
const generateChallengeId = () => {
  return crypto.randomBytes(16).toString("hex");
};

/**
 * Normalize an input secret into a 32-byte password Buffer.
 * Supports either:
 * - 32-character UTF-8 secrets
 * - 64-character hex strings (representing 32 bytes)
 */
const normalizePassword = (password) => {
  if (!password) return null;
  // If 64-length hex, treat as raw 32 bytes
  const isHex32Bytes =
    typeof password === "string" && password.length === 64 && /^[0-9a-fA-F]+$/.test(password);
  if (isHex32Bytes) {
    return Buffer.from(password, "hex");
  }
  // If 32 characters, use UTF-8 bytes
  if (typeof password === "string" && password.length === 32) {
    return Buffer.from(password, "utf8");
  }
  return null;
};

/**
 * Generate encryption key from password using PBKDF2
 */
const generateKey = (password, salt) => {
  const pwBuf = Buffer.isBuffer(password) ? password : normalizePassword(password);
  if (!pwBuf) {
    throw new Error(
      `Encryption key must be 32 chars (UTF-8) or 64-char hex, got ${
        password ? String(password).length : 0
      }`
    );
  }
  return crypto.pbkdf2Sync(pwBuf, salt, 100000, 32, "sha512");
};

/**
 * Encrypt data using AES-256-CBC
 */
const encryptData = (data, password) => {
  try {
    // Normalize/validate password
    const pwBuf = normalizePassword(password);
    if (!pwBuf) {
      throw new Error(
        `Encryption key must be 32 chars (UTF-8) or 64-char hex, got ${
          password ? password.length : 0
        }`
      );
    }

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Generate key from password and salt
    const key = generateKey(pwBuf, salt);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt data
    const dataString = JSON.stringify(data);
    let encrypted = cipher.update(dataString, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Combine salt, iv, and encrypted data
    const encryptedData = {
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      data: encrypted,
      timestamp: Date.now(),
    };

    return encryptedData;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
};

/**
 * Decrypt data using AES-256-CBC
 */
const decryptData = (encryptedData, password) => {
  try {
    // Normalize/validate password
    const pwBuf = normalizePassword(password);
    if (!pwBuf) {
      throw new Error(
        `Decryption key must be 32 chars (UTF-8) or 64-char hex, got ${
          password ? password.length : 0
        }`
      );
    }

    // console.log("Decrypting data:", typeof encryptedData, encryptedData);

    if (typeof encryptedData === "string") {
      encryptedData = JSON.parse(encryptedData);
    }

    // Check if encryptedData has the expected structure
    if (!encryptedData || typeof encryptedData !== "object") {
      throw new Error("Invalid encrypted data format");
    }

    if (!encryptedData.salt || !encryptedData.iv || !encryptedData.data) {
      console.error(
        "Missing required fields in encrypted data:",
        Object.keys(encryptedData)
      );
      throw new Error("Missing required encryption fields");
    }

    // Extract components
    const salt = Buffer.from(encryptedData.salt, "hex");
    const iv = Buffer.from(encryptedData.iv, "hex");
    const encrypted = encryptedData.data;

    // Generate key from password and salt
    const key = generateKey(pwBuf, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    // Decrypt data
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    console.error("Encrypted data structure:", encryptedData);
    throw new Error(`Failed to decrypt data: ${error.message}`);
  }
};

/**
 * Hash sensitive data (like user IDs) for logging
 */
const hashSensitiveData = (data) => {
  const hash = crypto.createHash("sha256");
  hash.update(data + process.env.HASH_SALT || "default-salt");
  return hash.digest("hex").substring(0, 16);
};

/**
 * Generate secure random token
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString("hex");
};

/**
 * Verify data integrity
 */
const verifyDataIntegrity = (data, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(data))
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch (error) {
    return false;
  }
};

/**
 * Create data signature
 */
const createDataSignature = (data, secret) => {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(data))
    .digest("hex");
};

module.exports = {
  generateChallengeId,
  encryptData,
  decryptData,
  hashSensitiveData,
  generateSecureToken,
  verifyDataIntegrity,
  createDataSignature,
};
