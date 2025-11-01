import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { logger, logSecurityEvent } from '../utils/logger.js'
import AuditLog from '../models/AuditLog.js'

// Middleware de protection CSRF
export const csrfProtection = (req, res, next) => {
  // Ignorer pour les GET et OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next()
  }

  // Ignorer pour les requêtes API avec token Bearer
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return next()
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf

  if (!token) {
    logSecurityEvent('csrf_token_missing', {
      url: req.originalUrl,
      method: req.method
    }, req)

    return res.status(403).json({
      success: false,
      message: 'Token CSRF manquant'
    })
  }

  // Vérifier le token CSRF (implémentation simplifiée)
  const expectedToken = req.session?.csrfToken || req.cookies?.csrfToken

  if (token !== expectedToken) {
    logSecurityEvent('csrf_token_invalid', {
      provided: token,
      expected: expectedToken
    }, req)

    return res.status(403).json({
      success: false,
      message: 'Token CSRF invalide'
    })
  }

  next()
}

// Middleware de détection d'activité suspecte
export const detectSuspiciousActivity = async (req, res, next) => {
  try {
    const clientIP = req.ip
    const userAgent = req.get('User-Agent')
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    // Vérifier les tentatives de connexion échouées récentes
    const recentFailures = await AuditLog.countDocuments({
      action: 'user_login_failed',
      ipAddress: clientIP,
      timestamp: { $gte: oneHourAgo },
      success: false
    })

    // Bloquer après 5 échecs en 1 heure
    if (recentFailures >= 5) {
      logSecurityEvent('suspicious_login_attempts', {
        ip: clientIP,
        failures: recentFailures,
        timeframe: '1 hour'
      }, req)

      return res.status(429).json({
        success: false,
        message: 'Trop de tentatives de connexion échouées. Réessayez plus tard.'
      })
    }

    // Détecter les changements d'User-Agent suspects
    if (req.user) {
      const recentLogins = await AuditLog.find({
        userId: req.user._id,
        action: 'user_login',
        timestamp: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        success: true
      }).limit(5)

      const userAgents = recentLogins.map(log => log.userAgent).filter(Boolean)
      if (userAgents.length > 0 && !userAgents.includes(userAgent)) {
        logSecurityEvent('user_agent_change', {
          userId: req.user._id,
          newUserAgent: userAgent,
          recentUserAgents: userAgents
        }, req)

        // Optionnel: forcer une re-authentification
        // return res.status(401).json({
        //   success: false,
        //   message: 'Nouvelle session détectée. Veuillez vous reconnecter.'
        // })
      }
    }

    // Détecter les requêtes anormalement rapides (possible bot)
    const rapidRequests = await AuditLog.countDocuments({
      ipAddress: clientIP,
      timestamp: { $gte: new Date(now.getTime() - 60 * 1000) } // 1 minute
    })

    if (rapidRequests > 60) { // Plus de 60 requêtes par minute
      logSecurityEvent('rapid_requests', {
        ip: clientIP,
        requests: rapidRequests,
        timeframe: '1 minute'
      }, req)

      return res.status(429).json({
        success: false,
        message: 'Requêtes trop rapides. Ralentissez.'
      })
    }

    next()
  } catch (error) {
    logger.error('Erreur lors de la détection d\'activité suspecte:', error)
    next() // Continuer en cas d'erreur pour ne pas bloquer l'application
  }
}

// Middleware de validation des entrées
export const sanitizeInput = (req, res, next) => {
  // Fonction récursive pour nettoyer les objets
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Supprimer les caractères de contrôle et scripts potentiels
      return obj
        .replace(/[\x00-\x1F\x7F]/g, '') // Caractères de contrôle
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Scripts
        .trim()
    } else if (Array.isArray(obj)) {
      return obj.map(sanitize)
    } else if (obj && typeof obj === 'object') {
      const sanitized = {}
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value)
      }
      return sanitized
    }
    return obj
  }

  // Nettoyer les données d'entrée
  if (req.body) {
    req.body = sanitize(req.body)
  }
  if (req.query) {
    req.query = sanitize(req.query)
  }
  if (req.params) {
    req.params = sanitize(req.params)
  }

  next()
}

// Middleware de protection contre l'énumération d'utilisateurs
export const preventUserEnumeration = (req, res, next) => {
  const originalJson = res.json.bind(res)

  res.json = function(data) {
    // Pour les erreurs d'authentification, retourner un message générique
    if (res.statusCode === 401 || res.statusCode === 404) {
      if (req.originalUrl.includes('/login') || req.originalUrl.includes('/forgot-password')) {
        return originalJson({
          success: false,
          message: 'Identifiants incorrects'
        })
      }
    }

    return originalJson(data)
  }

  next()
}

