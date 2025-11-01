import express from 'express'
import { body, query, validationResult } from 'express-validator'
import Lead from '../models/Lead.js'
import User from '../models/User.js'
import { authenticate, authorize, authorizePermission, authorizeAssignment } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import {
  auditLogger,
  captureOriginalData,
  auditStatusChange,
  auditAssignment,
  auditDataExport
} from '../middleware/audit.js'
import { sanitizeInput } from '../middleware/security.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// Validation rules
const createLeadValidation = [
  body('artistName')
    .notEmpty()
    .withMessage('Le nom de l\'artiste est requis')
    .isLength({ max: 100 })
    .withMessage('Le nom de l\'artiste ne peut pas dépasser 100 caractères'),
  body('email')
    .isEmail()
    .withMessage('Email invalide')
    .normalizeEmail(),
  body('platform')
    .isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google', 'multiple'])
    .withMessage('Plateforme invalide'),
  body('source')
    .isIn(['simulator', 'contact_form', 'calendly', 'manual', 'referral', 'social_media'])
    .withMessage('Source invalide'),
  body('budget')
    .optional()
    .isNumeric()
    .withMessage('Le budget doit être un nombre')
    .isFloat({ min: 0 })
    .withMessage('Le budget ne peut pas être négatif')
]

const updateLeadValidation = [
  body('artistName')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Le nom de l\'artiste ne peut pas dépasser 100 caractères'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Email invalide')
    .normalizeEmail(),
  body('status')
    .optional()
    .isIn(['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold'])
    .withMessage('Statut invalide'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priorité invalide'),
  body('budget')
    .optional()
    .isNumeric()
    .withMessage('Le budget doit être un nombre')
    .isFloat({ min: 0 })
    .withMessage('Le budget ne peut pas être négatif')
]

// Auto-assignment logic
const autoAssignLead = async (platform) => {
  let assignedTeam, assignedUser

  // Logique d'auto-assignment
  if (['youtube', 'spotify'].includes(platform)) {
    assignedTeam = 'denis'
  } else if (['meta', 'tiktok'].includes(platform)) {
    assignedTeam = 'marine'
  } else {
    // Pour 'google' ou 'multiple', assigner à la personne avec le moins de leads actifs
    const denisLeads = await Lead.countDocuments({
      assignedTeam: 'denis',
      status: { $nin: ['won', 'lost'] }
    })
    const marineLeads = await Lead.countDocuments({
      assignedTeam: 'marine',
      status: { $nin: ['won', 'lost'] }
    })
    assignedTeam = denisLeads <= marineLeads ? 'denis' : 'marine'
  }

  // Trouver un utilisateur actif de l'équipe
  const teamUsers = await User.find({
    team: assignedTeam,
    isActive: true
  }).sort({ 'stats.leadsCreated': 1 }) // Assigner à celui qui a le moins de leads

  if (teamUsers.length > 0) {
    assignedUser = teamUsers[0]._id
  }

  return { assignedTeam, assignedUser }
}

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private
router.get('/',
  authenticate,
  authorizePermission('leads', 'read'),
  sanitizeInput,
  auditLogger('leads_list_accessed', 'lead'),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page doit être un entier positif'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite doit être entre 1 et 100'),
    query('status').optional().isIn(['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold']),
    query('platform').optional().isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google', 'multiple']),
    query('assignedTo').optional().isMongoId().withMessage('ID utilisateur invalide'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
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
    let filter = { isArchived: false }

    // Filtres par rôle et équipe
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.assignedTo = req.user._id
      } else {
        filter.assignedTeam = req.user.team
      }
    }

    // Filtres de requête
    if (req.query.status) filter.status = req.query.status
    if (req.query.platform) filter.platform = req.query.platform
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo
    if (req.query.priority) filter.priority = req.query.priority
    if (req.query.team) filter.assignedTeam = req.query.team

    // Filtre de recherche
    if (req.query.search) {
      filter.$or = [
        { artistName: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { phone: { $regex: req.query.search, $options: 'i' } }
      ]
    }

    // Filtres de date
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {}
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom)
      if (req.query.dateTo) filter.createdAt.$lte = new Date(req.query.dateTo)
    }

    // Options de tri
    let sort = { createdAt: -1 }
    if (req.query.sortBy) {
      const sortField = req.query.sortBy
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1
      sort = { [sortField]: sortOrder }
    }

    // Exécuter les requêtes
    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedTo', 'firstName lastName fullName email team')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(filter)
    ])

    // Calculer les métadonnées de pagination
    const totalPages = Math.ceil(total / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    res.json({
      success: true,
      data: leads,
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

// @desc    Get lead by ID
// @route   GET /api/leads/:id
// @access  Private
router.get('/:id',
  authenticate,
  authorizePermission('leads', 'read'),
  authorizeAssignment('Lead'),
  auditLogger('lead_viewed', 'lead'),
  asyncHandler(async (req, res) => {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'firstName lastName fullName email team')
      .populate('notes.author', 'firstName lastName fullName')
      .populate('followUps.scheduledBy', 'firstName lastName fullName')
      .populate('followUps.completedBy', 'firstName lastName fullName')

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    res.json({
      success: true,
      data: lead
    })
  })
)

// @desc    Create new lead
// @route   POST /api/leads
// @access  Private
router.post('/',
  authenticate,
  authorizePermission('leads', 'create'),
  sanitizeInput,
  createLeadValidation,
  auditLogger('lead_created', 'lead'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    // Auto-assignment
    const { assignedTeam, assignedUser } = await autoAssignLead(req.body.platform)

    if (!assignedUser) {
      return res.status(500).json({
        success: false,
        message: 'Impossible d\'assigner le lead automatiquement'
      })
    }

    // Vérifier si un lead avec le même email existe déjà
    const existingLead = await Lead.findOne({
      email: req.body.email,
      isArchived: false
    })

    if (existingLead) {
      return res.status(409).json({
        success: false,
        message: 'Un lead avec cet email existe déjà',
        existingLead: {
          id: existingLead._id,
          artistName: existingLead.artistName,
          status: existingLead.status
        }
      })
    }

    // Créer le lead
    const leadData = {
      ...req.body,
      assignedTo: assignedUser,
      assignedTeam,
      firstContactDate: req.body.status === 'contacted' ? new Date() : undefined
    }

    const lead = await Lead.create(leadData)

    // Populate pour la réponse
    await lead.populate('assignedTo', 'firstName lastName fullName email team')

    // Mettre à jour les stats de l'utilisateur
    await User.findByIdAndUpdate(assignedUser, {
      $inc: { 'stats.leadsCreated': 1 }
    })

    // TODO: Envoyer notification en temps réel via WebSocket
    // req.app.get('io').to(`user-${assignedUser}`).emit('new_lead', lead)

    res.status(201).json({
      success: true,
      message: 'Lead créé avec succès',
      data: lead
    })
  })
)

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
router.put('/:id',
  authenticate,
  authorizePermission('leads', 'update'),
  authorizeAssignment('Lead'),
  sanitizeInput,
  captureOriginalData(Lead),
  updateLeadValidation,
  auditLogger('lead_updated', 'lead'),
  auditStatusChange('lead'),
  auditAssignment('lead'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const lead = await Lead.findById(req.params.id)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    // Vérifications spéciales pour certains changements
    if (req.body.status && req.body.status !== lead.status) {
      // Logique métier pour les changements de statut
      if (req.body.status === 'won' && !req.body.dealValue) {
        return res.status(400).json({
          success: false,
          message: 'La valeur du deal est requise pour marquer comme gagné'
        })
      }

      if (req.body.status === 'lost' && !req.body.lostReason) {
        return res.status(400).json({
          success: false,
          message: 'La raison de la perte est requise'
        })
      }

      // Mettre à jour les stats de l'utilisateur
      if (req.body.status === 'won') {
        await User.findByIdAndUpdate(lead.assignedTo, {
          $inc: {
            'stats.leadsConverted': 1,
            'stats.totalRevenue': req.body.dealValue || 0
          }
        })
      }
    }

    // Mettre à jour le lead
    Object.assign(lead, req.body)
    lead.lastActivityDate = new Date()

    await lead.save()

    // Populate pour la réponse
    await lead.populate('assignedTo', 'firstName lastName fullName email team')

    // TODO: Envoyer notification en temps réel
    // req.app.get('io').to(`user-${lead.assignedTo}`).emit('lead_updated', lead)

    res.json({
      success: true,
      message: 'Lead mis à jour avec succès',
      data: lead
    })
  })
)

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private
router.delete('/:id',
  authenticate,
  authorizePermission('leads', 'delete'),
  authorize('admin', 'manager'),
  captureOriginalData(Lead),
  auditLogger('lead_deleted', 'lead'),
  asyncHandler(async (req, res) => {
    const lead = await Lead.findById(req.params.id)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    // Soft delete (archiver au lieu de supprimer)
    lead.isArchived = true
    lead.archivedAt = new Date()
    lead.archivedBy = req.user._id
    await lead.save()

    res.json({
      success: true,
      message: 'Lead supprimé avec succès'
    })
  })
)

