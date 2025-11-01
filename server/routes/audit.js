import express from 'express'
import { query, validationResult } from 'express-validator'
import AuditLog from '../models/AuditLog.js'
import { authenticate, authorize, authorizePermission } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { auditLogger, auditDataExport, auditGDPRAction } from '../middleware/audit.js'
import { sanitizeInput } from '../middleware/security.js'

const router = express.Router()

// @desc    Get audit logs
// @route   GET /api/audit
// @access  Private (Admin only)
router.get('/',
  authenticate,
  authorize('admin'),
  sanitizeInput,
  auditLogger('audit_logs_accessed', 'system'),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page doit être un entier positif'),
    query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limite doit être entre 1 et 500'),
    query('action').optional().isString().withMessage('Action doit être une chaîne'),
    query('userId').optional().isMongoId().withMessage('ID utilisateur invalide'),
    query('resourceType').optional().isIn(['user', 'lead', 'campaign', 'setting', 'integration', 'system']),
    query('category').optional().isIn(['authentication', 'authorization', 'data_access', 'data_modification', 'system', 'security']),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    query('success').optional().isBoolean().withMessage('Success doit être un booléen'),
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
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
    const limit = parseInt(req.query.limit) || 50
    const skip = (page - 1) * limit

    // Construire le filtre
    let filter = {}

    // Filtres de requête
    if (req.query.action) filter.action = new RegExp(req.query.action, 'i')
    if (req.query.userId) filter.userId = req.query.userId
    if (req.query.resourceType) filter.resourceType = req.query.resourceType
    if (req.query.category) filter.category = req.query.category
    if (req.query.severity) filter.severity = req.query.severity
    if (req.query.success !== undefined) filter.success = req.query.success === 'true'

    // Filtres de date
    if (req.query.startDate || req.query.endDate) {
      filter.timestamp = {}
      if (req.query.startDate) filter.timestamp.$gte = new Date(req.query.startDate)
      if (req.query.endDate) filter.timestamp.$lte = new Date(req.query.endDate)
    }

    // Filtre de recherche global
    if (req.query.search) {
      filter.$or = [
        { description: { $regex: req.query.search, $options: 'i' } },
        { userEmail: { $regex: req.query.search, $options: 'i' } },
        { userName: { $regex: req.query.search, $options: 'i' } },
        { ipAddress: { $regex: req.query.search, $options: 'i' } }
      ]
    }

    // Options de tri (par défaut: plus récent en premier)
    let sort = { timestamp: -1 }
    if (req.query.sortBy) {
      const sortField = req.query.sortBy
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1
      sort = { [sortField]: sortOrder }
    }

    // Exécuter les requêtes
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('userId', 'firstName lastName fullName email team')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter)
    ])

    // Calculer les métadonnées de pagination
    const totalPages = Math.ceil(total / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    res.json({
      success: true,
      data: logs,
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

// @desc    Get audit log by ID
// @route   GET /api/audit/:id
// @access  Private (Admin only)
router.get('/:id',
  authenticate,
  authorize('admin'),
  auditLogger('audit_log_viewed', 'system'),
  asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(req.params.id)
      .populate('userId', 'firstName lastName fullName email team role')

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Log d\'audit non trouvé'
      })
    }

    res.json({
      success: true,
      data: log
    })
  })
)

// @desc    Get user activity
// @route   GET /api/audit/user/:userId
// @access  Private (Admin or self)
router.get('/user/:userId',
  authenticate,
  sanitizeInput,
  auditLogger('user_activity_accessed', 'system'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite doit être entre 1 et 100')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      })
    }

    const userId = req.params.userId

    // Vérifier les permissions
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }

    const startDate = req.query.startDate ? new Date(req.query.startDate) :
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 jours par défaut
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()
    const limit = parseInt(req.query.limit) || 50

    const activities = await AuditLog.getUserActivity(userId, startDate, endDate)

    res.json({
      success: true,
      data: activities.slice(0, limit),
      total: activities.length,
      filters: {
        startDate,
        endDate,
        limit
      }
    })
  })
)

