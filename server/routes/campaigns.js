import express from 'express'
import { body, query, validationResult } from 'express-validator'
import Campaign from '../models/Campaign.js'
import Lead from '../models/Lead.js'
import User from '../models/User.js'
import { authenticate, authorize, authorizePermission, authorizeAssignment } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import {
  auditLogger,
  captureOriginalData,
  auditStatusChange,
  auditDataExport
} from '../middleware/audit.js'
import { sanitizeInput } from '../middleware/security.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// Validation rules
const createCampaignValidation = [
  body('name')
    .notEmpty()
    .withMessage('Le nom de la campagne est requis')
    .isLength({ max: 200 })
    .withMessage('Le nom ne peut pas dépasser 200 caractères'),
  body('leadId')
    .isMongoId()
    .withMessage('ID de lead invalide'),
  body('platform')
    .isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google'])
    .withMessage('Plateforme invalide'),
  body('budget.total')
    .isNumeric()
    .withMessage('Le budget total doit être un nombre')
    .isFloat({ min: 0 })
    .withMessage('Le budget total ne peut pas être négatif'),
  body('startDate')
    .isISO8601()
    .withMessage('Date de début invalide'),
  body('endDate')
    .isISO8601()
    .withMessage('Date de fin invalide')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('La date de fin doit être après la date de début')
      }
      return true
    }),
  body('objectives.primary')
    .isIn(['awareness', 'reach', 'engagement', 'traffic', 'conversions', 'streams', 'followers'])
    .withMessage('Objectif principal invalide')
]

const updateCampaignValidation = [
  body('name')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Le nom ne peut pas dépasser 200 caractères'),
  body('status')
    .optional()
    .isIn(['draft', 'pending_approval', 'active', 'paused', 'completed', 'cancelled'])
    .withMessage('Statut invalide'),
  body('budget.total')
    .optional()
    .isNumeric()
    .withMessage('Le budget total doit être un nombre')
    .isFloat({ min: 0 })
    .withMessage('Le budget total ne peut pas être négatif'),
  body('spent')
    .optional()
    .isNumeric()
    .withMessage('Le montant dépensé doit être un nombre')
    .isFloat({ min: 0 })
    .withMessage('Le montant dépensé ne peut pas être négatif')
]

const kpiValidation = [
  body('views').optional().isNumeric().withMessage('Les vues doivent être un nombre'),
  body('clicks').optional().isNumeric().withMessage('Les clics doivent être un nombre'),
  body('impressions').optional().isNumeric().withMessage('Les impressions doivent être un nombre'),
  body('spend').optional().isNumeric().withMessage('Le montant dépensé doit être un nombre'),
  body('conversions').optional().isNumeric().withMessage('Les conversions doivent être un nombre')
]

