import express from 'express'
import { query, validationResult } from 'express-validator'
import Lead from '../models/Lead.js'
import Campaign from '../models/Campaign.js'
import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import { authenticate, authorize, authorizePermission } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { auditLogger } from '../middleware/audit.js'
import { sanitizeInput } from '../middleware/security.js'

const router = express.Router()

// @desc    Get dashboard overview
// @route   GET /api/analytics/dashboard
// @access  Private
router.get('/dashboard',
  authenticate,
  authorizePermission('analytics', 'read'),
  sanitizeInput,
  auditLogger('dashboard_accessed', 'system'),
  [
    query('period')
      .optional()
      .isIn(['today', 'week', 'month', 'quarter', 'year'])
      .withMessage('Période invalide'),
    query('team')
      .optional()
      .isIn(['denis', 'marine'])
      .withMessage('Équipe invalide')
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

    const period = req.query.period || 'month'
    const team = req.query.team

    // Calculer les dates selon la période
    const now = new Date()
    let startDate, endDate = now

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        const weekAgo = new Date(now)
        weekAgo.setDate(now.getDate() - 7)
        startDate = weekAgo
        break
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3)
        startDate = new Date(now.getFullYear(), quarter * 3, 1)
        break
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1)
        break
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    // Construire les filtres selon les permissions
    let leadsFilter = { createdAt: { $gte: startDate, $lte: endDate } }
    let campaignsFilter = { createdAt: { $gte: startDate, $lte: endDate } }

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        leadsFilter.assignedTo = req.user._id
        campaignsFilter.managedBy = req.user._id
      } else {
        leadsFilter.assignedTeam = req.user.team
        campaignsFilter.managedTeam = req.user.team
      }
    }

    if (team) {
      leadsFilter.assignedTeam = team
      campaignsFilter.managedTeam = team
    }

    // Agrégations parallèles pour les performances
    const [
      leadsStats,
      campaignsStats,
      revenueStats,
      conversionRates,
      platformStats,
      recentActivity
    ] = await Promise.all([
      // Stats des leads
      Lead.aggregate([
        { $match: leadsFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
            contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
            qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
            avgScore: { $avg: '$leadScore' },
            avgBudget: { $avg: '$budget' }
          }
        }
      ]),

      // Stats des campagnes
      Campaign.aggregate([
        { $match: campaignsFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            paused: { $sum: { $cond: [{ $eq: ['$status', 'paused'] }, 1, 0] } },
            totalBudget: { $sum: '$budget.total' },
            totalSpent: { $sum: '$spent' },
            avgPerformance: { $avg: '$performanceScore' }
          }
        }
      ]),

      // Stats de revenus
      Lead.aggregate([
        {
          $match: {
            ...leadsFilter,
            status: 'won',
            dealValue: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$dealValue' },
            avgDealSize: { $avg: '$dealValue' },
            totalCommission: { $sum: '$commission' }
          }
        }
      ]),

      // Taux de conversion par étape du pipeline
      Lead.aggregate([
        { $match: leadsFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Stats par plateforme
      Lead.aggregate([
        { $match: leadsFilter },
        {
          $group: {
            _id: '$platform',
            count: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            totalValue: { $sum: '$dealValue' },
            avgScore: { $avg: '$leadScore' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Activité récente
      AuditLog.find({
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        category: { $in: ['data_access', 'data_modification'] }
      })
        .populate('userId', 'firstName lastName fullName')
        .sort({ timestamp: -1 })
        .limit(10)
        .lean()
    ])

    // Calculer les métriques dérivées
    const totalLeads = leadsStats[0]?.total || 0
    const wonLeads = leadsStats[0]?.won || 0
    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(2) : 0

    const totalBudget = campaignsStats[0]?.totalBudget || 0
    const totalSpent = campaignsStats[0]?.totalSpent || 0
    const budgetUtilization = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(2) : 0

    const totalRevenue = revenueStats[0]?.totalRevenue || 0
    const roi = totalSpent > 0 ? (((totalRevenue - totalSpent) / totalSpent) * 100).toFixed(2) : 0

    // Évolution temporelle (comparaison avec la période précédente)
    const previousPeriodStart = new Date(startDate)
    const periodDuration = endDate - startDate
    previousPeriodStart.setTime(startDate.getTime() - periodDuration)

    const previousPeriodFilter = {
      ...leadsFilter,
      createdAt: { $gte: previousPeriodStart, $lt: startDate }
    }

    const [previousLeadsStats, previousRevenueStats] = await Promise.all([
      Lead.aggregate([
        { $match: previousPeriodFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } }
          }
        }
      ]),
      Lead.aggregate([
        {
          $match: {
            ...previousPeriodFilter,
            status: 'won',
            dealValue: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$dealValue' }
          }
        }
      ])
    ])

    const previousTotalLeads = previousLeadsStats[0]?.total || 0
    const previousTotalRevenue = previousRevenueStats[0]?.totalRevenue || 0

    const leadsGrowth = previousTotalLeads > 0
      ? (((totalLeads - previousTotalLeads) / previousTotalLeads) * 100).toFixed(2)
      : totalLeads > 0 ? 100 : 0

    const revenueGrowth = previousTotalRevenue > 0
      ? (((totalRevenue - previousTotalRevenue) / previousTotalRevenue) * 100).toFixed(2)
      : totalRevenue > 0 ? 100 : 0

    res.json({
      success: true,
      data: {
        period,
        dateRange: {
          start: startDate,
          end: endDate
        },
        summary: {
          leads: {
            total: totalLeads,
            new: leadsStats[0]?.new || 0,
            contacted: leadsStats[0]?.contacted || 0,
            qualified: leadsStats[0]?.qualified || 0,
            won: wonLeads,
            lost: leadsStats[0]?.lost || 0,
            conversionRate: parseFloat(conversionRate),
            avgScore: Math.round(leadsStats[0]?.avgScore || 0),
            avgBudget: Math.round(leadsStats[0]?.avgBudget || 0),
            growth: parseFloat(leadsGrowth)
          },
          campaigns: {
            total: campaignsStats[0]?.total || 0,
            active: campaignsStats[0]?.active || 0,
            completed: campaignsStats[0]?.completed || 0,
            paused: campaignsStats[0]?.paused || 0,
            totalBudget: Math.round(totalBudget),
            totalSpent: Math.round(totalSpent),
            budgetUtilization: parseFloat(budgetUtilization),
            avgPerformance: Math.round(campaignsStats[0]?.avgPerformance || 0)
          },
          revenue: {
            total: Math.round(totalRevenue),
            avgDealSize: Math.round(revenueStats[0]?.avgDealSize || 0),
            totalCommission: Math.round(revenueStats[0]?.totalCommission || 0),
            roi: parseFloat(roi),
            growth: parseFloat(revenueGrowth)
          }
        },
        charts: {
          conversionFunnel: conversionRates,
          platformPerformance: platformStats,
          recentActivity: recentActivity
        }
      }
    })
  })
)

