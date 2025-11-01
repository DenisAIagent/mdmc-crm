import Lead from '../models/Lead.js'
import User from '../models/User.js'
import Campaign from '../models/Campaign.js'
import AuditLog from '../models/AuditLog.js'
import { logger } from '../utils/logger.js'
import mongoose from 'mongoose'

/**
 * Contrôleur Analytics avec métriques temps réel calculées depuis MongoDB
 * Toutes les données proviennent de vrais calculs sur la base de données
 */

/**
 * @desc    Dashboard principal avec métriques temps réel
 * @route   GET /api/analytics/dashboard
 * @access  Private
 */
export const getDashboardMetrics = async (req, res) => {
  try {
    const { period = '30', teamFilter, userFilter } = req.query

    // Calcul des dates selon la période
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - parseInt(period))

    // Construction du filtre basé sur les permissions utilisateur
    let baseFilter = { isArchived: false }

    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        baseFilter.assignedTo = req.user._id
      } else if (req.user.role === 'manager') {
        baseFilter.assignedTeam = req.user.team
      }
    }

    // Application des filtres supplémentaires
    if (teamFilter && req.user.role === 'admin') {
      baseFilter.assignedTeam = teamFilter
    }
    if (userFilter && req.user.role === 'admin') {
      baseFilter.assignedTo = new mongoose.Types.ObjectId(userFilter)
    }

    // 1. Métriques générales des leads
    const [
      totalLeads,
      newLeadsThisPeriod,
      leadsThisMonth,
      leadsLastMonth,
      conversionStats,
      revenueStats,
      leadsByStatus,
      leadsByPlatform,
      leadsBySource,
      performanceByUser,
      pipelineValue,
      overdueFollowUps,
      topPerformers,
      recentActivity
    ] = await Promise.all([
      // Total des leads
      Lead.countDocuments(baseFilter),

      // Nouveaux leads cette période
      Lead.countDocuments({
        ...baseFilter,
        createdAt: { $gte: startDate, $lte: endDate }
      }),

      // Leads ce mois
      Lead.countDocuments({
        ...baseFilter,
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          $lte: new Date()
        }
      }),

      // Leads le mois dernier
      Lead.countDocuments({
        ...baseFilter,
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
          $lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      }),

      // Statistiques de conversion
      Lead.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: null,
            totalLeads: { $sum: 1 },
            wonLeads: {
              $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            lostLeads: {
              $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] }
            },
            qualifiedLeads: {
              $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] }
            },
            contactedLeads: {
              $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] }
            }
          }
        }
      ]),

      // Statistiques de revenus
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: 'won',
            dealValue: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$dealValue' },
            avgDealValue: { $avg: '$dealValue' },
            dealsCount: { $sum: 1 },
            totalCommission: { $sum: '$commission' }
          }
        }
      ]),

      // Répartition par statut
      Lead.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ['$dealValue', 0] } }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Répartition par plateforme
      Lead.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: '$platform',
            count: { $sum: 1 },
            wonCount: {
              $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            totalValue: { $sum: { $ifNull: ['$dealValue', 0] } },
            avgScore: { $avg: '$leadScore' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Répartition par source
      Lead.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 },
            conversionRate: {
              $avg: {
                $cond: [{ $eq: ['$status', 'won'] }, 1, 0]
              }
            }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Performance par utilisateur (si admin/manager)
      req.user.role !== 'agent' ? Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$assignedTo',
            leadsCount: { $sum: 1 },
            wonCount: {
              $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            totalValue: { $sum: { $ifNull: ['$dealValue', 0] } },
            avgResponseTime: { $avg: '$responseTime' }
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
            _id: 1,
            userName: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            userTeam: '$user.team',
            leadsCount: 1,
            wonCount: 1,
            totalValue: 1,
            conversionRate: {
              $multiply: [
                { $divide: ['$wonCount', '$leadsCount'] },
                100
              ]
            },
            avgResponseTime: 1
          }
        },
        { $sort: { totalValue: -1 } }
      ]) : [],

      // Valeur totale du pipeline
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: ['qualified', 'proposal_sent', 'negotiation'] },
            budget: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalPipelineValue: { $sum: '$budget' },
            qualifiedValue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'qualified'] },
                  '$budget',
                  0
                ]
              }
            },
            proposalValue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'proposal_sent'] },
                  '$budget',
                  0
                ]
              }
            },
            negotiationValue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'negotiation'] },
                  '$budget',
                  0
                ]
              }
            }
          }
        }
      ]),

      // Follow-ups en retard
      Lead.countDocuments({
        ...baseFilter,
        nextFollowUp: { $lt: new Date() },
        status: { $nin: ['won', 'lost'] }
      }),

      // Top performers ce mois
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            wonDate: {
              $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              $lte: new Date()
            }
          }
        },
        {
          $group: {
            _id: '$assignedTo',
            dealsWon: { $sum: 1 },
            totalRevenue: { $sum: '$dealValue' }
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
            userName: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            userTeam: '$user.team',
            dealsWon: 1,
            totalRevenue: 1
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 5 }
      ]),

      // Activité récente
      Lead.find(baseFilter)
        .sort({ lastActivityDate: -1 })
        .limit(10)
        .populate('assignedTo', 'firstName lastName')
        .select('artistName status lastActivityDate assignedTo platform')
    ])

    // Calcul des taux de croissance
    const growthRate = leadsLastMonth > 0
      ? ((leadsThisMonth - leadsLastMonth) / leadsLastMonth * 100).toFixed(1)
      : 0

    // Calcul du taux de conversion global
    const conversionData = conversionStats[0] || {}
    const globalConversionRate = conversionData.totalLeads > 0
      ? (conversionData.wonLeads / conversionData.totalLeads * 100).toFixed(1)
      : 0

    // Calcul de la vélocité des ventes (temps moyen de conversion)
    const wonLeadsWithTimes = await Lead.find({
      ...baseFilter,
      status: 'won',
      firstContactDate: { $exists: true },
      wonDate: { $exists: true }
    }).select('firstContactDate wonDate')

    const avgSalesVelocity = wonLeadsWithTimes.length > 0
      ? wonLeadsWithTimes.reduce((acc, lead) => {
          const days = Math.ceil((lead.wonDate - lead.firstContactDate) / (1000 * 60 * 60 * 24))
          return acc + days
        }, 0) / wonLeadsWithTimes.length
      : 0

    // Assemblage des métriques du dashboard
    const dashboardData = {
      overview: {
        totalLeads,
        newLeadsThisPeriod,
        leadsThisMonth,
        growthRate: parseFloat(growthRate),
        conversionRate: parseFloat(globalConversionRate),
        totalRevenue: revenueStats[0]?.totalRevenue || 0,
        avgDealValue: revenueStats[0]?.avgDealValue || 0,
        pipelineValue: pipelineValue[0]?.totalPipelineValue || 0,
        overdueFollowUps,
        avgSalesVelocity: Math.round(avgSalesVelocity)
      },
      charts: {
        leadsByStatus: leadsByStatus.map(item => ({
          status: item._id,
          count: item.count,
          value: item.value
        })),
        leadsByPlatform: leadsByPlatform.map(item => ({
          platform: item._id,
          count: item.count,
          wonCount: item.wonCount,
          conversionRate: item.count > 0 ? (item.wonCount / item.count * 100).toFixed(1) : 0,
          totalValue: item.totalValue,
          avgScore: Math.round(item.avgScore || 0)
        })),
        leadsBySource: leadsBySource.map(item => ({
          source: item._id,
          count: item.count,
          conversionRate: (item.conversionRate * 100).toFixed(1)
        })),
        performanceByUser: performanceByUser.map(item => ({
          userId: item._id,
          userName: item.userName,
          team: item.userTeam,
          leadsCount: item.leadsCount,
          wonCount: item.wonCount,
          totalValue: item.totalValue,
          conversionRate: item.conversionRate?.toFixed(1) || 0,
          avgResponseTime: Math.round(item.avgResponseTime || 0)
        }))
      },
      pipeline: {
        qualified: pipelineValue[0]?.qualifiedValue || 0,
        proposal: pipelineValue[0]?.proposalValue || 0,
        negotiation: pipelineValue[0]?.negotiationValue || 0,
        total: pipelineValue[0]?.totalPipelineValue || 0
      },
      topPerformers: topPerformers.map(performer => ({
        userName: performer.userName,
        team: performer.userTeam,
        dealsWon: performer.dealsWon,
        revenue: performer.totalRevenue
      })),
      recentActivity: recentActivity.map(activity => ({
        leadId: activity._id,
        artistName: activity.artistName,
        status: activity.status,
        platform: activity.platform,
        lastActivity: activity.lastActivityDate,
        assignedTo: activity.assignedTo?.firstName + ' ' + activity.assignedTo?.lastName
      }))
    }

    // Log de l'accès au dashboard
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'dashboard_accessed',
      resourceType: 'analytics',
      description: `Consultation du dashboard analytics (période: ${period} jours)`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: {
        period,
        teamFilter,
        userFilter,
        totalLeads,
        newLeadsThisPeriod
      }
    })

    res.status(200).json({
      success: true,
      data: dashboardData,
      generatedAt: new Date(),
      period: parseInt(period)
    })

  } catch (error) {
    logger.error('Erreur lors de la génération du dashboard:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'dashboard_accessed',
      resourceType: 'analytics',
      description: 'Échec de la consultation du dashboard',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard'
    })
  }
}

