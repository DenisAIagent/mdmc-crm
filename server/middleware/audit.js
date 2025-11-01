import AuditLog from '../models/AuditLog.js'
import { logger } from '../utils/logger.js'

// Middleware pour logger automatiquement les actions
export const auditLogger = (action, resourceType, options = {}) => {
  return async (req, res, next) => {
    // Sauvegarder la méthode originale de res.json
    const originalJson = res.json.bind(res)

    // Override res.json pour capturer la réponse
    res.json = function(data) {
      // Déterminer si l'action a réussi
      const success = res.statusCode < 400

      // Préparer les données d'audit
      const auditData = {
        userId: req.user?._id,
        userEmail: req.user?.email || 'system',
        userName: req.user?.fullName || 'System',
        action,
        resourceType,
        description: options.description || `${action} ${resourceType}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success,
        category: options.category || 'data_access',
        severity: options.severity || (success ? 'low' : 'medium')
      }

      // Ajouter l'ID de la ressource si disponible
      if (req.params.id) {
        auditData.resourceId = req.params.id
      }

      // Ajouter le nom de la ressource si disponible
      if (req.resource?.name || req.resource?.artistName || req.resource?.email) {
        auditData.resourceName = req.resource.name || req.resource.artistName || req.resource.email
      }

      // Ajouter les champs modifiés pour les updates
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (req.originalData && req.body) {
          const changedFields = Object.keys(req.body).filter(key => {
            return JSON.stringify(req.originalData[key]) !== JSON.stringify(req.body[key])
          })
          auditData.changedFields = changedFields
          auditData.previousData = req.originalData
          auditData.newData = req.body
        }
      }

      // Ajouter des détails d'erreur si échec
      if (!success && data.error) {
        auditData.errorMessage = data.error
        auditData.errorCode = data.code
      }

      // Logger l'audit de manière asynchrone
      AuditLog.logAction(auditData).catch(error => {
        logger.error('Erreur lors de la création du log d\'audit:', error)
      })

      // Appeler la méthode originale
      return originalJson(data)
    }

    next()
  }
}

// Middleware pour capturer les données avant modification
export const captureOriginalData = (Model) => {
  return async (req, res, next) => {
    try {
      if (req.params.id && (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE')) {
        const resource = await Model.findById(req.params.id)
        if (resource) {
          req.originalData = resource.toObject()
          req.resource = resource
        }
      }
      next()
    } catch (error) {
      logger.error('Erreur lors de la capture des données originales:', error)
      next()
    }
  }
}

// Middleware spécialisé pour les actions sensibles
export const auditSensitiveAction = (action, description) => {
  return auditLogger(action, 'system', {
    description,
    category: 'security',
    severity: 'high'
  })
}

// Middleware pour logger les connexions
export const auditLogin = async (req, res, next) => {
  const originalJson = res.json.bind(res)

  res.json = function(data) {
    const success = res.statusCode < 400
    const action = success ? 'user_login' : 'user_login_failed'

    const auditData = {
      userId: success ? data.user?.id : null,
      userEmail: req.body.email || 'unknown',
      userName: success ? data.user?.fullName : 'Unknown',
      action,
      resourceType: 'auth',
      description: success ? 'Connexion réussie' : 'Échec de connexion',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success,
      category: 'authentication',
      severity: success ? 'low' : 'medium'
    }

    if (!success && data.error) {
      auditData.errorMessage = data.error
    }

    AuditLog.logAction(auditData).catch(error => {
      logger.error('Erreur lors de la création du log d\'audit de connexion:', error)
    })

    return originalJson(data)
  }

  next()
}

// Middleware pour logger les déconnexions
export const auditLogout = async (req, res, next) => {
  const auditData = {
    userId: req.user._id,
    userEmail: req.user.email,
    userName: req.user.fullName,
    action: 'user_logout',
    resourceType: 'user',
    description: 'Déconnexion',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    requestUrl: req.originalUrl,
    requestMethod: req.method,
    success: true,
    category: 'authentication',
    severity: 'low'
  }

  AuditLog.logAction(auditData).catch(error => {
    logger.error('Erreur lors de la création du log d\'audit de déconnexion:', error)
  })

  next()
}

// Middleware pour logger les exports de données
export const auditDataExport = (exportType, description) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)

    const logExport = function(data) {
      const success = res.statusCode < 400

      const auditData = {
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.fullName,
        action: 'data_exported',
        resourceType: 'system',
        description: `Export ${exportType}: ${description}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success,
        category: 'data_access',
        severity: 'medium',
        gdprRelevant: true
      }

      // Ajouter des métadonnées sur l'export
      if (success) {
        auditData.newData = {
          exportType,
          recordCount: Array.isArray(data) ? data.length : 1,
          filters: req.query
        }
      }

      AuditLog.logAction(auditData).catch(error => {
        logger.error('Erreur lors de la création du log d\'audit d\'export:', error)
      })
    }

    res.json = function(data) {
      logExport(data)
      return originalJson(data)
    }

    res.send = function(data) {
      logExport(data)
      return originalSend(data)
    }

    next()
  }
}