// @desc    Add note to lead
// @route   POST /api/leads/:id/notes
// @access  Private
router.post('/:id/notes',
  authenticate,
  authorizePermission('leads', 'update'),
  authorizeAssignment('Lead'),
  sanitizeInput,
  [
    body('content')
      .notEmpty()
      .withMessage('Le contenu de la note est requis')
      .isLength({ max: 2000 })
      .withMessage('La note ne peut pas dépasser 2000 caractères'),
    body('type')
      .optional()
      .isIn(['note', 'call', 'email', 'meeting', 'task'])
      .withMessage('Type de note invalide'),
    body('isPrivate')
      .optional()
      .isBoolean()
      .withMessage('isPrivate doit être un booléen')
  ],
  auditLogger('lead_note_added', 'lead'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { content, type = 'note', isPrivate = false } = req.body

    const lead = await Lead.findById(req.params.id)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    await lead.addNote(req.user._id, content, type, isPrivate)

    // Populate la note ajoutée
    await lead.populate('notes.author', 'firstName lastName fullName')

    const addedNote = lead.notes[lead.notes.length - 1]

    res.status(201).json({
      success: true,
      message: 'Note ajoutée avec succès',
      data: addedNote
    })
  })
)

// @desc    Schedule follow-up
// @route   POST /api/leads/:id/follow-ups
// @access  Private
router.post('/:id/follow-ups',
  authenticate,
  authorizePermission('leads', 'update'),
  authorizeAssignment('Lead'),
  sanitizeInput,
  [
    body('scheduledFor')
      .isISO8601()
      .withMessage('Date de suivi invalide')
      .custom(value => {
        if (new Date(value) <= new Date()) {
          throw new Error('La date de suivi doit être dans le futur')
        }
        return true
      }),
    body('type')
      .isIn(['call', 'email', 'meeting', 'task'])
      .withMessage('Type de suivi invalide'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('La description ne peut pas dépasser 500 caractères')
  ],
  auditLogger('lead_followup_scheduled', 'lead'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { scheduledFor, type, description } = req.body

    const lead = await Lead.findById(req.params.id)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    await lead.scheduleFollowUp(req.user._id, new Date(scheduledFor), type, description)

    // Populate le follow-up ajouté
    await lead.populate('followUps.scheduledBy', 'firstName lastName fullName')

    const addedFollowUp = lead.followUps[lead.followUps.length - 1]

    res.status(201).json({
      success: true,
      message: 'Suivi programmé avec succès',
      data: addedFollowUp
    })
  })
)