/**
 * @desc    Métriques de performance individuelle
 * @route   GET /api/analytics/performance/:userId
 * @access  Private
 */
export const getUserPerformance = async (req, res) => {
  try {
    const { userId } = req.params
    const { startDate, endDate } = req.query

    // Vérification des permissions
    if (req.user.role === 'agent' && req.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Vous ne pouvez consulter que vos propres performances.'
      })
    }

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Filtres de date
    const dateFilter = {}
    if (startDate) dateFilter.$gte = new Date(startDate)
    if (endDate) dateFilter.$lte = new Date(endDate)

    const leadFilter = {
      assignedTo: new mongoose.Types.ObjectId(userId),
      isArchived: false
    }
    if (startDate || endDate) {
      leadFilter.createdAt = dateFilter
    }

    // Calculs des métriques de performance
    const [
      totalLeads,
      leadsByStatus,
      avgResponseTime,
      conversionData,
      monthlyPerformance,
      recentDeals,
      followUpStats
    ] = await Promise.all([
      // Total des leads assignés
      Lead.countDocuments(leadFilter),

      // Répartition par statut
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: { $ifNull: ['$dealValue', 0] } }
          }
        }
      ]),

      // Temps de réponse moyen
      Lead.aggregate([
        {
          $match: {
            ...leadFilter,
            responseTime: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            avgResponseTime: { $avg: '$responseTime' }
          }
        }
      ]),

      // Données de conversion
      Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: null,
            totalLeads: { $sum: 1 },
            wonLeads: {
              $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            totalRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'won'] },
                  { $ifNull: ['$dealValue', 0] },
                  0
                ]
              }
            },
            avgLeadScore: { $avg: '$leadScore' }
          }
        }
      ]),

      // Performance mensuelle (6 derniers mois)
      Lead.aggregate([
        {
          $match: {
            assignedTo: new mongoose.Types.ObjectId(userId),
            isArchived: false,
            createdAt: {
              $gte: new Date(new Date().setMonth(new Date().getMonth() - 6))
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            leadsCount: { $sum: 1 },
            wonCount: {
              $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
            },
            revenue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'won'] },
                  { $ifNull: ['$dealValue', 0] },
                  0
                ]
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      // Deals récents gagnés
      Lead.find({
        assignedTo: userId,
        status: 'won',
        isArchived: false
      })
        .sort({ wonDate: -1 })
        .limit(5)
        .select('artistName dealValue wonDate platform'),

      // Statistiques de suivi
      Lead.aggregate([
        {
          $match: {
            assignedTo: new mongoose.Types.ObjectId(userId),
            isArchived: false
          }
        },
        {
          $project: {
            followUpCount: 1,
            hasOverdueFollowUp: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$nextFollowUp', null] },
                    { $lt: ['$nextFollowUp', new Date()] },
                    { $nin: ['$status', ['won', 'lost']] }
                  ]
                },
                1,
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgFollowUps: { $avg: '$followUpCount' },
            overdueCount: { $sum: '$hasOverdueFollowUp' }
          }
        }
      ])
    ])

    // Calcul du taux de conversion
    const conversion = conversionData[0] || {}
    const conversionRate = conversion.totalLeads > 0
      ? (conversion.wonLeads / conversion.totalLeads * 100).toFixed(1)
      : 0

    // Formatage des données de performance
    const performanceData = {
      user: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        team: user.team,
        role: user.role
      },
      overview: {
        totalLeads,
        conversionRate: parseFloat(conversionRate),
        totalRevenue: conversion.totalRevenue || 0,
        avgDealValue: conversion.totalLeads > 0
          ? (conversion.totalRevenue / conversion.wonLeads).toFixed(0)
          : 0,
        avgLeadScore: Math.round(conversion.avgLeadScore || 0),
        avgResponseTime: Math.round(avgResponseTime[0]?.avgResponseTime || 0),
        avgFollowUps: Math.round(followUpStats[0]?.avgFollowUps || 0),
        overdueFollowUps: followUpStats[0]?.overdueCount || 0
      },
      statusBreakdown: leadsByStatus.reduce((acc, item) => {
        acc[item._id] = {
          count: item.count,
          value: item.totalValue
        }
        return acc
      }, {}),
      monthlyTrend: monthlyPerformance.map(month => ({
        period: `${month._id.year}-${month._id.month.toString().padStart(2, '0')}`,
        leadsCount: month.leadsCount,
        wonCount: month.wonCount,
        revenue: month.revenue,
        conversionRate: month.leadsCount > 0
          ? (month.wonCount / month.leadsCount * 100).toFixed(1)
          : 0
      })),
      recentDeals: recentDeals.map(deal => ({
        artistName: deal.artistName,
        value: deal.dealValue,
        date: deal.wonDate,
        platform: deal.platform
      }))
    }

    res.status(200).json({
      success: true,
      data: performanceData,
      period: {
        startDate: startDate || 'all',
        endDate: endDate || 'all'
      }
    })

  } catch (error) {
    logger.error('Erreur lors de la récupération des performances:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des performances'
    })
  }
}