// @desc    Get all campaigns
// @route   GET /api/campaigns
// @access  Private
router.get('/',
  authenticate,
  authorizePermission('campaigns', 'read'),
  sanitizeInput,
  auditLogger('campaigns_list_accessed', 'campaign'),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page doit être un entier positif'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite doit être entre 1 et 100'),
    query('status').optional().isIn(['draft', 'pending_approval', 'active', 'paused', 'completed', 'cancelled']),
    query('platform').optional().isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google']),
    query('managedBy').optional().isMongoId().withMessage('ID utilisateur invalide'),
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

    // Filtres par rôle et équipe
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.managedBy = req.user._id
      } else {
        filter.managedTeam = req.user.team
      }
    }

    // Filtres de requête
    if (req.query.status) filter.status = req.query.status
    if (req.query.platform) filter.platform = req.query.platform
    if (req.query.managedBy) filter.managedBy = req.query.managedBy
    if (req.query.team) filter.managedTeam = req.query.team

    // Filtre de recherche
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } }
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
    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .populate('managedBy', 'firstName lastName fullName email team')
        .populate('leadId', 'artistName email platform')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Campaign.countDocuments(filter)
    ])

    // Calculer les métadonnées de pagination
    const totalPages = Math.ceil(total / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    res.json({
      success: true,
      data: campaigns,
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

// @desc    Get campaign by ID
// @route   GET /api/campaigns/:id
// @access  Private
router.get('/:id',
  authenticate,
  authorizePermission('campaigns', 'read'),
  authorizeAssignment('Campaign'),
  auditLogger('campaign_viewed', 'campaign'),
  asyncHandler(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id)
      .populate('managedBy', 'firstName lastName fullName email team')
      .populate('leadId', 'artistName email platform budget')
      .populate('optimizations.performedBy', 'firstName lastName fullName')

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    res.json({
      success: true,
      data: campaign
    })
  })
)

// @desc    Create new campaign
// @route   POST /api/campaigns
// @access  Private
router.post('/',
  authenticate,
  authorizePermission('campaigns', 'create'),
  sanitizeInput,
  createCampaignValidation,
  auditLogger('campaign_created', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    // Vérifier que le lead existe et est gagné
    const lead = await Lead.findById(req.body.leadId)

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    if (lead.status !== 'won') {
      return res.status(400).json({
        success: false,
        message: 'Une campagne ne peut être créée que pour un lead gagné'
      })
    }

    // Vérifier les permissions d'accès au lead
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent' && !lead.assignedTo.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez pas créer une campagne pour ce lead'
        })
      }
      if (req.user.role === 'manager' && lead.assignedTeam !== req.user.team) {
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez pas créer une campagne pour ce lead'
        })
      }
    }

    // Déterminer l'équipe de gestion
    let managedTeam
    if (['youtube', 'spotify'].includes(req.body.platform)) {
      managedTeam = 'denis'
    } else if (['meta', 'tiktok'].includes(req.body.platform)) {
      managedTeam = 'marine'
    } else {
      // Pour Google, utiliser l'équipe du lead
      managedTeam = lead.assignedTeam
    }

    // Trouver un gestionnaire disponible
    const managers = await User.find({
      team: managedTeam,
      isActive: true,
      assignedPlatforms: req.body.platform
    }).sort({ 'stats.campaignsManaged': 1 })

    if (managers.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Aucun gestionnaire disponible pour cette plateforme'
      })
    }

    // Créer la campagne
    const campaignData = {
      ...req.body,
      managedBy: managers[0]._id,
      managedTeam,
      status: 'draft'
    }

    const campaign = await Campaign.create(campaignData)

    // Populate pour la réponse
    await campaign.populate([
      { path: 'managedBy', select: 'firstName lastName fullName email team' },
      { path: 'leadId', select: 'artistName email platform' }
    ])

    // Mettre à jour les stats du gestionnaire
    await User.findByIdAndUpdate(managers[0]._id, {
      $inc: { 'stats.campaignsManaged': 1 }
    })

    res.status(201).json({
      success: true,
      message: 'Campagne créée avec succès',
      data: campaign
    })
  })
)

// @desc    Update campaign
// @route   PUT /api/campaigns/:id
// @access  Private
router.put('/:id',
  authenticate,
  authorizePermission('campaigns', 'update'),
  authorizeAssignment('Campaign'),
  sanitizeInput,
  captureOriginalData(Campaign),
  updateCampaignValidation,
  auditLogger('campaign_updated', 'campaign'),
  auditStatusChange('campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const campaign = await Campaign.findById(req.params.id)

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    // Vérifications métier pour certains changements
    if (req.body.status && req.body.status !== campaign.status) {
      // Valider les transitions de statut
      const validTransitions = {
        'draft': ['pending_approval', 'cancelled'],
        'pending_approval': ['active', 'draft', 'cancelled'],
        'active': ['paused', 'completed', 'cancelled'],
        'paused': ['active', 'cancelled'],
        'completed': [],
        'cancelled': []
      }

      if (!validTransitions[campaign.status].includes(req.body.status)) {
        return res.status(400).json({
          success: false,
          message: `Transition de statut invalide: ${campaign.status} → ${req.body.status}`
        })
      }

      // Actions automatiques selon le nouveau statut
      if (req.body.status === 'active' && !campaign.actualStartDate) {
        req.body.actualStartDate = new Date()
      }

      if (['completed', 'cancelled'].includes(req.body.status) && !campaign.actualEndDate) {
        req.body.actualEndDate = new Date()
      }
    }

    // Vérifier que le budget dépensé n'excède pas le budget total
    if (req.body.spent && req.body.spent > (req.body.budget?.total || campaign.budget.total)) {
      return res.status(400).json({
        success: false,
        message: 'Le montant dépensé ne peut pas excéder le budget total'
      })
    }

    // Mettre à jour la campagne
    Object.assign(campaign, req.body)
    await campaign.save()

    // Populate pour la réponse
    await campaign.populate([
      { path: 'managedBy', select: 'firstName lastName fullName email team' },
      { path: 'leadId', select: 'artistName email platform' }
    ])

    res.json({
      success: true,
      message: 'Campagne mise à jour avec succès',
      data: campaign
    })
  })
)

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
// @access  Private
router.delete('/:id',
  authenticate,
  authorizePermission('campaigns', 'delete'),
  authorize('admin', 'manager'),
  captureOriginalData(Campaign),
  auditLogger('campaign_deleted', 'campaign'),
  asyncHandler(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id)

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    // Vérifier si la campagne peut être supprimée
    if (['active', 'completed'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer une campagne active ou terminée'
      })
    }

    await campaign.deleteOne()

    res.json({
      success: true,
      message: 'Campagne supprimée avec succès'
    })
  })
)