// @desc    Complete follow-up
// @route   PUT /api/leads/:id/follow-ups/:followUpId/complete
// @access  Private
router.put('/:id/follow-ups/:followUpId/complete',
  authenticate,
  authorizePermission('leads', 'update'),
  authorizeAssignment('Lead'),
  auditLogger('lead_followup_completed', 'lead'),
  asyncHandler(async (req, res) => {
    const lead = await Lead.findById(req.params.id)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    try {
      await lead.completeFollowUp(req.params.followUpId, req.user._id)

      res.json({
        success: true,
        message: 'Suivi marqué comme terminé'
      })
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message
      })
    }
  })
)

// @desc    Get lead statistics
// @route   GET /api/leads/stats
// @access  Private
router.get('/stats/overview',
  authenticate,
  authorizePermission('analytics', 'read'),
  auditLogger('lead_stats_accessed', 'system'),
  asyncHandler(async (req, res) => {
    const userId = req.user.role === 'agent' ? req.user._id : null
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null

    const stats = await Lead.getLeadStats(userId, startDate, endDate)

    res.json({
      success: true,
      data: stats[0] || {
        total: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        proposal_sent: 0,
        won: 0,
        lost: 0,
        totalValue: 0,
        avgDealValue: 0,
        avgLeadScore: 0
      }
    })
  })
)

