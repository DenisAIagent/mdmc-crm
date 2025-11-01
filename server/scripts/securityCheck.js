#!/usr/bin/env node

/**
 * Script de vérification de sécurité post-correction
 * Valide que toutes les vulnérabilités critiques ont été corrigées
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { validateEnvironment } from '../config/validateEnv.js'

console.log('🔒 VÉRIFICATION DE SÉCURITÉ MDMC CRM')
console.log('=====================================\n')

let securityScore = 0
let totalChecks = 0
const issues = []
const warnings = []

/**
 * Vérification 1: Chiffrement AES sécurisé
 */
function checkEncryption() {
  console.log('🔍 Vérification du chiffrement AES...')
  totalChecks++

  try {
    const encryptionFile = fs.readFileSync('./utils/encryption.js', 'utf8')

    // Vérifier que createCipher n'est plus utilisé
    if (encryptionFile.includes('createCipher(')) {
      issues.push('❌ createCipher() encore présent dans encryption.js')
      return false
    }

    // Vérifier que createCipheriv est utilisé
    if (!encryptionFile.includes('createCipheriv(')) {
      issues.push('❌ createCipheriv() non trouvé dans encryption.js')
      return false
    }

    // Vérifier la génération d'IV aléatoire
    if (!encryptionFile.includes('randomBytes(16)') && !encryptionFile.includes('randomBytes(12)')) {
      issues.push('❌ Génération d\'IV aléatoire non détectée')
      return false
    }

    console.log('   ✅ Chiffrement AES sécurisé détecté')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de lire encryption.js: ${error.message}`)
    return false
  }
}

/**
 * Vérification 2: Secrets hardcodés supprimés
 */
function checkHardcodedSecrets() {
  console.log('🔍 Vérification des secrets hardcodés...')
  totalChecks++

  try {
    const encryptionFile = fs.readFileSync('./utils/encryption.js', 'utf8')

    // Patterns de secrets hardcodés
    const dangerousPatterns = [
      /ENCRYPTION_KEY.*=.*['"`][^'"` ]{8,}['"`]/,
      /JWT_SECRET.*=.*['"`][^'"` ]{8,}['"`]/,
      /mdmc_aes256_encryption_key/,
      /super_secure_2025/,
      /process\.env\.\w+\s*\|\|\s*['"`]/
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(encryptionFile)) {
        issues.push('❌ Secret potentiellement hardcodé détecté')
        return false
      }
    }

    // Vérifier la validation d'environnement
    if (!encryptionFile.includes('throw new Error') || !encryptionFile.includes('required')) {
      warnings.push('⚠️ Validation d\'environnement faible')
    }

    console.log('   ✅ Aucun secret hardcodé détecté')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier les secrets: ${error.message}`)
    return false
  }
}

/**
 * Vérification 3: Validation JWT sécurisée
 */
function checkJWTSecurity() {
  console.log('🔍 Vérification de la sécurité JWT...')
  totalChecks++

  try {
    const authFile = fs.readFileSync('./middleware/auth.js', 'utf8')

    // Vérifier l'algorithme forcé
    if (!authFile.includes('algorithms: [\'HS256\']')) {
      issues.push('❌ Algorithme JWT non forcé à HS256')
      return false
    }

    // Vérifier la signature avec algorithme
    if (!authFile.includes('algorithm: \'HS256\'')) {
      warnings.push('⚠️ Algorithme de signature JWT non spécifié')
    }

    // Vérifier la validation d'issuer/audience
    if (!authFile.includes('issuer:') || !authFile.includes('audience:')) {
      warnings.push('⚠️ Validation issuer/audience JWT manquante')
    }

    console.log('   ✅ Sécurité JWT renforcée')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier JWT: ${error.message}`)
    return false
  }
}

/**
 * Vérification 4: Rate limiting renforcé
 */
function checkRateLimiting() {
  console.log('🔍 Vérification du rate limiting...')
  totalChecks++

  try {
    const rateLimitFile = fs.readFileSync('./config/rateLimit.js', 'utf8')

    // Vérifier la présence de limits stricts pour auth
    if (!rateLimitFile.includes('authRateLimit')) {
      issues.push('❌ Rate limiting spécifique à l\'authentification manquant')
      return false
    }

    // Vérifier les limites strictes (max 5 pour auth)
    if (!rateLimitFile.includes('max: 5')) {
      warnings.push('⚠️ Limites d\'authentification potentiellement trop permissives')
    }

    // Vérifier la configuration pour différents endpoints
    const requiredConfigs = ['authRateLimit', 'strictRateLimit', 'uploadRateLimit']
    for (const config of requiredConfigs) {
      if (!rateLimitFile.includes(config)) {
        warnings.push(`⚠️ Configuration ${config} manquante`)
      }
    }

    console.log('   ✅ Rate limiting renforcé')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier rate limiting: ${error.message}`)
    return false
  }
}

/**
 * Vérification 5: Validation d'input anti-injection
 */
function checkInputValidation() {
  console.log('🔍 Vérification de la validation d\'input...')
  totalChecks++

  try {
    // Vérifier l'existence du middleware de validation
    if (!fs.existsSync('./middleware/validation.js')) {
      issues.push('❌ Middleware de validation manquant')
      return false
    }

    const validationFile = fs.readFileSync('./middleware/validation.js', 'utf8')

    // Vérifier les fonctions de sécurité essentielles
    const requiredFunctions = [
      'sanitizeInput',
      'preventNoSQLInjection',
      'validateSchema',
      'sanitizeString'
    ]

    for (const func of requiredFunctions) {
      if (!validationFile.includes(func)) {
        issues.push(`❌ Fonction de sécurité ${func} manquante`)
        return false
      }
    }

    // Vérifier les patterns de détection d'injection
    if (!validationFile.includes('startsWith(\'$\')')) {
      warnings.push('⚠️ Détection d\'injection NoSQL incomplète')
    }

    console.log('   ✅ Validation d\'input sécurisée')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier validation: ${error.message}`)
    return false
  }
}

