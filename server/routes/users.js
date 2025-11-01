import express from 'express'
import { body, query, validationResult } from 'express-validator'
import User from '../models/User.js'
import { authenticate, authorize, authorizePermission } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { auditLogger, captureOriginalData, auditSensitiveAction } from '../middleware/audit.js'
import { sanitizeInput, sensitiveActionLimiter } from '../middleware/security.js'

const router = express.Router()

// Validation rules
const createUserValidation = [
  body('firstName')
    .notEmpty()
    .withMessage('Le prénom est requis')
    .isLength({ min: 2, max: 50 })
    .withMessage('Le prénom doit contenir entre 2 et 50 caractères'),
  body('lastName')
    .notEmpty()
    .withMessage('Le nom est requis')
    .isLength({ min: 2, max: 50 })
    .withMessage('Le nom doit contenir entre 2 et 50 caractères'),
  body('email')
    .isEmail()
    .withMessage('Email invalide')
    .normalizeEmail(),
  body('role')
    .isIn(['admin', 'manager', 'agent'])
    .withMessage('Rôle invalide'),
  body('team')
    .isIn(['denis', 'marine'])
    .withMessage('Équipe invalide'),
  body('assignedPlatforms')
    .optional()
    .isArray()
    .withMessage('Les plateformes assignées doivent être un tableau'),
  body('assignedPlatforms.*')
    .optional()
    .isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google'])
    .withMessage('Plateforme invalide')
]

const updateUserValidation = [
  body('firstName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Le prénom doit contenir entre 2 et 50 caractères'),
  body('lastName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Le nom doit contenir entre 2 et 50 caractères'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Email invalide')
    .normalizeEmail(),
  body('role')
    .optional()
    .isIn(['admin', 'manager', 'agent'])
    .withMessage('Rôle invalide'),
  body('team')
    .optional()
    .isIn(['denis', 'marine'])
    .withMessage('Équipe invalide'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive doit être un booléen')
]

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin/Manager)
router.get('/',
  authenticate,
  authorize('admin', 'manager'),
  sanitizeInput,
  auditLogger('users_list_accessed', 'user'),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page doit être un entier positif'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite doit être entre 1 et 100'),
    query('role').optional().isIn(['admin', 'manager', 'agent']).withMessage('Rôle invalide'),
    query('team').optional().isIn(['denis', 'marine']).withMessage('Équipe invalide'),
    query('isActive').optional().isBoolean().withMessage('isActive doit être un booléen'),
    query('search').optional().isLength({ max: 100 }).withMessage('Recherche trop longue')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres de requête invalides',
        errors: errors.array()
      })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit

    // Construire le filtre
    let filter = {}

    // Filtrer par équipe si l'utilisateur n'est pas admin
    if (req.user.role !== 'admin') {
      filter.team = req.user.team
    }

    // Filtres de requête
    if (req.query.role) filter.role = req.query.role
    if (req.query.team) filter.team = req.query.team
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true'

    // Filtre de recherche
    if (req.query.search) {
      filter.$or = [
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ]
    }

    // Options de tri
    let sort = { createdAt: -1 }
    if (req.query.sortBy) {
      const sortField = req.query.sortBy
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1
      sort = { [sortField]: sortOrder }
    }

    // Exécuter les requêtes
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -emailVerificationToken -passwordResetToken -apiKeys')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ])

    // Calculer les métadonnées de pagination
    const totalPages = Math.ceil(total / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage
      },
      filters: req.query
    })
  })
)

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private (Admin/Manager or self)
router.get('/:id',
  authenticate,
  sanitizeInput,
  auditLogger('user_viewed', 'user'),
  asyncHandler(async (req, res) => {
    const userId = req.params.id

    // Vérifier les permissions
    if (req.user.role !== 'admin') {
      // Manager peut voir les utilisateurs de son équipe
      if (req.user.role === 'manager') {
        const targetUser = await User.findById(userId).select('team')
        if (!targetUser || targetUser.team !== req.user.team) {
          return res.status(403).json({
            success: false,
            message: 'Accès refusé'
          })
        }
      }
      // Agent peut seulement voir son propre profil
      else if (req.user.role === 'agent' && userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé'
        })
      }
    }

    const user = await User.findById(userId)
      .select('-password -emailVerificationToken -passwordResetToken -apiKeys')

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    res.json({
      success: true,
      data: user
    })
  })
)