/**
 * @desc    Métriques temps réel pour le dashboard
 * @route   GET /api/analytics/realtime
 * @access  Private
 */
export const getRealtimeMetrics = async (req, res) => {
  try {
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())

    // Filtres basés sur les permissions
    let baseFilter = { isArchived: false }
    if (req.user.role === 'agent') {
      baseFilter.assignedTo = req.user._id
    } else if (req.user.role === 'manager') {
      baseFilter.assignedTeam = req.user.team
    }

    // Métriques temps réel
    const [
      leadsToday,
      leadsThisWeek,
      overdueFollowUps,
      recentActivity,
      hotLeads,
      pipelineValue
    ] = await Promise.all([
      // Leads créés aujourd'hui
      Lead.countDocuments({
        ...baseFilter,
        createdAt: { $gte: startOfDay }
      }),

      // Leads cette semaine
      Lead.countDocuments({
        ...baseFilter,
        createdAt: {
          $gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
        }
      }),

      // Follow-ups en retard
      Lead.countDocuments({
        ...baseFilter,
        nextFollowUp: { $lt: new Date() },
        status: { $nin: ['won', 'lost'] }
      }),

      // Activité récente (dernières 24h)
      Lead.find({
        ...baseFilter,
        lastActivityDate: { $gte: startOfDay }
      })
        .sort({ lastActivityDate: -1 })
        .limit(5)
        .populate('assignedTo', 'firstName lastName')
        .select('artistName status lastActivityDate assignedTo'),

      // Leads chauds (score élevé)
      Lead.find({
        ...baseFilter,
        leadScore: { $gte: 70 },
        status: { $nin: ['won', 'lost'] }
      })
        .sort({ leadScore: -1 })
        .limit(5)
        .select('artistName leadScore status platform budget'),

      // Valeur du pipeline aujourd'hui
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: ['qualified', 'proposal_sent', 'negotiation'] },
            budget: { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalValue: { $sum: '$budget' }
          }
        }
      ])
    ])

    const realtimeData = {
      today: {
        newLeads: leadsToday,
        overdueFollowUps,
        pipelineValue: pipelineValue[0]?.totalValue || 0
      },
      thisWeek: {
        newLeads: leadsThisWeek
      },
      activity: recentActivity.map(activity => ({
        leadId: activity._id,
        artistName: activity.artistName,
        status: activity.status,
        lastActivity: activity.lastActivityDate,
        assignedTo: activity.assignedTo ?
          `${activity.assignedTo.firstName} ${activity.assignedTo.lastName}` :
          'Non assigné'
      })),
      hotLeads: hotLeads.map(lead => ({
        leadId: lead._id,
        artistName: lead.artistName,
        score: lead.leadScore,
        status: lead.status,
        platform: lead.platform,
        budget: lead.budget
      })),
      timestamp: new Date()
    }

    res.status(200).json({
      success: true,
      data: realtimeData
    })

  } catch (error) {
    logger.error('Erreur lors de la récupération des métriques temps réel:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des métriques temps réel'
    })
  }
}

