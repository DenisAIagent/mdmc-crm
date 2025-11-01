import CryptoJS from 'crypto-js'
import crypto from 'crypto'
import { logger } from './logger.js'

/**
 * Utilitaires de chiffrement AES-256 pour les données sensibles
 * Conforme RGPD avec audit trail complet
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
const ENCRYPTION_IV = process.env.ENCRYPTION_IV

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required and must be at least 32 characters')
}

if (!ENCRYPTION_IV) {
  throw new Error('ENCRYPTION_IV environment variable is required and must be exactly 16 bytes')
}

// Validation de la clé de chiffrement
if (ENCRYPTION_KEY.length < 32) {
  throw new Error('ENCRYPTION_KEY doit contenir au moins 32 caractères pour AES-256')
}

/**
 * Chiffre une chaîne de caractères avec AES-256-CBC
 * @param {string} text - Texte à chiffrer
 * @returns {string|null} - Texte chiffré en base64 ou null si erreur
 */
export const encrypt = (text) => {
  if (!text || typeof text !== 'string') {
    return text
  }

  try {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY.slice(0, 32), iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return iv.toString('hex') + ':' + encrypted
  } catch (error) {
    logger.error('Encryption operation failed', {
      operation: 'encrypt',
      timestamp: new Date().toISOString()
    })
    return null
  }
}

/**
 * Déchiffre une chaîne de caractères avec AES-256-CBC
 * @param {string} encryptedText - Texte chiffré en base64
 * @returns {string|null} - Texte déchiffré ou null si erreur
 */
export const decrypt = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') {
    return encryptedText
  }

  try {
    if (!encryptedText.includes(':')) {
      return encryptedText
    }

    const [ivHex, encrypted] = encryptedText.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY.slice(0, 32), iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (error) {
    logger.error('Decryption operation failed', {
      operation: 'decrypt',
      timestamp: new Date().toISOString()
    })
    return null
  }
}

/**
 * Chiffre un objet entier en préservant la structure
 * @param {Object} obj - Objet à chiffrer
 * @param {Array} fieldsToEncrypt - Champs à chiffrer
 * @returns {Object} - Objet avec champs chiffrés
 */
export const encryptObject = (obj, fieldsToEncrypt = []) => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = { ...obj }

  fieldsToEncrypt.forEach(field => {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = encrypt(result[field])
    }
  })

  return result
}

/**
 * Déchiffre un objet entier en préservant la structure
 * @param {Object} obj - Objet à déchiffrer
 * @param {Array} fieldsToDecrypt - Champs à déchiffrer
 * @returns {Object} - Objet avec champs déchiffrés
 */
export const decryptObject = (obj, fieldsToDecrypt = []) => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = { ...obj }

  fieldsToDecrypt.forEach(field => {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = decrypt(result[field])
    }
  })

  return result
}

/**
 * Génère un hash sécurisé pour les mots de passe
 * @param {string} password - Mot de passe en clair
 * @returns {Promise<string>} - Hash sécurisé
 */
export const hashPassword = async (password) => {
  if (!password) {
    throw new Error('Le mot de passe est requis')
  }

  try {
    const saltRounds = 12
    const bcrypt = await import('bcryptjs')
    const salt = await bcrypt.genSalt(saltRounds)
    return await bcrypt.hash(password, salt)
  } catch (error) {
    throw new Error('Erreur lors du hachage du mot de passe')
  }
}

/**
 * Vérifie un mot de passe contre son hash
 * @param {string} password - Mot de passe en clair
 * @param {string} hash - Hash stocké
 * @returns {Promise<boolean>} - True si valide
 */
export const verifyPassword = async (password, hash) => {
  if (!password || !hash) {
    return false
  }

  try {
    const bcrypt = await import('bcryptjs')
    return await bcrypt.compare(password, hash)
  } catch (error) {
    return false
  }
}

/**
 * Génère un token aléatoire sécurisé
 * @param {number} length - Longueur du token (défaut: 32)
 * @returns {string} - Token hexadécimal
 */
export const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex')
}

/**
 * Génère un hash SHA-256 d'une chaîne
 * @param {string} data - Données à hasher
 * @returns {string} - Hash SHA-256 en hexadécimal
 */
export const generateHash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Masque partiellement un email pour l'affichage
 * @param {string} email - Email à masquer
 * @returns {string} - Email masqué
 */