// @desc    Create new user
// @route   POST /api/users
// @access  Private (Admin only)
router.post('/',
  authenticate,
  authorize('admin'),
  sanitizeInput,
  createUserValidation,
  auditSensitiveAction('user_created', 'Création d\'un nouvel utilisateur'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { firstName, lastName, email, role, team, assignedPlatforms } = req.body

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findByEmail(email)
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Un utilisateur avec cet email existe déjà'
      })
    }

    // Générer un mot de passe temporaire
    const tempPassword = Math.random().toString(36).slice(-12)

    // Définir les plateformes assignées par défaut selon l'équipe
    let defaultPlatforms = assignedPlatforms
    if (!defaultPlatforms) {
      if (team === 'denis') {
        defaultPlatforms = ['youtube', 'spotify']
      } else if (team === 'marine') {
        defaultPlatforms = ['meta', 'tiktok']
      }
    }

    // Créer l'utilisateur
    const user = await User.create({
      firstName,
      lastName,
      email,
      password: tempPassword,
      role,
      team,
      assignedPlatforms: defaultPlatforms,
      isVerified: false // Nécessitera une vérification d'email
    })

    // TODO: Envoyer email de bienvenue avec mot de passe temporaire
    // await sendWelcomeEmail(user.email, tempPassword)

    // Réponse sans mot de passe
    const userResponse = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      team: user.team,
      assignedPlatforms: user.assignedPlatforms,
      permissions: user.permissions,
      isActive: user.isActive,
      isVerified: user.isVerified
    }

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      data: userResponse,
      tempPassword // Seulement pour les tests - à supprimer en production
    })
  })
)

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin/Manager or self for limited fields)
router.put('/:id',
  authenticate,
  sanitizeInput,
  captureOriginalData(User),
  updateUserValidation,
  auditLogger('user_updated', 'user'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const userId = req.params.id
    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Vérifier les permissions
    const isAdmin = req.user.role === 'admin'
    const isManager = req.user.role === 'manager' && user.team === req.user.team
    const isSelf = userId === req.user.id

    if (!isAdmin && !isManager && !isSelf) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }

    // Restrictions sur les champs modifiables selon le rôle
    const allowedFields = {}

    if (isAdmin) {
      // Admin peut tout modifier
      Object.assign(allowedFields, req.body)
    } else if (isManager) {
      // Manager peut modifier certains champs des membres de son équipe
      const managerAllowedFields = ['assignedPlatforms', 'permissions', 'isActive']
      for (const field of managerAllowedFields) {
        if (req.body[field] !== undefined) {
          allowedFields[field] = req.body[field]
        }
      }
    } else if (isSelf) {
      // Utilisateur peut modifier ses propres informations de base
      const selfAllowedFields = ['firstName', 'lastName', 'preferences']
      for (const field of selfAllowedFields) {
        if (req.body[field] !== undefined) {
          allowedFields[field] = req.body[field]
        }
      }
    }

    // Validations spéciales
    if (allowedFields.email && allowedFields.email !== user.email) {
      const existingUser = await User.findByEmail(allowedFields.email)
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Un utilisateur avec cet email existe déjà'
        })
      }
    }

    // Mettre à jour l'utilisateur
    Object.assign(user, allowedFields)
    await user.save()

    // Réponse sans informations sensibles
    const userResponse = await User.findById(userId)
      .select('-password -emailVerificationToken -passwordResetToken -apiKeys')

    res.json({
      success: true,
      message: 'Utilisateur mis à jour avec succès',
      data: userResponse
    })
  })
)