// @desc    Get leads analytics
// @route   GET /api/analytics/leads
// @access  Private
router.get('/leads',
  authenticate,
  authorizePermission('analytics', 'read'),
  sanitizeInput,
  auditLogger('leads_analytics_accessed', 'system'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
    query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Groupement invalide'),
    query('platform').optional().isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google', 'multiple'])
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
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 jours par défaut
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()
    const groupBy = req.query.groupBy || 'day'
    const platform = req.query.platform

    // Construire le filtre selon les permissions
    let filter = {
      createdAt: { $gte: startDate, $lte: endDate }
    }

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.assignedTo = req.user._id
      } else {
        filter.assignedTeam = req.user.team
      }
    }

    if (platform) {
      filter.platform = platform
    }

    // Format de groupement par date
    let dateFormat
    switch (groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d'
        break
      case 'week':
        dateFormat = '%Y-%U'
        break
      case 'month':
        dateFormat = '%Y-%m'
        break
      default:
        dateFormat = '%Y-%m-%d'
    }

    const [
      timelineData,
      statusDistribution,
      sourceAnalysis,
      platformAnalysis,
      leadScoreAnalysis,
      topPerformers
    ] = await Promise.all([
      // Timeline des leads
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: dateFormat, date: '$createdAt' } },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]),

      // Distribution par statut
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgScore: { $avg: '$leadScore' },
            totalValue: { $sum: '$dealValue' }
          }
        }
      ]),

      // Analyse par source
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 },
            conversionRate: {
              $avg: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            avgScore: { $avg: '$leadScore' },
            avgBudget: { $avg: '$budget' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Analyse par plateforme
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$platform',
            count: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            avgScore: { $avg: '$leadScore' },
            totalValue: { $sum: '$dealValue' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Analyse du score des leads
      Lead.aggregate([
        { $match: filter },
        {
          $bucket: {
            groupBy: '$leadScore',
            boundaries: [0, 25, 50, 75, 100],
            default: 'other',
            output: {
              count: { $sum: 1 },
              conversionRate: {
                $avg: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
              }
            }
          }
        }
      ]),

      // Top performers (utilisateurs)
      Lead.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$assignedTo',
            totalLeads: { $sum: 1 },
            wonLeads: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            totalValue: { $sum: '$dealValue' },
            avgScore: { $avg: '$leadScore' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userName: '$user.fullName',
            team: '$user.team',
            totalLeads: 1,
            wonLeads: 1,
            conversionRate: {
              $cond: [
                { $gt: ['$totalLeads', 0] },
                { $multiply: [{ $divide: ['$wonLeads', '$totalLeads'] }, 100] },
                0
              ]
            },
            totalValue: 1,
            avgScore: 1
          }
        },
        { $sort: { conversionRate: -1 } },
        { $limit: 10 }
      ])
    ])

    res.json({
      success: true,
      data: {
        timelineData,
        statusDistribution,
        sourceAnalysis,
        platformAnalysis,
        leadScoreAnalysis,
        topPerformers,
        filters: {
          startDate,
          endDate,
          groupBy,
          platform
        }
      }
    })
  })
)