// Middleware pour logger les changements de statut
export const auditStatusChange = (resourceType) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res)

    res.json = function(data) {
      const success = res.statusCode < 400

      if (success && req.originalData && req.body.status && req.originalData.status !== req.body.status) {
        const auditData = {
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.fullName,
          action: `${resourceType.toLowerCase()}_status_changed`,
          resourceType,
          resourceId: req.params.id,
          resourceName: req.originalData.name || req.originalData.artistName,
          description: `Statut changé de "${req.originalData.status}" vers "${req.body.status}"`,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          requestUrl: req.originalUrl,
          requestMethod: req.method,
          success: true,
          category: 'data_modification',
          severity: 'medium',
          previousData: { status: req.originalData.status },
          newData: { status: req.body.status },
          changedFields: ['status']
        }

        AuditLog.logAction(auditData).catch(error => {
          logger.error('Erreur lors de la création du log d\'audit de changement de statut:', error)
        })
      }

      return originalJson(data)
    }

    next()
  }
}

// Middleware pour logger les assignations
export const auditAssignment = (resourceType) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res)

    res.json = function(data) {
      const success = res.statusCode < 400

      if (success && req.originalData && req.body.assignedTo &&
          req.originalData.assignedTo?.toString() !== req.body.assignedTo) {

        const auditData = {
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.fullName,
          action: `${resourceType.toLowerCase()}_assigned`,
          resourceType,
          resourceId: req.params.id,
          resourceName: req.originalData.name || req.originalData.artistName,
          description: `${resourceType} réassigné`,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          requestUrl: req.originalUrl,
          requestMethod: req.method,
          success: true,
          category: 'data_modification',
          severity: 'medium',
          previousData: { assignedTo: req.originalData.assignedTo },
          newData: { assignedTo: req.body.assignedTo },
          changedFields: ['assignedTo']
        }

        AuditLog.logAction(auditData).catch(error => {
          logger.error('Erreur lors de la création du log d\'audit d\'assignation:', error)
        })
      }

      return originalJson(data)
    }

    next()
  }
}

// Middleware pour les actions GDPR
export const auditGDPRAction = (action, description) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res)

    res.json = function(data) {
      const success = res.statusCode < 400

      const auditData = {
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.fullName,
        action,
        resourceType: 'system',
        description,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success,
        category: 'data_access',
        severity: 'high',
        gdprRelevant: true,
        dataSubject: req.body.email || req.params.email
      }

      AuditLog.logAction(auditData).catch(error => {
        logger.error('Erreur lors de la création du log d\'audit GDPR:', error)
      })

      return originalJson(data)
    }

    next()
  }
}

export default {
  auditLogger,
  captureOriginalData,
  auditSensitiveAction,
  auditLogin,
  auditLogout,
  auditDataExport,
  auditStatusChange,
  auditAssignment,
  auditGDPRAction
}