// @desc    Update campaign KPIs
// @route   POST /api/campaigns/:id/kpis
// @access  Private
router.post('/:id/kpis',
  authenticate,
  authorizePermission('campaigns', 'update'),
  authorizeAssignment('Campaign'),
  sanitizeInput,
  kpiValidation,
  auditLogger('campaign_kpis_updated', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données KPI invalides',
        errors: errors.array()
      })
    }

    const campaign = await Campaign.findById(req.params.id)

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    // Calculer automatiquement certains KPIs
    const kpis = { ...req.body }

    if (kpis.clicks && kpis.impressions) {
      kpis.ctr = (kpis.clicks / kpis.impressions * 100).toFixed(2)
    }

    if (kpis.spend && kpis.views) {
      kpis.cpv = (kpis.spend / kpis.views).toFixed(4)
    }

    if (kpis.spend && kpis.clicks) {
      kpis.cpc = (kpis.spend / kpis.clicks).toFixed(2)
    }

    if (kpis.spend && kpis.impressions) {
      kpis.cpm = (kpis.spend / kpis.impressions * 1000).toFixed(2)
    }

    await campaign.updateKpis(kpis)

    res.json({
      success: true,
      message: 'KPIs mis à jour avec succès',
      data: campaign.currentKpis
    })
  })
)

// @desc    Add optimization to campaign
// @route   POST /api/campaigns/:id/optimizations
// @access  Private
router.post('/:id/optimizations',
  authenticate,
  authorizePermission('campaigns', 'update'),
  authorizeAssignment('Campaign'),
  sanitizeInput,
  [
    body('type')
      .isIn(['budget', 'targeting', 'creative', 'bid', 'placement', 'schedule'])
      .withMessage('Type d\'optimisation invalide'),
    body('description')
      .notEmpty()
      .withMessage('Description requise')
      .isLength({ max: 500 })
      .withMessage('Description trop longue'),
    body('impact')
      .optional()
      .isLength({ max: 200 })
      .withMessage('Impact trop long')
  ],
  auditLogger('campaign_optimized', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { type, description, impact } = req.body

    const campaign = await Campaign.findById(req.params.id)

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    await campaign.addOptimization(type, description, req.user._id, impact)

    const addedOptimization = campaign.optimizations[campaign.optimizations.length - 1]

    res.status(201).json({
      success: true,
      message: 'Optimisation ajoutée avec succès',
      data: addedOptimization
    })
  })
)