export const maskEmail = (email) => {
  if (!email || !email.includes('@')) {
    return email
  }

  const [localPart, domain] = email.split('@')
  const maskedLocal = localPart.slice(0, 2) + '*'.repeat(Math.max(0, localPart.length - 2))
  return `${maskedLocal}@${domain}`
}

/**
 * Masque partiellement un numéro de téléphone
 * @param {string} phone - Numéro à masquer
 * @returns {string} - Numéro masqué
 */
export const maskPhone = (phone) => {
  if (!phone || phone.length < 4) {
    return phone
  }

  const visible = phone.slice(-4)
  const masked = '*'.repeat(Math.max(0, phone.length - 4))
  return masked + visible
}

/**
 * Valide la force d'un mot de passe
 * @param {string} password - Mot de passe à valider
 * @returns {Object} - Résultat de validation avec score et critères
 */
export const validatePasswordStrength = (password) => {
  const result = {
    isValid: false,
    score: 0,
    criteria: {
      length: false,
      lowercase: false,
      uppercase: false,
      number: false,
      special: false
    },
    suggestions: []
  }

  if (!password) {
    result.suggestions.push('Le mot de passe est requis')
    return result
  }

  // Longueur minimale (8 caractères)
  if (password.length >= 8) {
    result.criteria.length = true
    result.score += 20
  } else {
    result.suggestions.push('Au moins 8 caractères')
  }

  // Lettre minuscule
  if (/[a-z]/.test(password)) {
    result.criteria.lowercase = true
    result.score += 20
  } else {
    result.suggestions.push('Au moins une lettre minuscule')
  }

  // Lettre majuscule
  if (/[A-Z]/.test(password)) {
    result.criteria.uppercase = true
    result.score += 20
  } else {
    result.suggestions.push('Au moins une lettre majuscule')
  }

  // Chiffre
  if (/\d/.test(password)) {
    result.criteria.number = true
    result.score += 20
  } else {
    result.suggestions.push('Au moins un chiffre')
  }

  // Caractère spécial
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    result.criteria.special = true
    result.score += 20
  } else {
    result.suggestions.push('Au moins un caractère spécial')
  }

  // Le mot de passe est valide si tous les critères sont remplis
  result.isValid = Object.values(result.criteria).every(criterion => criterion)

  return result
}

/**
 * Génère une clé API sécurisée
 * @param {string} prefix - Préfixe de la clé (ex: 'mdmc')
 * @returns {string} - Clé API sécurisée
 */
export const generateApiKey = (prefix = 'mdmc') => {
  const timestamp = Date.now().toString(36)
  const randomPart = crypto.randomBytes(16).toString('hex')
  const hash = crypto.createHash('sha256')
    .update(`${prefix}-${timestamp}-${randomPart}`)
    .digest('hex')
    .substring(0, 32)

  return `${prefix}_${timestamp}_${hash}`
}

/**
 * Champs sensibles par défaut à chiffrer
 */
export const SENSITIVE_FIELDS = [
  'email',
  'phone',
  'personalInfo',
  'bankDetails',
  'creditCard',
  'socialSecurityNumber',
  'apiKey',
  'secret',
  'token'
]

/**
 * Middleware pour chiffrer automatiquement les champs sensibles
 * @param {Object} data - Données à traiter
 * @param {Array} customFields - Champs supplémentaires à chiffrer
 * @returns {Object} - Données avec champs sensibles chiffrés
 */
export const autoEncrypt = (data, customFields = []) => {
  const fieldsToEncrypt = [...SENSITIVE_FIELDS, ...customFields]
  return encryptObject(data, fieldsToEncrypt)
}

/**
 * Middleware pour déchiffrer automatiquement les champs sensibles
 * @param {Object} data - Données à traiter
 * @param {Array} customFields - Champs supplémentaires à déchiffrer
 * @returns {Object} - Données avec champs sensibles déchiffrés
 */
export const autoDecrypt = (data, customFields = []) => {
  const fieldsToDecrypt = [...SENSITIVE_FIELDS, ...customFields]
  return decryptObject(data, fieldsToDecrypt)
}

export default {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  generateHash,
  maskEmail,
  maskPhone,
  validatePasswordStrength,
  generateApiKey,
  autoEncrypt,
  autoDecrypt,
  SENSITIVE_FIELDS
}