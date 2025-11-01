import joi from 'joi'
import { logger } from '../utils/logger.js'

/**
 * Validation des variables d'environnement obligatoires
 * Sécurise la configuration avant le démarrage de l'application
 */

const envSchema = joi.object({
  // Variables Node.js
  NODE_ENV: joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Configuration du serveur
  PORT: joi.number()
    .integer()
    .min(1000)
    .max(65535)
    .default(5000),

  // Configuration MongoDB
  MONGODB_URI: joi.string()
    .uri({ scheme: 'mongodb' })
    .required()
    .description('URI de connexion MongoDB requise'),

  // Secrets de chiffrement (CRITIQUES)
  ENCRYPTION_KEY: joi.string()
    .min(32)
    .required()
    .pattern(/^[A-Za-z0-9+/=]+$/)
    .description('Clé de chiffrement AES-256 (32+ caractères alphanumériques)'),

  ENCRYPTION_IV: joi.string()
    .length(16)
    .required()
    .pattern(/^[A-Za-z0-9+/=]+$/)
    .description('Vecteur d\'initialisation AES (exactement 16 caractères)'),

  // Secrets JWT (CRITIQUES)
  JWT_SECRET: joi.string()
    .min(64)
    .required()
    .pattern(/^[A-Za-z0-9+/=!@#$%^&*()_+-=\[\]{}|;:,.<>?]+$/)
    .description('Secret JWT pour tokens d\'accès (64+ caractères complexes)'),

  JWT_REFRESH_SECRET: joi.string()
    .min(64)
    .required()
    .pattern(/^[A-Za-z0-9+/=!@#$%^&*()_+-=\[\]{}|;:,.<>?]+$/)
    .description('Secret JWT pour refresh tokens (64+ caractères complexes)'),

  // Durées de vie des tokens
  JWT_EXPIRE: joi.string()
    .pattern(/^(\d+[smhd]|\d+)$/)
    .default('24h')
    .description('Durée de vie des tokens JWT (ex: 24h, 30m, 7d)'),

  JWT_REFRESH_EXPIRE: joi.string()
    .pattern(/^(\d+[smhd]|\d+)$/)
    .default('7d')
    .description('Durée de vie des refresh tokens'),

  // Configuration email (pour notifications)
  SMTP_HOST: joi.string()
    .hostname()
    .when('NODE_ENV', {
      is: 'production',
      then: joi.required(),
      otherwise: joi.optional()
    }),

  SMTP_PORT: joi.number()
    .integer()
    .min(1)
    .max(65535)
    .default(587),

  SMTP_USER: joi.string()
    .email()
    .when('NODE_ENV', {
      is: 'production',
      then: joi.required(),
      otherwise: joi.optional()
    }),

  SMTP_PASS: joi.string()
    .min(8)
    .when('NODE_ENV', {
      is: 'production',
      then: joi.required(),
      otherwise: joi.optional()
    }),

  // Configuration Redis (pour sessions/cache)
  REDIS_URL: joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .when('NODE_ENV', {
      is: 'production',
      then: joi.required(),
      otherwise: joi.optional()
    }),

  // Configuration CORS
  CORS_ORIGIN: joi.alternatives()
    .try(
      joi.string().uri(),
      joi.array().items(joi.string().uri()),
      joi.boolean().valid(true)
    )
    .default('*'),

  // Configuration rate limiting
  RATE_LIMIT_WINDOW_MS: joi.number()
    .integer()
    .min(60000) // Minimum 1 minute
    .default(15 * 60 * 1000), // 15 minutes

  RATE_LIMIT_MAX_REQUESTS: joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),

  // Configuration de sécurité
  BCRYPT_ROUNDS: joi.number()
    .integer()
    .min(10)
    .max(20)
    .default(12),

  SESSION_SECRET: joi.string()
    .min(32)
    .required()
    .description('Secret pour les sessions (32+ caractères)'),

  // Configuration des logs
  LOG_LEVEL: joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),

  LOG_FILE_ENABLED: joi.boolean()
    .default(false),

  // Configuration de monitoring
  SENTRY_DSN: joi.string()
    .uri()
    .when('NODE_ENV', {
      is: 'production',
      then: joi.optional(),
      otherwise: joi.optional()
    }),

  // Configuration des API externes
  GOOGLE_CLIENT_ID: joi.string()
    .optional(),

  GOOGLE_CLIENT_SECRET: joi.string()
    .optional(),

  META_APP_ID: joi.string()
    .optional(),

  META_APP_SECRET: joi.string()
    .optional(),

  TIKTOK_CLIENT_ID: joi.string()
    .optional(),

  TIKTOK_CLIENT_SECRET: joi.string()
    .optional(),

  // Configuration de stockage de fichiers
  AWS_ACCESS_KEY_ID: joi.string()
    .optional(),

  AWS_SECRET_ACCESS_KEY: joi.string()
    .optional(),

  AWS_REGION: joi.string()
    .default('eu-west-1'),

  S3_BUCKET_NAME: joi.string()
    .optional(),

  // Configuration de sécurité avancée
  SECURITY_HEADERS_ENABLED: joi.boolean()
    .default(true),

  HTTPS_ONLY: joi.boolean()
    .when('NODE_ENV', {
      is: 'production',
      then: joi.default(true),
      otherwise: joi.default(false)
    }),

  // Configuration de base de données
  DB_MAX_POOL_SIZE: joi.number()
    .integer()
    .min(5)
    .max(100)
    .default(20),

  DB_MIN_POOL_SIZE: joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(5)

}).unknown() // Permet d'autres variables non définies

/**
 * Valide les variables d'environnement au démarrage
 */
export const validateEnvironment = () => {
  logger.info('🔍 Validation des variables d\'environnement...')

  const { error, value: validatedEnv } = envSchema.validate(process.env, {
    stripUnknown: false,
    abortEarly: false
  })

  if (error) {
    logger.error('❌ Erreurs de configuration détectées:')

    error.details.forEach((detail, index) => {
      logger.error(`   ${index + 1}. ${detail.message}`)

      if (detail.context?.key) {
        logger.error(`      Variable: ${detail.context.key}`)
        logger.error(`      Valeur actuelle: ${process.env[detail.context.key] ? '[DÉFINIE]' : '[NON DÉFINIE]'}`)
      }
    })

    logger.error('\n📋 Variables d\'environnement requises:')
    logger.error('   - MONGODB_URI: URI de connexion MongoDB')
    logger.error('   - ENCRYPTION_KEY: Clé de chiffrement (32+ caractères)')
    logger.error('   - ENCRYPTION_IV: Vecteur d\'initialisation (16 caractères)')
    logger.error('   - JWT_SECRET: Secret JWT (64+ caractères)')
    logger.error('   - JWT_REFRESH_SECRET: Secret refresh JWT (64+ caractères)')
    logger.error('   - SESSION_SECRET: Secret sessions (32+ caractères)')

    if (process.env.NODE_ENV === 'production') {
      logger.error('\n🚨 Variables additionnelles requises en production:')
      logger.error('   - SMTP_HOST, SMTP_USER, SMTP_PASS: Configuration email')
      logger.error('   - REDIS_URL: URL Redis pour cache/sessions')
    }

    logger.error('\n💡 Générer des secrets sécurisés:')
    logger.error('   - ENCRYPTION_KEY: openssl rand -base64 32')
    logger.error('   - ENCRYPTION_IV: openssl rand -base64 16')
    logger.error('   - JWT_SECRET: openssl rand -base64 64')
    logger.error('   - SESSION_SECRET: openssl rand -base64 32')

    process.exit(1)
  }

  // Vérifications supplémentaires pour la production
  if (validatedEnv.NODE_ENV === 'production') {
    const productionChecks = [
      {
        condition: !validatedEnv.HTTPS_ONLY,
        message: 'HTTPS_ONLY doit être activé en production'
      },
      {
        condition: validatedEnv.CORS_ORIGIN === '*',
        message: 'CORS_ORIGIN ne doit pas être "*" en production'
      },
      {
        condition: validatedEnv.LOG_LEVEL === 'debug',
        message: 'LOG_LEVEL ne doit pas être "debug" en production'
      },
      {
        condition: validatedEnv.JWT_EXPIRE === '24h' && !validatedEnv.JWT_REFRESH_SECRET,
        message: 'Durée JWT trop longue sans refresh token en production'
      }
    ]

    const productionWarnings = productionChecks.filter(check => check.condition)

    if (productionWarnings.length > 0) {
      logger.warn('⚠️ Avertissements de sécurité pour la production:')
      productionWarnings.forEach((warning, index) => {
        logger.warn(`   ${index + 1}. ${warning.message}`)
      })
    }
  }

  // Validation de la force des secrets
  validateSecretStrength(validatedEnv)

  logger.info('✅ Variables d\'environnement validées avec succès')
  logger.info(`🚀 Mode: ${validatedEnv.NODE_ENV}`)
  logger.info(`🔒 Chiffrement: ${validatedEnv.ENCRYPTION_KEY ? 'Configuré' : 'Non configuré'}`)
  logger.info(`🔑 JWT: ${validatedEnv.JWT_SECRET ? 'Configuré' : 'Non configuré'}`)
  logger.info(`📧 Email: ${validatedEnv.SMTP_HOST ? 'Configuré' : 'Non configuré'}`)
  logger.info(`💾 Redis: ${validatedEnv.REDIS_URL ? 'Configuré' : 'Non configuré'}`)

  return validatedEnv
}

/**
 * Valide la force cryptographique des secrets
 */
const validateSecretStrength = (env) => {
  const secrets = [
    { name: 'ENCRYPTION_KEY', value: env.ENCRYPTION_KEY, minLength: 32 },
    { name: 'JWT_SECRET', value: env.JWT_SECRET, minLength: 64 },
    { name: 'JWT_REFRESH_SECRET', value: env.JWT_REFRESH_SECRET, minLength: 64 },
    { name: 'SESSION_SECRET', value: env.SESSION_SECRET, minLength: 32 }
  ]

  const weakSecrets = []

  secrets.forEach(({ name, value, minLength }) => {
    if (!value) return

    // Vérifier la longueur
    if (value.length < minLength) {
      weakSecrets.push(`${name}: trop court (${value.length}/${minLength})`)
      return
    }

    // Vérifier la complexité (entropie)
    const hasUpperCase = /[A-Z]/.test(value)
    const hasLowerCase = /[a-z]/.test(value)
    const hasNumbers = /\d/.test(value)
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(value)

    const complexity = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChars]
      .filter(Boolean).length

    if (complexity < 3) {
      weakSecrets.push(`${name}: complexité insuffisante (${complexity}/4 types de caractères)`)
    }

    // Détecter les patterns faibles
    if (/(.)\1{3,}/.test(value)) {
      weakSecrets.push(`${name}: contient des répétitions`)
    }

    if (/123|abc|password|secret|admin|test/i.test(value)) {
      weakSecrets.push(`${name}: contient des mots faibles`)
    }
  })

  if (weakSecrets.length > 0) {
    logger.warn('⚠️ Secrets faibles détectés:')
    weakSecrets.forEach((warning, index) => {
      logger.warn(`   ${index + 1}. ${warning}`)
    })

    if (env.NODE_ENV === 'production') {
      logger.error('❌ Secrets faibles non autorisés en production')
      process.exit(1)
    }
  }
}

/**
 * Génère un exemple de fichier .env avec des secrets sécurisés
 */
export const generateEnvExample = async () => {
  const crypto = await import('crypto')

  const envExample = `# Configuration MDMC CRM - Variables d'environnement
# ⚠️ IMPORTANT: Remplacez tous les secrets par des valeurs uniques en production

# Environment
NODE_ENV=development
PORT=5000

# Base de données MongoDB
MONGODB_URI=mongodb://localhost:27017/mdmc_crm

# Secrets de chiffrement (CRITIQUES - Générer de nouvelles valeurs)
ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64')}
ENCRYPTION_IV=${crypto.randomBytes(16).toString('base64').slice(0, 16)}

# Secrets JWT (CRITIQUES - Générer de nouvelles valeurs)
JWT_SECRET=${crypto.randomBytes(64).toString('base64')}
JWT_REFRESH_SECRET=${crypto.randomBytes(64).toString('base64')}
JWT_EXPIRE=24h
JWT_REFRESH_EXPIRE=7d

# Secret de session
SESSION_SECRET=${crypto.randomBytes(32).toString('base64')}

# Configuration CORS
CORS_ORIGIN=http://localhost:3000

# Configuration email (Production uniquement)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-app-password

# Configuration Redis (Production uniquement)
# REDIS_URL=redis://localhost:6379

# Configuration de sécurité
SECURITY_HEADERS_ENABLED=true
HTTPS_ONLY=false
BCRYPT_ROUNDS=12

# Configuration des logs
LOG_LEVEL=info
LOG_FILE_ENABLED=false

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Base de données
DB_MAX_POOL_SIZE=20
DB_MIN_POOL_SIZE=5

# APIs externes (Optionnel)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# META_APP_ID=
# META_APP_SECRET=
# TIKTOK_CLIENT_ID=
# TIKTOK_CLIENT_SECRET=

# Stockage fichiers (Optionnel)
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=eu-west-1
# S3_BUCKET_NAME=

# Monitoring (Optionnel)
# SENTRY_DSN=
`

  return envExample
}

export default {
  validateEnvironment,
  generateEnvExample
}