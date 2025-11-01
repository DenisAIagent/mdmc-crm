import joi from 'joi'
import DOMPurify from 'isomorphic-dompurify'
import validator from 'validator'
import { logger } from '../utils/logger.js'
import { ValidationError } from './errorHandler.js'

/**
 * Middleware de validation et sanitisation des entrées
 * Sécurise contre XSS, injection NoSQL, et autres vulnérabilités
 */

// Schemas de validation Joi
export const validationSchemas = {
  // Validation pour l'authentification
  login: joi.object({
    email: joi.string().email().required().max(255),
    password: joi.string().min(8).max(128).required(),
    rememberMe: joi.boolean().default(false)
  }),

  // Validation pour l'inscription
  register: joi.object({
    email: joi.string().email().required().max(255),
    password: joi.string().min(8).max(128).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .message('Le mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial'),
    fullName: joi.string().min(2).max(100).required()
      .pattern(/^[a-zA-ZÀ-ÿ\s\-']+$/)
      .message('Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes'),
    role: joi.string().valid('user', 'manager', 'admin').default('user'),
    team: joi.string().valid('youtube', 'meta', 'tiktok', 'admin').required()
  }),

  // Validation pour les leads
  lead: joi.object({
    artistName: joi.string().min(1).max(200).required()
      .pattern(/^[a-zA-Z0-9À-ÿ\s\-'&.]+$/)
      .message('Nom d\'artiste invalide'),
    email: joi.string().email().max(255),
    phone: joi.string().pattern(/^[\+]?[1-9][\d\s\-\(\)]{7,15}$/).allow(''),
    platform: joi.string().valid('YouTube', 'Spotify', 'Meta', 'TikTok').required(),
    budget: joi.number().min(0).max(1000000),
    status: joi.string().valid('nouveau', 'contacté', 'qualifié', 'proposition', 'négociation', 'fermé-gagné', 'fermé-perdu').default('nouveau'),
    notes: joi.string().max(2000).allow(''),
    tags: joi.array().items(joi.string().max(50)).max(10),
    socialLinks: joi.object({
      youtube: joi.string().uri().allow(''),
      spotify: joi.string().uri().allow(''),
      instagram: joi.string().uri().allow(''),
      tiktok: joi.string().uri().allow(''),
      facebook: joi.string().uri().allow('')
    })
  }),

  // Validation pour les campagnes
  campaign: joi.object({
    name: joi.string().min(3).max(200).required()
      .pattern(/^[a-zA-Z0-9À-ÿ\s\-'&.]+$/)
      .message('Nom de campagne invalide'),
    leadId: joi.string().hex().length(24).required(),
    platform: joi.string().valid('YouTube', 'Spotify', 'Meta', 'TikTok').required(),
    budget: joi.number().min(0).max(1000000).required(),
    startDate: joi.date().min('now').required(),
    endDate: joi.date().greater(joi.ref('startDate')).required(),
    objectives: joi.array().items(joi.string().max(100)).min(1).max(5),
    targetAudience: joi.string().max(500),
    creativeSpecs: joi.object({
      format: joi.string().max(50),
      duration: joi.number().min(1).max(300),
      dimensions: joi.string().pattern(/^\d+x\d+$/)
    }),
    kpis: joi.object({
      reach: joi.number().min(0),
      engagement: joi.number().min(0),
      conversions: joi.number().min(0),
      cpm: joi.number().min(0),
      ctr: joi.number().min(0).max(100)
    })
  }),

  // Validation pour les notes
  note: joi.object({
    content: joi.string().min(1).max(2000).required(),
    type: joi.string().valid('call', 'email', 'meeting', 'general').default('general'),
    isPrivate: joi.boolean().default(false)
  }),

  // Validation pour la mise à jour de profil
  profileUpdate: joi.object({
    fullName: joi.string().min(2).max(100)
      .pattern(/^[a-zA-ZÀ-ÿ\s\-']+$/)
      .message('Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes'),
    phone: joi.string().pattern(/^[\+]?[1-9][\d\s\-\(\)]{7,15}$/).allow(''),
    avatar: joi.string().uri().allow(''),
    preferences: joi.object({
      notifications: joi.boolean(),
      emailAlerts: joi.boolean(),
      theme: joi.string().valid('light', 'dark'),
      language: joi.string().valid('fr', 'en')
    })
  })
}

/**
 * Sanitise une chaîne contre XSS
 */
export const sanitizeString = (str) => {
  if (typeof str !== 'string') return str

  // Nettoyer les balises HTML dangereuses
  const cleaned = DOMPurify.sanitize(str, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  })

  // Échapper les caractères spéciaux pour éviter l'injection
  return validator.escape(cleaned)
}

/**
 * Sanitise récursivement un objet
 */
export const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    return sanitizeString(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject)
  }

  if (typeof obj === 'object') {
    const sanitized = {}
    for (const [key, value] of Object.entries(obj)) {
      // Sanitiser aussi les clés
      const cleanKey = sanitizeString(key)
      sanitized[cleanKey] = sanitizeObject(value)
    }
    return sanitized
  }

  return obj
}

/**
 * Middleware de validation avec schema Joi
 */
export const validateSchema = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const dataToValidate = source === 'body' ? req.body :
                           source === 'params' ? req.params :
                           source === 'query' ? req.query : req[source]

      const { error, value } = schema.validate(dataToValidate, {
        stripUnknown: true, // Supprime les champs non définis
        abortEarly: false   // Retourne toutes les erreurs
      })

      if (error) {
        const errorMessage = error.details
          .map(detail => detail.message)
          .join('; ')

        logger.warn('Validation failed:', {
          endpoint: req.originalUrl,
          method: req.method,
          errors: error.details,
          userId: req.user?.id
        })

        throw new ValidationError(errorMessage)
      }

      // Remplacer les données par les valeurs validées et nettoyées
      if (source === 'body') req.body = value
      else if (source === 'params') req.params = value
      else if (source === 'query') req.query = value
      else req[source] = value

      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Middleware de sanitisation générale
 */
export const sanitizeInput = (req, res, next) => {
  try {
    // Sanitiser le body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body)
    }

    // Sanitiser les paramètres de query
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query)
    }

    // Sanitiser les paramètres d'URL
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params)
    }

    next()
  } catch (error) {
    logger.error('Erreur de sanitisation:', error)
    next(error)
  }
}