// @desc    Export leads
// @route   GET /api/leads/export
// @access  Private
router.get('/export/csv',
  authenticate,
  authorizePermission('analytics', 'export'),
  auditDataExport('CSV', 'Export leads en CSV'),
  asyncHandler(async (req, res) => {
    // Construire le filtre selon les permissions
    let filter = { isArchived: false }

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.assignedTo = req.user._id
      } else {
        filter.assignedTeam = req.user.team
      }
    }

    // Appliquer les filtres de la requête
    if (req.query.status) filter.status = req.query.status
    if (req.query.platform) filter.platform = req.query.platform
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {}
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom)
      if (req.query.dateTo) filter.createdAt.$lte = new Date(req.query.dateTo)
    }

    const leads = await Lead.find(filter)
      .populate('assignedTo', 'firstName lastName fullName')
      .lean()

    // Préparer les données CSV
    const csvData = leads.map(lead => ({
      'ID': lead._id,
      'Nom Artiste': lead.artistName,
      'Email': lead.email,
      'Téléphone': lead.phone || '',
      'Plateforme': lead.platform,
      'Statut': lead.status,
      'Priorité': lead.priority,
      'Budget': lead.budget || '',
      'Assigné à': lead.assignedTo?.fullName || '',
      'Équipe': lead.assignedTeam,
      'Date Création': lead.createdAt.toISOString().split('T')[0],
      'Dernière Activité': lead.lastActivityDate.toISOString().split('T')[0],
      'Score Lead': lead.leadScore,
      'Valeur Deal': lead.dealValue || '',
      'Source': lead.source
    }))

    // Générer le CSV (simplification - en production utiliser une librairie CSV)
    const headers = Object.keys(csvData[0] || {}).join(',')
    const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    const csv = [headers, ...rows].join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename=leads-${new Date().toISOString().split('T')[0]}.csv`)
    res.send(csv)
  })
)

// @desc    Bulk update leads
// @route   PATCH /api/leads/bulk
// @access  Private
router.patch('/bulk',
  authenticate,
  authorizePermission('leads', 'update'),
  sanitizeInput,
  [
    body('leadIds')
      .isArray({ min: 1 })
      .withMessage('Au moins un ID de lead est requis'),
    body('leadIds.*')
      .isMongoId()
      .withMessage('ID de lead invalide'),
    body('updates')
      .isObject()
      .withMessage('Les mises à jour doivent être un objet')
  ],
  auditLogger('leads_bulk_updated', 'lead'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { leadIds, updates } = req.body

    // Vérifier les permissions pour chaque lead
    const leads = await Lead.find({
      _id: { $in: leadIds },
      isArchived: false
    })

    if (req.user.role !== 'admin') {
      const unauthorizedLeads = leads.filter(lead => {
        if (req.user.role === 'agent') {
          return !lead.assignedTo.equals(req.user._id)
        } else {
          return lead.assignedTeam !== req.user.team
        }
      })

      if (unauthorizedLeads.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Certains leads ne peuvent pas être modifiés'
        })
      }
    }

    // Effectuer la mise à jour en masse
    const result = await Lead.updateMany(
      { _id: { $in: leadIds } },
      {
        ...updates,
        lastActivityDate: new Date()
      }
    )

    res.json({
      success: true,
      message: `${result.modifiedCount} leads mis à jour avec succès`,
      modifiedCount: result.modifiedCount
    })
  })
)

export default router