/**
 * Vérification 6: Gestion d'erreurs sécurisée
 */
function checkErrorHandling() {
  console.log('🔍 Vérification de la gestion d\'erreurs...')
  totalChecks++

  try {
    const errorFile = fs.readFileSync('./middleware/errorHandler.js', 'utf8')

    // Vérifier que les détails ne sont pas exposés en production
    if (!errorFile.includes('NODE_ENV === \'development\'')) {
      issues.push('❌ Détails d\'erreurs potentiellement exposés en production')
      return false
    }

    // Vérifier la sanitisation des logs
    if (errorFile.includes('console.error')) {
      warnings.push('⚠️ console.error détecté, préférer logger')
    }

    // Vérifier la présence de timestamps
    if (!errorFile.includes('timestamp')) {
      warnings.push('⚠️ Timestamps manquants dans les logs d\'erreur')
    }

    console.log('   ✅ Gestion d\'erreurs sécurisée')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier gestion d\'erreurs: ${error.message}`)
    return false
  }
}

/**
 * Vérification 7: Configuration d'environnement
 */
function checkEnvironmentValidation() {
  console.log('🔍 Vérification de la validation d\'environnement...')
  totalChecks++

  try {
    // Vérifier l'existence du validateur
    if (!fs.existsSync('./config/validateEnv.js')) {
      issues.push('❌ Validateur d\'environnement manquant')
      return false
    }

    const envFile = fs.readFileSync('./config/validateEnv.js', 'utf8')

    // Vérifier les validations critiques
    const criticalValidations = [
      'ENCRYPTION_KEY',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'MONGODB_URI'
    ]

    for (const validation of criticalValidations) {
      if (!envFile.includes(validation)) {
        issues.push(`❌ Validation ${validation} manquante`)
        return false
      }
    }

    // Vérifier la validation de force des secrets
    if (!envFile.includes('validateSecretStrength')) {
      warnings.push('⚠️ Validation de force des secrets recommandée')
    }

    console.log('   ✅ Validation d\'environnement implémentée')
    securityScore++
    return true
  } catch (error) {
    issues.push(`❌ Impossible de vérifier validation environnement: ${error.message}`)
    return false
  }
}

/**
 * Test de génération de secrets sécurisés
 */
function generateSecureSecrets() {
  console.log('🔑 Génération d\'exemples de secrets sécurisés...')

  const secrets = {
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    ENCRYPTION_IV: crypto.randomBytes(16).toString('base64').slice(0, 16),
    JWT_SECRET: crypto.randomBytes(64).toString('base64'),
    JWT_REFRESH_SECRET: crypto.randomBytes(64).toString('base64'),
    SESSION_SECRET: crypto.randomBytes(32).toString('base64')
  }

  console.log('\n   📋 Secrets générés pour .env:')
  for (const [key, value] of Object.entries(secrets)) {
    console.log(`   ${key}=${value}`)
  }
}

/**
 * Exécution des vérifications
 */
async function runSecurityChecks() {
  try {
    // Changer vers le répertoire du serveur
    process.chdir(path.dirname(new URL(import.meta.url).pathname))

    console.log('📂 Répertoire de travail:', process.cwd())
    console.log('')

    // Exécuter toutes les vérifications
    checkEncryption()
    checkHardcodedSecrets()
    checkJWTSecurity()
    checkRateLimiting()
    checkInputValidation()
    checkErrorHandling()
    checkEnvironmentValidation()

    console.log('\n🎯 RÉSULTATS')
    console.log('=============')

    // Calculer le score final
    const finalScore = Math.round((securityScore / totalChecks) * 10)
    const previousScore = 6.2

    console.log(`📊 Score de sécurité: ${finalScore}/10 (précédent: ${previousScore}/10)`)
    console.log(`✅ Vérifications réussies: ${securityScore}/${totalChecks}`)

    if (issues.length > 0) {
      console.log('\n❌ PROBLÈMES CRITIQUES:')
      issues.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue}`)
      })
    }

    if (warnings.length > 0) {
      console.log('\n⚠️ AVERTISSEMENTS:')
      warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. ${warning}`)
      })
    }

    // Recommandations finales
    console.log('\n📋 PROCHAINES ÉTAPES:')

    if (finalScore < 8) {
      console.log('   🔴 Corriger les problèmes critiques avant déploiement')
    } else if (finalScore < 9) {
      console.log('   🟡 Sécurité acceptable, améliorer les avertissements')
    } else {
      console.log('   🟢 Excellente sécurité, prêt pour déploiement')
    }

    console.log('   📧 Configurer les variables d\'environnement en production')
    console.log('   🧪 Exécuter les tests de sécurité automatisés')
    console.log('   📊 Mettre en place le monitoring de sécurité')

    generateSecureSecrets()

    console.log('\n🔒 Audit de sécurité terminé.')

    if (issues.length > 0) {
      process.exit(1)
    } else {
      process.exit(0)
    }

  } catch (error) {
    console.error('❌ Erreur lors de l\'audit de sécurité:', error.message)
    process.exit(1)
  }
}

// Exécuter si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  runSecurityChecks()
}

export default {
  runSecurityChecks,
  checkEncryption,
  checkHardcodedSecrets,
  checkJWTSecurity,
  checkRateLimiting,
  checkInputValidation,
  checkErrorHandling,
  checkEnvironmentValidation
}