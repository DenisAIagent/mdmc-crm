import express from 'express'
import { validationResult, body } from 'express-validator'

const router = express.Router()

// Simuler une base de données d'opportunités
let opportunities = []
let nextId = 1

// Middleware de validation pour les soumissions de formulaire
const validateFormSubmission = [
  body('firstName').notEmpty().withMessage('Le prénom est requis'),
  body('lastName').notEmpty().withMessage('Le nom est requis'),
  body('email').isEmail().withMessage('Email invalide'),
  body('artistName').notEmpty().withMessage('Le nom d\'artiste est requis'),
  body('phone').optional(),
  body('company').optional(),
  body('genre').optional(),
  body('platform').optional(),
  body('budget').optional().isNumeric().withMessage('Le budget doit être un nombre'),
  body('message').optional(),
  body('source').optional().default('website'),
  body('formType').optional().default('contact')
]

/**
 * POST /api/webhooks/form-submission
 * Endpoint pour recevoir les soumissions de formulaires du site web
 */
router.post('/form-submission', validateFormSubmission, async (req, res) => {
  try {
    // Vérifier les erreurs de validation
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données de formulaire invalides',
        errors: errors.array()
      })
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      company,
      artistName,
      genre,
      platform,
      budget,
      message,
      source = 'website',
      formType = 'contact'
    } = req.body

    // Créer une nouvelle opportunité
    const opportunity = {
      id: nextId++,

      // Informations personnelles
      firstName,
      lastName,
      email,
      phone: phone || '',
      company: company || '',

      // Informations projet
      artistName,
      genre: genre || '',
      platform: platform || '',
      budget: budget ? parseInt(budget) : 0,

      // Détails de l'opportunité
      projectName: '', // À remplir par l'équipe
      campaignDetails: message || '', // Message initial comme base

      // Métadonnées
      status: 'new',
      source,
      formType,
      priority: calculatePriority(budget, platform),

      // Dates
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      followUpDate: calculateFollowUpDate(),

      // Assignation
      assignedTo: null, // Sera assigné manuellement

      // Tracking
      tags: generateTags(genre, platform, budget),
      notes: []
    }

    // Sauvegarder l'opportunité
    opportunities.push(opportunity)

    // Log pour debug
    console.log('📝 Nouvelle opportunité créée:', {
      id: opportunity.id,
      artistName: opportunity.artistName,
      email: opportunity.email,
      source: opportunity.source,
      priority: opportunity.priority
    })

    // Notification en temps réel (si socket.io est configuré)
    if (req.io) {
      req.io.emit('new_opportunity', {
        id: opportunity.id,
        artistName: opportunity.artistName,
        email: opportunity.email,
        priority: opportunity.priority,
        source: opportunity.source
      })
    }

    // Réponse de succès
    res.status(201).json({
      success: true,
      message: 'Opportunité créée avec succès',
      data: {
        opportunityId: opportunity.id,
        status: opportunity.status,
        priority: opportunity.priority,
        followUpDate: opportunity.followUpDate
      }
    })

  } catch (error) {
    console.error('❌ Erreur lors de la création de l\'opportunité:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création de l\'opportunité',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * GET /api/webhooks/opportunities
 * Récupérer toutes les opportunités
 */
router.get('/opportunities', (req, res) => {
  try {
    const { status, source, priority, search } = req.query

    let filteredOpportunities = [...opportunities]

    // Filtres
    if (status) {
      filteredOpportunities = filteredOpportunities.filter(opp => opp.status === status)
    }

    if (source) {
      filteredOpportunities = filteredOpportunities.filter(opp => opp.source === source)
    }

    if (priority) {
      filteredOpportunities = filteredOpportunities.filter(opp => opp.priority === priority)
    }

    if (search) {
      const searchLower = search.toLowerCase()
      filteredOpportunities = filteredOpportunities.filter(opp =>
        opp.artistName.toLowerCase().includes(searchLower) ||
        opp.email.toLowerCase().includes(searchLower) ||
        opp.firstName.toLowerCase().includes(searchLower) ||
        opp.lastName.toLowerCase().includes(searchLower)
      )
    }

    // Tri par date de création (plus récent en premier)
    filteredOpportunities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json({
      success: true,
      data: filteredOpportunities,
      total: filteredOpportunities.length,
      filters: { status, source, priority, search }
    })

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des opportunités:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des opportunités'
    })
  }
})

/**
 * PUT /api/webhooks/opportunities/:id
 * Mettre à jour une opportunité (nom du projet, détails campagne)
 */