// @desc    Get resource history
// @route   GET /api/audit/resource/:resourceType/:resourceId
// @access  Private (Admin or assigned user)
router.get('/resource/:resourceType/:resourceId',
  authenticate,
  sanitizeInput,
  auditLogger('resource_history_accessed', 'system'),
  asyncHandler(async (req, res) => {
    const { resourceType, resourceId } = req.params

    // Vérifier que le type de ressource est valide
    const validResourceTypes = ['user', 'lead', 'campaign', 'setting', 'integration']
    if (!validResourceTypes.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        message: 'Type de ressource invalide'
      })
    }

    // Pour les leads et campagnes, vérifier les permissions
    if (['lead', 'campaign'].includes(resourceType) && req.user.role !== 'admin') {
      try {
        // Import dynamique pour éviter les dépendances circulaires
        let Model
        if (resourceType === 'lead') {
          Model = (await import('../models/Lead.js')).default
        } else {
          Model = (await import('../models/Campaign.js')).default
        }

        const resource = await Model.findById(resourceId)
        if (!resource) {
          return res.status(404).json({
            success: false,
            message: 'Ressource non trouvée'
          })
        }

        // Vérifier l'assignation
        const assignedField = resourceType === 'lead' ? 'assignedTo' : 'managedBy'
        const teamField = resourceType === 'lead' ? 'assignedTeam' : 'managedTeam'

        if (req.user.role === 'agent') {
          if (!resource[assignedField].equals(req.user._id)) {
            return res.status(403).json({
              success: false,
              message: 'Accès refusé'
            })
          }
        } else if (req.user.role === 'manager') {
          if (resource[teamField] !== req.user.team) {
            return res.status(403).json({
              success: false,
              message: 'Accès refusé'
            })
          }
        }
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de la vérification des permissions'
        })
      }
    }

    const history = await AuditLog.getResourceHistory(resourceType, resourceId)

    res.json({
      success: true,
      data: history,
      total: history.length
    })
  })
)

// @desc    Get security events
// @route   GET /api/audit/security
// @access  Private (Admin only)
router.get('/security/events',
  authenticate,
  authorize('admin'),
  sanitizeInput,
  auditLogger('security_events_accessed', 'system'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
    query('severity').optional().isIn(['medium', 'high', 'critical']).withMessage('Sévérité invalide')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      })
    }

    const startDate = req.query.startDate ? new Date(req.query.startDate) :
      new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 heures par défaut
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()

    const events = await AuditLog.getSecurityEvents(startDate, endDate)

    // Filtrer par sévérité si spécifiée
    let filteredEvents = events
    if (req.query.severity) {
      filteredEvents = events.filter(event => event.severity === req.query.severity)
    }

    res.json({
      success: true,
      data: filteredEvents,
      total: filteredEvents.length,
      filters: {
        startDate,
        endDate,
        severity: req.query.severity
      }
    })
  })
)

// @desc    Get activity statistics
// @route   GET /api/audit/stats
// @access  Private (Admin only)
router.get('/stats/activity',
  authenticate,
  authorize('admin'),
  auditLogger('audit_stats_accessed', 'system'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      })
    }

    const startDate = req.query.startDate ? new Date(req.query.startDate) :
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 jours par défaut
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()

    const [
      activityStats,
      topUsers,
      suspiciousActivity
    ] = await Promise.all([
      AuditLog.getActivityStats(startDate, endDate),
      AuditLog.getTopUsers(startDate, endDate, 10),
      AuditLog.findSuspiciousActivity()
    ])

    res.json({
      success: true,
      data: {
        activityByAction: activityStats,
        topActiveUsers: topUsers,
        suspiciousActivity,
        summary: {
          totalEvents: activityStats.reduce((sum, stat) => sum + stat.count, 0),
          securityEvents: suspiciousActivity.length,
          period: {
            start: startDate,
            end: endDate
          }
        }
      }
    })
  })
)