// @desc    Get campaigns analytics
// @route   GET /api/analytics/campaigns
// @access  Private
router.get('/campaigns',
  authenticate,
  authorizePermission('analytics', 'read'),
  sanitizeInput,
  auditLogger('campaigns_analytics_accessed', 'system'),
  [
    query('startDate').optional().isISO8601().withMessage('Date de début invalide'),
    query('endDate').optional().isISO8601().withMessage('Date de fin invalide'),
    query('platform').optional().isIn(['youtube', 'spotify', 'meta', 'tiktok', 'google'])
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
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()
    const platform = req.query.platform

    // Construire le filtre selon les permissions
    let filter = {
      createdAt: { $gte: startDate, $lte: endDate }
    }

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        filter.managedBy = req.user._id
      } else {
        filter.managedTeam = req.user.team
      }
    }

    if (platform) {
      filter.platform = platform
    }

    const [
      performanceOverview,
      platformComparison,
      budgetAnalysis,
      topCampaigns,
      optimizationImpact
    ] = await Promise.all([
      // Vue d'ensemble des performances
      Campaign.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalCampaigns: { $sum: 1 },
            activeCampaigns: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            totalBudget: { $sum: '$budget.total' },
            totalSpent: { $sum: '$spent' },
            totalViews: { $sum: '$currentKpis.views' },
            totalClicks: { $sum: '$currentKpis.clicks' },
            avgCTR: { $avg: '$currentKpis.ctr' },
            avgCPV: { $avg: '$currentKpis.cpv' },
            avgPerformance: { $avg: '$performanceScore' }
          }
        }
      ]),

      // Comparaison par plateforme
      Campaign.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$platform',
            count: { $sum: 1 },
            totalBudget: { $sum: '$budget.total' },
            totalSpent: { $sum: '$spent' },
            totalViews: { $sum: '$currentKpis.views' },
            totalClicks: { $sum: '$currentKpis.clicks' },
            avgCTR: { $avg: '$currentKpis.ctr' },
            avgCPV: { $avg: '$currentKpis.cpv' },
            avgPerformance: { $avg: '$performanceScore' }
          }
        },
        { $sort: { totalSpent: -1 } }
      ]),

      // Analyse du budget
      Campaign.aggregate([
        { $match: filter },
        {
          $project: {
            name: 1,
            platform: 1,
            totalBudget: '$budget.total',
            spent: 1,
            utilization: {
              $cond: [
                { $gt: ['$budget.total', 0] },
                { $multiply: [{ $divide: ['$spent', '$budget.total'] }, 100] },
                0
              ]
            },
            efficiency: {
              $cond: [
                { $gt: ['$spent', 0] },
                { $divide: ['$currentKpis.views', '$spent'] },
                0
              ]
            }
          }
        },
        { $sort: { utilization: -1 } }
      ]),

      // Top campagnes par performance
      Campaign.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'leads',
            localField: 'leadId',
            foreignField: '_id',
            as: 'lead'
          }
        },
        { $unwind: '$lead' },
        {
          $project: {
            name: 1,
            platform: 1,
            artistName: '$lead.artistName',
            performanceScore: 1,
            totalViews: '$currentKpis.views',
            totalClicks: '$currentKpis.clicks',
            ctr: '$currentKpis.ctr',
            cpv: '$currentKpis.cpv',
            spent: 1,
            roi: {
              $cond: [
                { $gt: ['$spent', 0] },
                { $multiply: [
                  { $divide: [
                    { $subtract: ['$currentKpis.conversionValue', '$spent'] },
                    '$spent'
                  ]}, 100
                ]},
                0
              ]
            }
          }
        },
        { $sort: { performanceScore: -1 } },
        { $limit: 10 }
      ]),

      // Impact des optimisations
      Campaign.aggregate([
        { $match: filter },
        { $unwind: '$optimizations' },
        {
          $group: {
            _id: '$optimizations.type',
            count: { $sum: 1 },
            avgImpact: { $avg: 1 } // Placeholder - en réalité il faudrait mesurer l'impact réel
          }
        },
        { $sort: { count: -1 } }
      ])
    ])

    res.json({
      success: true,
      data: {
        performanceOverview: performanceOverview[0] || {},
        platformComparison,
        budgetAnalysis,
        topCampaigns,
        optimizationImpact,
        filters: {
          startDate,
          endDate,
          platform
        }
      }
    })
  })
)