/**
 * @desc    Rapport de conversion détaillé
 * @route   GET /api/analytics/conversion
 * @access  Private
 */
export const getConversionReport = async (req, res) => {
  try {
    const { startDate, endDate, platform, team } = req.query

    // Construction du filtre
    let filter = { isArchived: false }

    if (req.user.role === 'agent') {
      filter.assignedTo = req.user._id
    } else if (req.user.role === 'manager') {
      filter.assignedTeam = req.user.team
    }

    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate) filter.createdAt.$lte = new Date(endDate)
    }

    if (platform) filter.platform = platform
    if (team && req.user.role === 'admin') filter.assignedTeam = team

    // Analyse du funnel de conversion
    const conversionFunnel = await Lead.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          contacted: {
            $sum: {
              $cond: [
                { $in: ['$status', ['contacted', 'qualified', 'proposal_sent', 'negotiation', 'won']] },
                1, 0
              ]
            }
          },
          qualified: {
            $sum: {
              $cond: [
                { $in: ['$status', ['qualified', 'proposal_sent', 'negotiation', 'won']] },
                1, 0
              ]
            }
          },
          proposal: {
            $sum: {
              $cond: [
                { $in: ['$status', ['proposal_sent', 'negotiation', 'won']] },
                1, 0
              ]
            }
          },
          negotiation: {
            $sum: {
              $cond: [
                { $in: ['$status', ['negotiation', 'won']] },
                1, 0
              ]
            }
          },
          won: {
            $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] }
          },
          lost: {
            $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] }
          }
        }
      }
    ])

    const funnel = conversionFunnel[0] || {}

    // Calcul des taux de conversion pour chaque étape
    const conversionRates = {
      contactRate: funnel.total > 0 ? (funnel.contacted / funnel.total * 100).toFixed(1) : 0,
      qualificationRate: funnel.contacted > 0 ? (funnel.qualified / funnel.contacted * 100).toFixed(1) : 0,
      proposalRate: funnel.qualified > 0 ? (funnel.proposal / funnel.qualified * 100).toFixed(1) : 0,
      negotiationRate: funnel.proposal > 0 ? (funnel.negotiation / funnel.proposal * 100).toFixed(1) : 0,
      closingRate: funnel.negotiation > 0 ? (funnel.won / funnel.negotiation * 100).toFixed(1) : 0,
      overallConversion: funnel.total > 0 ? (funnel.won / funnel.total * 100).toFixed(1) : 0
    }

    res.status(200).json({
      success: true,
      data: {
        funnel: {
          total: funnel.total || 0,
          contacted: funnel.contacted || 0,
          qualified: funnel.qualified || 0,
          proposal: funnel.proposal || 0,
          negotiation: funnel.negotiation || 0,
          won: funnel.won || 0,
          lost: funnel.lost || 0
        },
        conversionRates,
        period: { startDate, endDate },
        filters: { platform, team }
      }
    })

  } catch (error) {
    logger.error('Erreur lors de la génération du rapport de conversion:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du rapport de conversion'
    })
  }
}

export default {
  getDashboardMetrics,
  getUserPerformance,
  getRealtimeMetrics,
  getConversionReport
}