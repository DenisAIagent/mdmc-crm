import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import { logger, logSecurityEvent } from '../utils/logger.js'

// Générer un token JWT
export const generateToken = (userId) => {
  const payload = {
    id: userId,
    iat: Math.floor(Date.now() / 1000),
    type: 'access'
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h',
    issuer: 'mdmc-crm',
    audience: 'mdmc-users',
    algorithm: 'HS256'
  })
}

// Générer un refresh token
export const generateRefreshToken = (userId) => {
  const payload = {
    id: userId,
    iat: Math.floor(Date.now() / 1000),
    type: 'refresh'
  }

  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
    issuer: 'mdmc-crm',
    audience: 'mdmc-users',
    algorithm: 'HS256'
  })
}

// Middleware d'authentification principal
export const authenticate = async (req, res, next) => {
  try {
    let token

    // Vérifier l'en-tête Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1]
    }
    // Vérifier les cookies (pour les requêtes web)
    else if (req.cookies?.authToken) {
      token = req.cookies.authToken
    }

    if (!token) {
      logSecurityEvent('access_denied', { reason: 'no_token' }, req)
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Token manquant.'
      })
    }

    try {
      // Vérifier et décoder le token
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'mdmc-crm',
        audience: 'mdmc-users',
        algorithms: ['HS256']
      })

      // Vérifier que c'est un access token
      if (decoded.type !== 'access') {
        throw new Error('Type de token invalide')
      }

      // Récupérer l'utilisateur
      const user = await User.findById(decoded.id).select('+password')

      if (!user) {
        logSecurityEvent('access_denied', {
          reason: 'user_not_found',
          userId: decoded.id
        }, req)
        return res.status(401).json({
          success: false,
          message: 'Token invalide.'
        })
      }

      // Vérifier si l'utilisateur est actif
      if (!user.isActive) {
        logSecurityEvent('access_denied', {
          reason: 'user_inactive',
          userId: user._id
        }, req)
        return res.status(401).json({
          success: false,
          message: 'Compte désactivé.'
        })
      }

      // Vérifier si l'utilisateur est verrouillé
      if (user.isLocked) {
        logSecurityEvent('access_denied', {
          reason: 'user_locked',
          userId: user._id,
          lockUntil: user.lockUntil
        }, req)
        return res.status(423).json({
          success: false,
          message: 'Compte temporairement verrouillé.'
        })
      }

      // Ajouter l'utilisateur à la requête
      req.user = user
      next()

    } catch (jwtError) {
      logSecurityEvent('access_denied', {
        reason: 'invalid_token',
        error: jwtError.message
      }, req)
      return res.status(401).json({
        success: false,
        message: 'Token invalide.'
      })
    }

  } catch (error) {
    logger.error('Erreur d\'authentification:', error)
    logSecurityEvent('access_denied', {
      reason: 'auth_error',
      error: error.message
    }, req)
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur d\'authentification.'
    })
  }
}

// Middleware d'autorisation par rôle
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Non authentifié.'
      })
    }

    if (!roles.includes(req.user.role)) {
      logSecurityEvent('access_denied', {
        reason: 'insufficient_role',
        userId: req.user._id,
        userRole: req.user.role,
        requiredRoles: roles
      }, req)

      // Logger l'audit
      AuditLog.logAction({
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.fullName,
        action: 'access_denied',
        resourceType: 'system',
        description: `Tentative d'accès avec rôle insuffisant (${req.user.role}). Rôles requis: ${roles.join(', ')}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        category: 'authorization'
      })

      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Permissions insuffisantes.'
      })
    }

    next()
  }
}

// Middleware d'autorisation par permission
export const authorizePermission = (resource, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Non authentifié.'
      })
    }

    // Admin a toutes les permissions
    if (req.user.role === 'admin') {
      return next()
    }

    // Vérifier la permission spécifique
    const hasPermission = req.user.permissions?.[resource]?.[action]

    if (!hasPermission) {
      logSecurityEvent('access_denied', {
        reason: 'insufficient_permission',
        userId: req.user._id,
        resource,
        action,
        userPermissions: req.user.permissions
      }, req)

      // Logger l'audit
      AuditLog.logAction({
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.fullName,
        action: 'access_denied',
        resourceType: 'system',
        description: `Tentative d'accès sans permission pour ${resource}.${action}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        category: 'authorization'
      })

      return res.status(403).json({
        success: false,
        message: `Accès refusé. Permission ${resource}.${action} requise.`
      })
    }

    next()
  }
}