// @desc    Get team performance comparison
// @route   GET /api/analytics/teams
// @access  Private
router.get('/teams',
  authenticate,
  authorize('admin', 'manager'),
  auditLogger('team_analytics_accessed', 'system'),
  asyncHandler(async (req, res) => {
    const startDate = req.query.startDate ? new Date(req.query.startDate) :
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date()

    const [denisTeamStats, marineTeamStats] = await Promise.all([
      // Stats équipe Denis
      Promise.all([
        Lead.aggregate([
          {
            $match: {
              assignedTeam: 'denis',
              createdAt: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
              wonLeads: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
              totalValue: { $sum: '$dealValue' },
              avgScore: { $avg: '$leadScore' }
            }
          }
        ]),
        Campaign.aggregate([
          {
            $match: {
              managedTeam: 'denis',
              createdAt: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalCampaigns: { $sum: 1 },
              totalSpent: { $sum: '$spent' },
              avgPerformance: { $avg: '$performanceScore' }
            }
          }
        ])
      ]),

      // Stats équipe Marine
      Promise.all([
        Lead.aggregate([
          {
            $match: {
              assignedTeam: 'marine',
              createdAt: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalLeads: { $sum: 1 },
              wonLeads: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
              totalValue: { $sum: '$dealValue' },
              avgScore: { $avg: '$leadScore' }
            }
          }
        ]),
        Campaign.aggregate([
          {
            $match: {
              managedTeam: 'marine',
              createdAt: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalCampaigns: { $sum: 1 },
              totalSpent: { $sum: '$spent' },
              avgPerformance: { $avg: '$performanceScore' }
            }
          }
        ])
      ])
    ])

    const denisData = {
      team: 'denis',
      leads: denisTeamStats[0][0] || {},
      campaigns: denisTeamStats[1][0] || {},
      conversionRate: denisTeamStats[0][0] ?
        ((denisTeamStats[0][0].wonLeads / denisTeamStats[0][0].totalLeads) * 100).toFixed(2) : 0
    }

    const marineData = {
      team: 'marine',
      leads: marineTeamStats[0][0] || {},
      campaigns: marineTeamStats[1][0] || {},
      conversionRate: marineTeamStats[0][0] ?
        ((marineTeamStats[0][0].wonLeads / marineTeamStats[0][0].totalLeads) * 100).toFixed(2) : 0
    }

    res.json({
      success: true,
      data: {
        denis: denisData,
        marine: marineData,
        comparison: {
          leadsDifference: (denisData.leads.totalLeads || 0) - (marineData.leads.totalLeads || 0),
          revenueDifference: (denisData.leads.totalValue || 0) - (marineData.leads.totalValue || 0),
          performanceDifference: (denisData.campaigns.avgPerformance || 0) - (marineData.campaigns.avgPerformance || 0)
        },
        filters: {
          startDate,
          endDate
        }
      }
    })
  })
)

export default router