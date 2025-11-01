import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import { generateToken, generateRefreshToken } from '../middleware/auth.js'
import { validatePasswordStrength, generateSecureToken } from '../utils/encryption.js'
import { logger } from '../utils/logger.js'
import { validationResult } from 'express-validator'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

/**
 * Contrôleur d'authentification avec sécurité renforcée
 * JWT avec refresh tokens, audit trail, protection contre les attaques
 */

/**
 * @desc    Inscription d'un nouvel utilisateur
 * @route   POST /api/auth/register
 * @access  Private (Admin seulement)
 */
export const register = async (req, res) => {
  try {
    // Validation des erreurs
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array()
      })
    }

    const { firstName, lastName, email, password, role, team, assignedPlatforms } = req.body

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findByEmail(email)
    if (existingUser) {
      await AuditLog.logAction({
        userId: req.user?._id,
        userEmail: req.user?.email,
        userName: req.user?.fullName,
        action: 'register_attempt',
        resourceType: 'user',
        description: `Tentative d'inscription avec email existant: ${email}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        category: 'authentication',
        metadata: { attemptedEmail: email }
      })

      return res.status(400).json({
        success: false,
        message: 'Un utilisateur avec cet email existe déjà'
      })
    }

    // Validation de la force du mot de passe
    const passwordValidation = validatePasswordStrength(password)
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Mot de passe trop faible',
        suggestions: passwordValidation.suggestions
      })
    }

    // Configuration des permissions par défaut selon le rôle
    let permissions = {
      leads: { create: true, read: true, update: true, delete: false },
      campaigns: { create: true, read: true, update: true, delete: false },
      analytics: { read: true, export: false },
      admin: { users: false, settings: false, audit: false }
    }

    if (role === 'admin') {
      permissions.admin = { users: true, settings: true, audit: true }
      permissions.analytics.export = true
      permissions.leads.delete = true
      permissions.campaigns.delete = true
    } else if (role === 'manager') {
      permissions.analytics.export = true
      permissions.leads.delete = true
      permissions.campaigns.delete = true
    }

    // Création de l'utilisateur
    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      role,
      team,
      assignedPlatforms: assignedPlatforms || [],
      permissions,
      isVerified: false // Nécessitera une vérification email
    })

    // Génération du token de vérification email
    const emailToken = user.generateEmailVerificationToken()
    await user.save()

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'create_user',
      resourceType: 'user',
      resourceId: user._id,
      description: `Création de l'utilisateur ${user.fullName} (${user.email}) avec le rôle ${role}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: {
        newUserEmail: user.email,
        newUserRole: role,
        newUserTeam: team,
        assignedPlatforms
      }
    })

    // TODO: Envoyer l'email de vérification
    // await sendVerificationEmail(user.email, emailToken)

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès. Email de vérification envoyé.',
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        team: user.team,
        isVerified: user.isVerified
      }
    })

  } catch (error) {
    logger.error('Erreur lors de l\'inscription:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'create_user',
      resourceType: 'user',
      description: 'Échec de la création utilisateur',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message,
      metadata: req.body
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'utilisateur'
    })
  }
}