// @desc    Add client feedback
// @route   POST /api/campaigns/:id/feedback
// @access  Private
router.post('/:id/feedback',
  authenticate,
  authorizePermission('campaigns', 'update'),
  authorizeAssignment('Campaign'),
  sanitizeInput,
  [
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('La note doit être entre 1 et 5'),
    body('comment')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Commentaire trop long'),
    body('category')
      .optional()
      .isIn(['performance', 'communication', 'reporting', 'overall'])
      .withMessage('Catégorie invalide')
  ],
  auditLogger('campaign_feedback_added', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { rating, comment, category = 'overall' } = req.body

    const campaign = await Campaign.findById(req.params.id)

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campagne non trouvée'
      })
    }

    await campaign.addClientFeedback(rating, comment, category)

    res.status(201).json({
      success: true,
      message: 'Feedback client ajouté avec succès'
    })
  })
)

// @desc    Get campaign performance stats
// @route   GET /api/campaigns/stats/performance
// @access  Private
router.get('/stats/performance',
  authenticate,
  authorizePermission('analytics', 'read'),
  auditLogger('campaign_stats_accessed', 'system'),
  asyncHandler(async (req, res) => {
    const managerId = req.user.role === 'agent' ? req.user._id : null
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null

    const stats = await Campaign.getPerformanceStats(managerId, startDate, endDate)

    res.json({
      success: true,
      data: stats[0] || {
        totalCampaigns: 0,
        activeCampaigns: 0,
        completedCampaigns: 0,
        totalBudget: 0,
        totalSpent: 0,
        avgPerformanceScore: 0,
        totalViews: 0,
        totalClicks: 0,
        avgCPV: 0,
        avgCTR: 0
      }
    })
  })
)

// @desc    Get campaigns needing optimization
// @route   GET /api/campaigns/optimization-needed
// @access  Private
router.get('/optimization-needed',
  authenticate,
  authorizePermission('campaigns', 'read'),
  auditLogger('campaigns_optimization_check', 'system'),
  asyncHandler(async (req, res) => {
    let campaigns = await Campaign.findNeedingOptimization()
      .populate('managedBy', 'firstName lastName fullName email')
      .populate('leadId', 'artistName email')

    // Filtrer selon les permissions
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        campaigns = campaigns.filter(campaign =>
          campaign.managedBy._id.equals(req.user._id)
        )
      } else {
        campaigns = campaigns.filter(campaign =>
          campaign.managedTeam === req.user.team
        )
      }
    }

    res.json({
      success: true,
      data: campaigns,
      count: campaigns.length
    })
  })
)

// @desc    Export campaigns
// @route   GET /api/campaigns/export/csv
// @access  Private
router.get('/export/csv',
  authenticate,
  authorizePermission('analytics', 'export'),
  auditDataExport('CSV', 'Export campagnes en CSV'),
  asyncHandler(async (req, res) => {
    // Construire le filtre selon les permissions
    let filter = {}

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.managedBy = req.user._id
      } else {
        filter.managedTeam = req.user.team
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

    const campaigns = await Campaign.find(filter)
      .populate('managedBy', 'firstName lastName fullName')
      .populate('leadId', 'artistName email')
      .lean()

    // Préparer les données CSV
    const csvData = campaigns.map(campaign => ({
      'ID': campaign._id,
      'Nom': campaign.name,
      'Plateforme': campaign.platform,
      'Statut': campaign.status,
      'Artiste': campaign.leadId?.artistName || '',
      'Gestionnaire': campaign.managedBy?.fullName || '',
      'Équipe': campaign.managedTeam,
      'Budget Total': campaign.budget?.total || '',
      'Dépensé': campaign.spent || '',
      'Date Début': campaign.startDate?.toISOString().split('T')[0] || '',
      'Date Fin': campaign.endDate?.toISOString().split('T')[0] || '',
      'Vues': campaign.currentKpis?.views || '',
      'Clics': campaign.currentKpis?.clicks || '',
      'CTR': campaign.currentKpis?.ctr || '',
      'CPV': campaign.currentKpis?.cpv || '',
      'Score Performance': campaign.performanceScore || '',
      'Date Création': campaign.createdAt?.toISOString().split('T')[0] || ''
    }))

    // Générer le CSV
    const headers = Object.keys(csvData[0] || {}).join(',')
    const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    const csv = [headers, ...rows].join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename=campaigns-${new Date().toISOString().split('T')[0]}.csv`)
    res.send(csv)
  })
)

export default router