router.put('/opportunities/:id', async (req, res) => {
  try {
    const { id } = req.params
    const {
      projectName,
      campaignDetails,
      status,
      assignedTo,
      priority,
      notes
    } = req.body

    const opportunityIndex = opportunities.findIndex(opp => opp.id === parseInt(id))

    if (opportunityIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Opportunité non trouvée'
      })
    }

    // Mettre à jour l'opportunité
    const opportunity = opportunities[opportunityIndex]

    if (projectName !== undefined) opportunity.projectName = projectName
    if (campaignDetails !== undefined) opportunity.campaignDetails = campaignDetails
    if (status !== undefined) opportunity.status = status
    if (assignedTo !== undefined) opportunity.assignedTo = assignedTo
    if (priority !== undefined) opportunity.priority = priority
    if (notes !== undefined) opportunity.notes.push({
      id: Date.now(),
      content: notes,
      createdAt: new Date().toISOString(),
      author: assignedTo || 'System'
    })

    opportunity.lastActivity = new Date().toISOString()

    // Log de l'update
    console.log('📝 Opportunité mise à jour:', {
      id: opportunity.id,
      projectName: opportunity.projectName,
      status: opportunity.status
    })

    res.json({
      success: true,
      message: 'Opportunité mise à jour avec succès',
      data: opportunity
    })

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'opportunité'
    })
  }
})

/**
 * DELETE /api/webhooks/opportunities/:id
 * Supprimer une opportunité
 */
router.delete('/opportunities/:id', (req, res) => {
  try {
    const { id } = req.params
    const initialLength = opportunities.length

    opportunities = opportunities.filter(opp => opp.id !== parseInt(id))

    if (opportunities.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Opportunité non trouvée'
      })
    }

    res.json({
      success: true,
      message: 'Opportunité supprimée avec succès'
    })

  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'opportunité'
    })
  }
})

// Fonctions utilitaires

/**
 * Calculer la priorité basée sur le budget et la plateforme
 */
function calculatePriority(budget, platform) {
  let priority = 'medium'

  if (budget) {
    if (budget >= 10000) priority = 'high'
    else if (budget >= 5000) priority = 'medium'
    else priority = 'low'
  }

  // Boost pour certaines plateformes
  const highValuePlatforms = ['spotify', 'youtube', 'multiple']
  if (highValuePlatforms.includes(platform)) {
    if (priority === 'low') priority = 'medium'
    else if (priority === 'medium') priority = 'high'
  }

  return priority
}

/**
 * Calculer la date de suivi recommandée
 */
function calculateFollowUpDate() {
  const now = new Date()
  now.setDate(now.getDate() + 2) // Suivi dans 2 jours
  return now.toISOString()
}

/**
 * Générer des tags automatiques
 */
function generateTags(genre, platform, budget) {
  const tags = []

  if (genre) tags.push(`genre:${genre.toLowerCase()}`)
  if (platform) tags.push(`platform:${platform}`)

  if (budget) {
    if (budget >= 10000) tags.push('budget:high')
    else if (budget >= 5000) tags.push('budget:medium')
    else tags.push('budget:low')
  }

  tags.push('source:website')

  return tags
}

/**
 * GET /api/webhooks/stats
 * Statistiques des opportunités
 */
router.get('/stats', (req, res) => {
  try {
    const stats = {
      total: opportunities.length,
      byStatus: {
        new: opportunities.filter(o => o.status === 'new').length,
        contacted: opportunities.filter(o => o.status === 'contacted').length,
        qualified: opportunities.filter(o => o.status === 'qualified').length,
        proposal: opportunities.filter(o => o.status === 'proposal').length,
        won: opportunities.filter(o => o.status === 'won').length,
        lost: opportunities.filter(o => o.status === 'lost').length
      },
      byPriority: {
        high: opportunities.filter(o => o.priority === 'high').length,
        medium: opportunities.filter(o => o.priority === 'medium').length,
        low: opportunities.filter(o => o.priority === 'low').length
      },
      bySource: {
        website: opportunities.filter(o => o.source === 'website').length,
        referral: opportunities.filter(o => o.source === 'referral').length,
        social: opportunities.filter(o => o.source === 'social').length
      },
      totalBudget: opportunities.reduce((sum, o) => sum + (o.budget || 0), 0),
      avgBudget: opportunities.length > 0 ?
        Math.round(opportunities.reduce((sum, o) => sum + (o.budget || 0), 0) / opportunities.length) : 0
    }

    res.json({
      success: true,
      data: stats
    })

  } catch (error) {
    console.error('❌ Erreur lors du calcul des stats:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques'
    })
  }
})

export default router