// Middleware pour vérifier l'assignation (lead/campagne assigné à l'utilisateur)
export const authorizeAssignment = (resourceModel) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Accès refusé. Non authentifié.'
        })
      }

      // Admin peut accéder à tout
      if (req.user.role === 'admin') {
        return next()
      }

      const resourceId = req.params.id
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'ID de ressource manquant.'
        })
      }

      // Importer le modèle dynamiquement
      let Model
      if (resourceModel === 'Lead') {
        Model = (await import('../models/Lead.js')).default
      } else if (resourceModel === 'Campaign') {
        Model = (await import('../models/Campaign.js')).default
      } else {
        return res.status(400).json({
          success: false,
          message: 'Type de ressource invalide.'
        })
      }

      const resource = await Model.findById(resourceId)
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Ressource non trouvée.'
        })
      }

      // Vérifier l'assignation
      const assignedField = resourceModel === 'Lead' ? 'assignedTo' : 'managedBy'
      if (!resource[assignedField].equals(req.user._id)) {
        logSecurityEvent('access_denied', {
          reason: 'not_assigned',
          userId: req.user._id,
          resourceType: resourceModel,
          resourceId,
          assignedTo: resource[assignedField]
        }, req)

        return res.status(403).json({
          success: false,
          message: 'Accès refusé. Ressource non assignée.'
        })
      }

      // Ajouter la ressource à la requête
      req.resource = resource
      next()

    } catch (error) {
      logger.error('Erreur d\'autorisation d\'assignation:', error)
      return res.status(500).json({
        success: false,
        message: 'Erreur serveur d\'autorisation.'
      })
    }
  }
}

// Middleware pour vérifier l'équipe
export const authorizeTeam = (allowCrossTeam = false) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Non authentifié.'
      })
    }

    // Admin peut accéder à tout
    if (req.user.role === 'admin' || allowCrossTeam) {
      return next()
    }

    // Vérifier si la ressource appartient à la même équipe
    if (req.resource && req.resource.assignedTeam !== req.user.team) {
      logSecurityEvent('access_denied', {
        reason: 'cross_team_access',
        userId: req.user._id,
        userTeam: req.user.team,
        resourceTeam: req.resource.assignedTeam
      }, req)

      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Ressource d\'une autre équipe.'
      })
    }

    next()
  }
}

// Middleware optionnel (ne bloque pas si pas de token)
export const authenticateOptional = async (req, res, next) => {
  try {
    let token

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1]
    } else if (req.cookies?.authToken) {
      token = req.cookies.authToken
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          issuer: 'mdmc-crm',
          audience: 'mdmc-users',
          algorithms: ['HS256']
        })

        const user = await User.findById(decoded.id)
        if (user && user.isActive && !user.isLocked) {
          req.user = user
        }
      } catch (jwtError) {
        // Token invalide, mais on continue sans utilisateur
        logger.warn('Token optionnel invalide:', jwtError.message)
      }
    }

    next()
  } catch (error) {
    logger.error('Erreur d\'authentification optionnelle:', error)
    next() // Continue même en cas d'erreur
  }
}

// Middleware de vérification 2FA
export const require2FA = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Non authentifié.'
      })
    }

    // Vérifier si 2FA est activé pour l'utilisateur
    if (req.user.twoFactorEnabled) {
      const twoFactorToken = req.headers['x-2fa-token']

      if (!twoFactorToken) {
        return res.status(401).json({
          success: false,
          message: 'Token 2FA requis.',
          requires2FA: true
        })
      }

      // Ici on vérifierait le token TOTP
      // Pour l'exemple, on accepte le token "123456"
      if (twoFactorToken !== '123456') {
        logSecurityEvent('access_denied', {
          reason: 'invalid_2fa',
          userId: req.user._id
        }, req)

        return res.status(401).json({
          success: false,
          message: 'Token 2FA invalide.'
        })
      }
    }

    next()
  } catch (error) {
    logger.error('Erreur de vérification 2FA:', error)
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur 2FA.'
    })
  }
}

export default {
  authenticate,
  authorize,
  authorizePermission,
  authorizeAssignment,
  authorizeTeam,
  authenticateOptional,
  require2FA,
  generateToken,
  generateRefreshToken
}