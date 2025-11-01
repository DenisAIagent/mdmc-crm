import winston from 'winston'
import path from 'path'

// Configuration des formats
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`
  })
)

// Configuration en développement
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`
  })
)

// Création du logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'mdmc-crm' },
  transports: [
    // Logs d'erreur
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Tous les logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  // Gestion des exceptions non capturées
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  // Gestion des rejections non capturées
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
})

// En développement, ajouter les logs console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: developmentFormat
  }))
}

// Créer le dossier logs s'il n'existe pas
import fs from 'fs'
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs')
}

// Fonction utilitaire pour logger les requêtes API
const logRequest = (req, res, next) => {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }

    if (res.statusCode >= 400) {
      logger.warn('Requête avec erreur', logData)
    } else {
      logger.info('Requête API', logData)
    }
  })

  next()
}

// Fonction pour logger les actions utilisateur (audit trail)
const logUserAction = (userId, action, details = {}) => {
  logger.info('Action utilisateur', {
    userId,
    action,
    details,
    timestamp: new Date().toISOString()
  })
}

// Fonction pour logger les erreurs de sécurité
const logSecurityEvent = (type, details, req = null) => {
  const securityLog = {
    type,
    details,
    timestamp: new Date().toISOString()
  }

  if (req) {
    securityLog.ip = req.ip
    securityLog.userAgent = req.get('User-Agent')
    securityLog.url = req.originalUrl
  }

  logger.warn('Événement de sécurité', securityLog)
}

export { logger, logRequest, logUserAction, logSecurityEvent }