const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite chaque IP à 100 requêtes par fenêtre
  message: {
    error: 'Trop de requêtes. Réessayez dans 15 minutes.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Trop de requêtes. Réessayez dans 15 minutes.',
      retryAfter: Math.round(req.rateLimit.resetTime / 1000)
    })
  },
  skip: (req) => {
    // Ignorer le rate limiting pour les health checks
    return req.path === '/health'
  }
}

// Configuration pour l'authentification (très strict)
const authRateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives de connexion max
  message: {
    error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Ne compte que les échecs
}

// Configuration spécifique pour les API sensibles
const strictRateLimit = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requêtes max
  message: {
    error: 'Trop de requêtes sur cette API sensible. Réessayez dans 5 minutes.'
  }
}

// Configuration pour les endpoints de données critiques
const criticalDataRateLimit = {
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requêtes par minute
  message: {
    error: 'Limite de requêtes atteinte pour les données critiques.'
  }
}

// Configuration pour les uploads
const uploadRateLimit = {
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 50, // 50 uploads par heure
  message: {
    error: 'Trop d\'uploads. Réessayez dans 1 heure.'
  }
}

// Configuration pour les opérations de modification de profil
const profileRateLimit = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 modifications max
  message: {
    error: 'Trop de modifications de profil. Réessayez dans 10 minutes.'
  }
}

// Configuration pour les reset de mot de passe
const passwordResetRateLimit = {
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 3, // 3 demandes de reset par heure
  message: {
    error: 'Trop de demandes de reset. Réessayez dans 1 heure.'
  }
}

export {
  rateLimitConfig,
  authRateLimit,
  strictRateLimit,
  criticalDataRateLimit,
  uploadRateLimit,
  profileRateLimit,
  passwordResetRateLimit
}