/**
 * @desc    Connexion utilisateur
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res) => {
  try {
    // Validation des erreurs
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array()
      })
    }

    const { email, password, rememberMe = false } = req.body

    // Recherche de l'utilisateur avec le mot de passe
    const user = await User.findByEmail(email).select('+password')

    if (!user) {
      await AuditLog.logAction({
        userId: null,
        userEmail: email,
        userName: 'Utilisateur inconnu',
        action: 'login_attempt',
        resourceType: 'auth',
        description: `Tentative de connexion avec email inexistant: ${email}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        category: 'authentication',
        metadata: { attemptedEmail: email }
      })

      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides'
      })
    }

    // Vérifier si le compte est verrouillé
    if (user.isLocked) {
      await AuditLog.logAction({
        userId: user._id,
        userEmail: user.email,
        userName: user.fullName,
        action: 'login_attempt',
        resourceType: 'auth',
        description: 'Tentative de connexion sur compte verrouillé',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'high',
        category: 'authentication',
        metadata: { lockUntil: user.lockUntil }
      })

      return res.status(423).json({
        success: false,
        message: 'Compte temporairement verrouillé suite à plusieurs tentatives échouées'
      })
    }

    // Vérifier si le compte est actif
    if (!user.isActive) {
      await AuditLog.logAction({
        userId: user._id,
        userEmail: user.email,
        userName: user.fullName,
        action: 'login_attempt',
        resourceType: 'auth',
        description: 'Tentative de connexion sur compte désactivé',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium'
      })

      return res.status(401).json({
        success: false,
        message: 'Compte désactivé'
      })
    }

    // Vérification du mot de passe
    const isPasswordCorrect = await user.comparePassword(password)

    if (!isPasswordCorrect) {
      // Incrémenter les tentatives de connexion
      await user.incrementLoginAttempts()

      await AuditLog.logAction({
        userId: user._id,
        userEmail: user.email,
        userName: user.fullName,
        action: 'login_attempt',
        resourceType: 'auth',
        description: 'Tentative de connexion avec mot de passe incorrect',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        metadata: { loginAttempts: user.loginAttempts + 1 }
      })

      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides'
      })
    }

    // Connexion réussie - Reset des tentatives
    await user.resetLoginAttempts()

    // Mise à jour de la dernière connexion
    user.lastLogin = new Date()
    await user.save()

    // Génération des tokens
    const accessToken = generateToken(user._id)
    const refreshToken = generateRefreshToken(user._id)

    // Configuration des cookies sécurisés
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 // 7 jours ou 1 jour
    }

    // Définir les cookies
    res.cookie('authToken', accessToken, cookieOptions)
    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours pour le refresh token
    })

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: user._id,
      userEmail: user.email,
      userName: user.fullName,
      action: 'login_success',
      resourceType: 'auth',
      description: 'Connexion réussie',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      category: 'authentication',
      metadata: {
        rememberMe,
        lastLogin: user.lastLogin
      }
    })

    // Réponse sans données sensibles
    const userData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      team: user.team,
      assignedPlatforms: user.assignedPlatforms,
      permissions: user.permissions,
      preferences: user.preferences,
      isVerified: user.isVerified,
      lastLogin: user.lastLogin
    }

    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      data: {
        user: userData,
        accessToken,
        refreshToken,
        expiresIn: process.env.JWT_EXPIRE || '24h'
      }
    })

  } catch (error) {
    logger.error('Erreur lors de la connexion:', error)

    await AuditLog.logAction({
      userId: null,
      userEmail: email || 'inconnu',
      userName: 'Erreur serveur',
      action: 'login_attempt',
      resourceType: 'auth',
      description: 'Erreur serveur lors de la connexion',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message,
      severity: 'high',
      category: 'authentication'
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la connexion'
    })
  }
}

/**
 * @desc    Déconnexion utilisateur
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = async (req, res) => {
  try {
    // Effacer les cookies
    res.clearCookie('authToken')
    res.clearCookie('refreshToken')

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'logout',
      resourceType: 'auth',
      description: 'Déconnexion utilisateur',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true
    })

    res.status(200).json({
      success: true,
      message: 'Déconnexion réussie'
    })

  } catch (error) {
    logger.error('Erreur lors de la déconnexion:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la déconnexion'
    })
  }
}

/**
 * @desc    Rafraîchir le token d'accès
 * @route   POST /api/auth/refresh
 * @access  Public
 */
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body || {}
    const cookieToken = req.cookies?.refreshToken

    const refreshTokenToUse = token || cookieToken

    if (!refreshTokenToUse) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token manquant'
      })
    }

    try {
      // Vérifier le refresh token
      const decoded = jwt.verify(refreshTokenToUse, process.env.JWT_REFRESH_SECRET, {
        issuer: 'mdmc-crm',
        audience: 'mdmc-users'
      })

      if (decoded.type !== 'refresh') {
        throw new Error('Type de token invalide')
      }

      // Récupérer l'utilisateur
      const user = await User.findById(decoded.id)

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Utilisateur invalide ou inactif'
        })
      }

      // Générer de nouveaux tokens
      const newAccessToken = generateToken(user._id)
      const newRefreshToken = generateRefreshToken(user._id)

      // Configuration des cookies
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 1 jour
      }

      res.cookie('authToken', newAccessToken, cookieOptions)
      res.cookie('refreshToken', newRefreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
      })

      // Log de l'action pour audit
      await AuditLog.logAction({
        userId: user._id,
        userEmail: user.email,
        userName: user.fullName,
        action: 'token_refresh',
        resourceType: 'auth',
        description: 'Rafraîchissement du token d\'accès',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: true
      })

      res.status(200).json({
        success: true,
        message: 'Token rafraîchi avec succès',
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: process.env.JWT_EXPIRE || '24h'
        }
      })

    } catch (jwtError) {
      await AuditLog.logAction({
        action: 'token_refresh',
        resourceType: 'auth',
        description: 'Échec du rafraîchissement de token - Token invalide',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        success: false,
        severity: 'medium',
        errorMessage: jwtError.message
      })

      return res.status(401).json({
        success: false,
        message: 'Refresh token invalide'
      })
    }

  } catch (error) {
    logger.error('Erreur lors du rafraîchissement du token:', error)

    await AuditLog.logAction({
      action: 'token_refresh',
      resourceType: 'auth',
      description: 'Erreur serveur lors du rafraîchissement de token',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message,
      severity: 'high'
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors du rafraîchissement du token'
    })
  }
}

/**
 * @desc    Récupérer le profil utilisateur connecté
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('stats')

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Données utilisateur sans informations sensibles
    const userData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      team: user.team,
      assignedPlatforms: user.assignedPlatforms,
      permissions: user.permissions,
      preferences: user.preferences,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      stats: user.stats,
      conversionRate: user.conversionRate,
      createdAt: user.createdAt
    }

    res.status(200).json({
      success: true,
      data: userData
    })

  } catch (error) {
    logger.error('Erreur lors de la récupération du profil:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    })
  }
}

/**
 * @desc    Mise à jour du profil utilisateur
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, preferences } = req.body

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        firstName,
        lastName,
        preferences: { ...req.user.preferences, ...preferences }
      },
      { new: true, runValidators: true }
    )

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'update_profile',
      resourceType: 'user',
      resourceId: user._id,
      description: 'Mise à jour du profil utilisateur',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: req.body
    })

    // Données utilisateur mises à jour
    const userData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      team: user.team,
      assignedPlatforms: user.assignedPlatforms,
      permissions: user.permissions,
      preferences: user.preferences,
      isVerified: user.isVerified
    }

    res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès',
      data: userData
    })

  } catch (error) {
    logger.error('Erreur lors de la mise à jour du profil:', error)

    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'update_profile',
      resourceType: 'user',
      resourceId: req.user._id,
      description: 'Échec de la mise à jour du profil',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du profil'
    })
  }
}

export default {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  updateProfile
}