// @desc    Export audit logs
// @route   GET /api/audit/export
// @access  Private (Admin only)
router.get('/export/csv',
  authenticate,
  authorize('admin'),
  auditDataExport('CSV', 'Export logs d\'audit en CSV'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
    query('category').optional().isIn(['authentication', 'authorization', 'data_access', 'data_modification', 'system', 'security'])
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres invalides',
        errors: errors.array()
      })
    }

    // Construire le filtre
    let filter = {}

    if (req.query.startDate || req.query.endDate) {
      filter.timestamp = {}
      if (req.query.startDate) filter.timestamp.$gte = new Date(req.query.startDate)
      if (req.query.endDate) filter.timestamp.$lte = new Date(req.query.endDate)
    }

    if (req.query.category) {
      filter.category = req.query.category
    }

    // Limiter l'export pour éviter les gros fichiers
    const logs = await AuditLog.find(filter)
      .populate('userId', 'firstName lastName fullName email')
      .sort({ timestamp: -1 })
      .limit(10000) // Limite à 10k entrées
      .lean()

    // Préparer les données CSV
    const csvData = logs.map(log => ({
      'Date/Heure': log.timestamp.toISOString(),
      'Utilisateur': log.userName || 'System',
      'Email': log.userEmail || '',
      'Action': log.action,
      'Ressource': log.resourceType,
      'Description': log.description,
      'Catégorie': log.category,
      'Sévérité': log.severity,
      'Succès': log.success ? 'Oui' : 'Non',
      'IP': log.ipAddress || '',
      'URL': log.requestUrl || '',
      'Méthode': log.requestMethod || ''
    }))

    // Générer le CSV
    if (csvData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucun log trouvé pour les critères spécifiés'
      })
    }

    const headers = Object.keys(csvData[0]).join(',')
    const rows = csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    const csv = [headers, ...rows].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.csv`)
    res.send('\uFEFF' + csv) // BOM pour UTF-8
  })
)

// @desc    Get GDPR data for a user
// @route   GET /api/audit/gdpr/:email
// @access  Private (Admin only)
router.get('/gdpr/:email',
  authenticate,
  authorize('admin'),
  auditGDPRAction('gdpr_data_accessed', 'Accès aux données GDPR d\'un utilisateur'),
  asyncHandler(async (req, res) => {
    const email = req.params.email

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email invalide'
      })
    }

    const gdprLogs = await AuditLog.getGDPRLogs(email)

    res.json({
      success: true,
      data: gdprLogs,
      total: gdprLogs.length,
      email
    })
  })
)

// @desc    Archive old logs
// @route   POST /api/audit/archive
// @access  Private (Admin only)
router.post('/archive',
  authenticate,
  authorize('admin'),
  auditLogger('audit_logs_archived', 'system'),
  [
    query('daysOld').optional().isInt({ min: 30 }).withMessage('daysOld doit être au minimum 30')
  ],
  asyncHandler(async (req, res) => {
    const daysOld = parseInt(req.query.daysOld) || 365

    const result = await AuditLog.archiveOldLogs(daysOld)

    res.json({
      success: true,
      message: `${result.modifiedCount} logs archivés avec succès`,
      archivedCount: result.modifiedCount,
      criteria: {
        olderThanDays: daysOld
      }
    })
  })
)

// @desc    Get suspicious activity summary
// @route   GET /api/audit/security/suspicious
// @access  Private (Admin only)
router.get('/security/suspicious',
  authenticate,
  authorize('admin'),
  auditLogger('suspicious_activity_checked', 'system'),
  asyncHandler(async (req, res) => {
    const suspiciousActivity = await AuditLog.findSuspiciousActivity()

    // Grouper par type d'activité suspecte
    const summary = {
      multipleFailedLogins: suspiciousActivity.filter(activity =>
        activity.actions.includes('user_login_failed')
      ),
      rapidRequests: suspiciousActivity.filter(activity =>
        activity.actions.includes('rapid_requests')
      ),
      accessDenied: suspiciousActivity.filter(activity =>
        activity.actions.includes('access_denied')
      )
    }

    res.json({
      success: true,
      data: {
        total: suspiciousActivity.length,
        summary,
        details: suspiciousActivity
      }
    })
  })
)

export default router