/**
 * Validation spécifique pour les IDs MongoDB
 */
export const validateMongoId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName]

    if (!validator.isMongoId(id)) {
      throw new ValidationError(`ID ${paramName} invalide`)
    }

    next()
  }
}

/**
 * Middleware anti-injection NoSQL
 */
export const preventNoSQLInjection = (req, res, next) => {
  try {
    const checkForInjection = (obj, path = '') => {
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key

          // Détecter les opérateurs MongoDB suspects
          if (key.startsWith('$') || key.includes('.')) {
            logger.warn('Tentative d\'injection NoSQL détectée:', {
              path: currentPath,
              key,
              value,
              ip: req.ip,
              userAgent: req.get('User-Agent'),
              userId: req.user?.id
            })

            throw new ValidationError('Opérateurs de base de données non autorisés')
          }

          // Vérification récursive
          if (typeof value === 'object' && value !== null) {
            checkForInjection(value, currentPath)
          }
        }
      }
    }

    // Vérifier body, query et params
    checkForInjection(req.body, 'body')
    checkForInjection(req.query, 'query')
    checkForInjection(req.params, 'params')

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Middleware de limitation de taille des données
 */
export const limitDataSize = (maxSize = 1024 * 1024) => { // 1MB par défaut
  return (req, res, next) => {
    const dataSize = JSON.stringify(req.body || {}).length

    if (dataSize > maxSize) {
      throw new ValidationError(`Données trop volumineuses (${dataSize} bytes, max: ${maxSize})`)
    }

    next()
  }
}

/**
 * Middleware de validation des fichiers uploadés
 */
export const validateFileUpload = (options = {}) => {
  const {
    maxSize = 5 * 1024 * 1024, // 5MB
    allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxFiles = 1
  } = options

  return (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return next()
    }

    if (req.files.length > maxFiles) {
      throw new ValidationError(`Trop de fichiers (max: ${maxFiles})`)
    }

    for (const file of req.files) {
      if (file.size > maxSize) {
        throw new ValidationError(`Fichier trop volumineux: ${file.originalname} (max: ${maxSize} bytes)`)
      }

      if (!allowedTypes.includes(file.mimetype)) {
        throw new ValidationError(`Type de fichier non autorisé: ${file.mimetype}`)
      }

      // Validation supplémentaire du nom de fichier
      if (!/^[a-zA-Z0-9._-]+$/.test(file.originalname)) {
        throw new ValidationError(`Nom de fichier invalide: ${file.originalname}`)
      }
    }

    next()
  }
}

export default {
  validationSchemas,
  validateSchema,
  sanitizeInput,
  sanitizeString,
  sanitizeObject,
  validateMongoId,
  preventNoSQLInjection,
  limitDataSize,
  validateFileUpload
}