// Rate limiter spécialisé pour les actions sensibles
export const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 tentatives maximum
  message: {
    success: false,
    message: 'Trop de tentatives d\'actions sensibles. Réessayez dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent('rate_limit_exceeded', {
      action: 'sensitive_action',
      limit: '3 per 15 minutes'
    }, req)

    res.status(429).json({
      success: false,
      message: 'Trop de tentatives d\'actions sensibles. Réessayez dans 15 minutes.'
    })
  }
})

// Middleware de protection contre les attaques de timing
export const timingAttackProtection = (req, res, next) => {
  const startTime = process.hrtime()

  const originalJson = res.json.bind(res)

  res.json = function(data) {
    const [seconds, nanoseconds] = process.hrtime(startTime)
    const responseTime = seconds * 1000 + nanoseconds / 1000000

    // Ajouter un délai minimum pour masquer les différences de timing
    const minDelay = 100 // 100ms minimum
    const delay = Math.max(0, minDelay - responseTime)

    setTimeout(() => {
      originalJson(data)
    }, delay)
  }

  next()
}

// Middleware de protection des en-têtes sensibles
export const protectSensitiveHeaders = (req, res, next) => {
  // Supprimer les en-têtes potentiellement sensibles
  delete req.headers['x-forwarded-for']
  delete req.headers['x-real-ip']

  // Ajouter des en-têtes de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  next()
}

// Middleware de vérification d'intégrité des données
export const verifyDataIntegrity = (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const signature = req.headers['x-data-signature']

    if (process.env.REQUIRE_DATA_SIGNATURE === 'true' && !signature) {
      logSecurityEvent('missing_data_signature', {
        method: req.method,
        url: req.originalUrl
      }, req)

      return res.status(400).json({
        success: false,
        message: 'Signature de données requise'
      })
    }

    if (signature) {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.DATA_SIGNATURE_SECRET || 'default-secret')
        .update(JSON.stringify(req.body))
        .digest('hex')

      if (signature !== expectedSignature) {
        logSecurityEvent('invalid_data_signature', {
          provided: signature,
          expected: expectedSignature
        }, req)

        return res.status(400).json({
          success: false,
          message: 'Signature de données invalide'
        })
      }
    }
  }

  next()
}

// Middleware de protection contre les attaques par déni de service
export const dosProtection = (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0')
  const maxSize = 10 * 1024 * 1024 // 10MB

  if (contentLength > maxSize) {
    logSecurityEvent('oversized_request', {
      contentLength,
      maxSize,
      url: req.originalUrl
    }, req)

    return res.status(413).json({
      success: false,
      message: 'Requête trop volumineuse'
    })
  }

  // Limiter la complexité des requêtes de recherche
  if (req.query.search && req.query.search.length > 1000) {
    logSecurityEvent('complex_search_query', {
      queryLength: req.query.search.length,
      query: req.query.search.substring(0, 100) + '...'
    }, req)

    return res.status(400).json({
      success: false,
      message: 'Requête de recherche trop complexe'
    })
  }

  next()
}

// Middleware de géolocalisation et détection VPN/Proxy
export const geoLocationCheck = async (req, res, next) => {
  try {
    const clientIP = req.ip

    // Skip pour les IPs locales
    if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP.startsWith('192.168.')) {
      return next()
    }

    // Ici on pourrait intégrer un service de géolocalisation
    // comme MaxMind GeoIP2 ou ipinfo.io

    // Pour l'exemple, on simule une vérification
    const suspiciousCountries = ['CN', 'RU', 'KP'] // Exemple de pays à surveiller
    const userCountry = req.headers['cf-ipcountry'] // Cloudflare header

    if (suspiciousCountries.includes(userCountry)) {
      logSecurityEvent('suspicious_location', {
        ip: clientIP,
        country: userCountry,
        url: req.originalUrl
      }, req)

      // Optionnel: bloquer ou demander verification supplémentaire
      // return res.status(403).json({
      //   success: false,
      //   message: 'Accès restreint depuis cette localisation'
      // })
    }

    next()
  } catch (error) {
    logger.error('Erreur lors de la vérification géolocalisation:', error)
    next() // Continuer en cas d'erreur
  }
}

export default {
  csrfProtection,
  detectSuspiciousActivity,
  sanitizeInput,
  preventUserEnumeration,
  sensitiveActionLimiter,
  timingAttackProtection,
  protectSensitiveHeaders,
  verifyDataIntegrity,
  dosProtection,
  geoLocationCheck
}