// @desc    Delete user (soft delete)
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
router.delete('/:id',
  authenticate,
  authorize('admin'),
  sensitiveActionLimiter,
  captureOriginalData(User),
  auditSensitiveAction('user_deleted', 'Suppression d\'un utilisateur'),
  asyncHandler(async (req, res) => {
    const userId = req.params.id

    // Empêcher l'auto-suppression
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer votre propre compte'
      })
    }

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Soft delete - désactiver au lieu de supprimer
    user.isActive = false
    user.email = `deleted_${Date.now()}_${user.email}` // Éviter les conflits d'email
    await user.save()

    res.json({
      success: true,
      message: 'Utilisateur supprimé avec succès'
    })
  })
)

// @desc    Update user permissions
// @route   PUT /api/users/:id/permissions
// @access  Private (Admin only)
router.put('/:id/permissions',
  authenticate,
  authorize('admin'),
  sanitizeInput,
  captureOriginalData(User),
  [
    body('permissions')
      .isObject()
      .withMessage('Les permissions doivent être un objet'),
    body('permissions.leads')
      .optional()
      .isObject()
      .withMessage('Les permissions leads doivent être un objet'),
    body('permissions.campaigns')
      .optional()
      .isObject()
      .withMessage('Les permissions campaigns doivent être un objet')
  ],
  auditSensitiveAction('user_permissions_changed', 'Modification des permissions utilisateur'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const userId = req.params.id
    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Mettre à jour les permissions
    user.permissions = { ...user.permissions, ...req.body.permissions }
    await user.save()

    res.json({
      success: true,
      message: 'Permissions mises à jour avec succès',
      data: user.permissions
    })
  })
)

// @desc    Reset user password
// @route   POST /api/users/:id/reset-password
// @access  Private (Admin only)
router.post('/:id/reset-password',
  authenticate,
  authorize('admin'),
  sensitiveActionLimiter,
  auditSensitiveAction('user_password_reset', 'Réinitialisation forcée du mot de passe'),
  asyncHandler(async (req, res) => {
    const userId = req.params.id
    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Générer un nouveau mot de passe temporaire
    const tempPassword = Math.random().toString(36).slice(-12)

    user.password = tempPassword
    user.isVerified = false // Forcer la vérification du nouveau mot de passe
    await user.save()

    // TODO: Envoyer email avec nouveau mot de passe
    // await sendPasswordResetEmail(user.email, tempPassword)

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      tempPassword // Seulement pour les tests - à supprimer en production
    })
  })
)

// @desc    Get user statistics
// @route   GET /api/users/:id/stats
// @access  Private (Admin/Manager or self)
router.get('/:id/stats',
  authenticate,
  auditLogger('user_stats_accessed', 'user'),
  asyncHandler(async (req, res) => {
    const userId = req.params.id

    // Vérifier les permissions
    if (req.user.role !== 'admin') {
      if (req.user.role === 'manager') {
        const targetUser = await User.findById(userId).select('team')
        if (!targetUser || targetUser.team !== req.user.team) {
          return res.status(403).json({
            success: false,
            message: 'Accès refusé'
          })
        }
      } else if (req.user.role === 'agent' && userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé'
        })
      }
    }

    const user = await User.findById(userId).select('stats')

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Calculer des statistiques supplémentaires
    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      monthlyLeads,
      monthlyCampaigns,
      monthlyRevenue
    ] = await Promise.all([
      // Import dynamique pour éviter les dépendances circulaires
      import('../models/Lead.js').then(module =>
        module.default.countDocuments({
          assignedTo: userId,
          createdAt: { $gte: thisMonth }
        })
      ),
      import('../models/Campaign.js').then(module =>
        module.default.countDocuments({
          managedBy: userId,
          createdAt: { $gte: thisMonth }
        })
      ),
      import('../models/Lead.js').then(module =>
        module.default.aggregate([
          {
            $match: {
              assignedTo: userId,
              status: 'won',
              wonDate: { $gte: thisMonth }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$dealValue' }
            }
          }
        ])
      )
    ])

    res.json({
      success: true,
      data: {
        overall: user.stats,
        monthly: {
          leads: monthlyLeads,
          campaigns: monthlyCampaigns,
          revenue: monthlyRevenue[0]?.total || 0
        }
      }
    })
  })
)

export default router