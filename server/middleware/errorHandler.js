import { logger } from '../utils/logger.js'
import AuditLog from '../models/AuditLog.js'

// Middleware de gestion d'erreurs global
export const errorHandler = (err, req, res, next) => {
  let error = { ...err }
  error.message = err.message

  // Logger l'erreur sans données sensibles
  logger.error('Erreur serveur:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  })

  // Erreur de validation Mongoose
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ')
    error = {
      statusCode: 400,
      message
    }
  }

  // Erreur de clé dupliquée MongoDB
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0]
    const message = `${field} existe déjà`
    error = {
      statusCode: 409,
      message
    }
  }

  // Erreur ObjectId invalide Mongoose
  if (err.name === 'CastError') {
    const message = 'Ressource non trouvée'
    error = {
      statusCode: 404,
      message
    }
  }

  // Erreur JWT
  if (err.name === 'JsonWebTokenError') {
    const message = 'Token invalide'
    error = {
      statusCode: 401,
      message
    }
  }

  // Erreur JWT expiré
  if (err.name === 'TokenExpiredError') {
    const message = 'Token expiré'
    error = {
      statusCode: 401,
      message
    }
  }

  // Erreur de limite de taille
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'Fichier trop volumineux'
    error = {
      statusCode: 413,
      message
    }
  }

  // Erreur de type MIME
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Type de fichier non autorisé'
    error = {
      statusCode: 415,
      message
    }
  }

  // Logger l'erreur dans l'audit si utilisateur connecté
  if (req.user) {
    AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'system_error',
      resourceType: 'system',
      description: `Erreur serveur: ${error.message}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      severity: 'high',
      category: 'system',
      errorMessage: error.message,
      errorCode: err.code || err.name
    }).catch(auditErr => {
      logger.error('Erreur lors de la création du log d\'audit:', auditErr)
    })
  }

  // Réponse d'erreur
  const statusCode = error.statusCode || 500
  const message = error.message || 'Erreur serveur interne'

  res.status(statusCode).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack
    })
  })
}

// Middleware pour gérer les erreurs async
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// Middleware de gestion des erreurs 404
export const notFound = (req, res, next) => {
  const error = new Error(`Ressource non trouvée - ${req.originalUrl}`)
  res.status(404)
  next(error)
}

// Classes d'erreurs personnalisées
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true

    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400)
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Non authentifié') {
    super(message, 401)
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Non autorisé') {
    super(message, 403)
    this.name = 'AuthorizationError'
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Ressource non trouvée') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflit de données') {
    super(message, 409)
    this.name = 'ConflictError'
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Trop de requêtes') {
    super(message, 429)
    this.name = 'RateLimitError'
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporairement indisponible') {
    super(message, 503)
    this.name = 'ServiceUnavailableError'
  }
}

// Fonction utilitaire pour créer des erreurs
export const createError = (message, statusCode) => {
  return new AppError(message, statusCode)
}

// Fonction pour valider les données d'entrée
export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body)
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ')
      return next(new ValidationError(message))
    }
    next()
  }
}

// Fonction pour gérer les erreurs de base de données
export const handleDatabaseError = (error) => {
  if (error.name === 'MongoServerError') {
    switch (error.code) {
      case 11000:
        return new ConflictError('Données dupliquées')
      case 11001:
        return new ConflictError('Données dupliquées')
      default:
        return new AppError('Erreur de base de données', 500)
    }
  }

  if (error.name === 'MongoNetworkError') {
    return new ServiceUnavailableError('Base de données temporairement indisponible')
  }

  return new AppError(error.message, 500)
}

// Fonction pour gérer les erreurs d'API externes
export const handleExternalAPIError = (error, service) => {
  if (error.response) {
    const status = error.response.status
    const message = `Erreur ${service}: ${error.response.data?.message || error.message}`

    if (status >= 500) {
      return new ServiceUnavailableError(message)
    } else if (status === 429) {
      return new RateLimitError(message)
    } else if (status >= 400) {
      return new AppError(message, status)
    }
  }

  return new ServiceUnavailableError(`Service ${service} indisponible`)
}

export default {
  errorHandler,
  asyncHandler,
  notFound,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  createError,
  validateRequest,
  handleDatabaseError,
  handleExternalAPIError
}