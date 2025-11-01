import express from 'express'
import { body, validationResult } from 'express-validator'
import axios from 'axios'
import { authenticate, authorize, authorizePermission } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { auditLogger, auditSensitiveAction } from '../middleware/audit.js'
import { sanitizeInput, sensitiveActionLimiter } from '../middleware/security.js'
import { logger } from '../utils/logger.js'
import Lead from '../models/Lead.js'
import Campaign from '../models/Campaign.js'

const router = express.Router()

// @desc    Test Brevo integration
// @route   POST /api/integrations/brevo/test
// @access  Private (Admin/Manager)
router.post('/brevo/test',
  authenticate,
  authorize('admin', 'manager'),
  sanitizeInput,
  [
    body('apiKey')
      .notEmpty()
      .withMessage('Clé API Brevo requise')
  ],
  auditSensitiveAction('brevo_integration_tested', 'Test de l\'intégration Brevo'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { apiKey } = req.body

    try {
      // Tester la connexion à Brevo
      const response = await axios.get('https://api.brevo.com/v3/account', {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      })

      res.json({
        success: true,
        message: 'Connexion Brevo réussie',
        data: {
          companyName: response.data.companyName,
          email: response.data.email,
          plan: response.data.plan
        }
      })

    } catch (error) {
      logger.error('Erreur test Brevo:', error.response?.data || error.message)

      res.status(400).json({
        success: false,
        message: 'Échec de la connexion Brevo',
        error: error.response?.data?.message || error.message
      })
    }
  })
)

// @desc    Send email via Brevo
// @route   POST /api/integrations/brevo/send-email
// @access  Private
router.post('/brevo/send-email',
  authenticate,
  authorizePermission('campaigns', 'update'),
  sanitizeInput,
  [
    body('to')
      .isEmail()
      .withMessage('Email destinataire invalide'),
    body('subject')
      .notEmpty()
      .withMessage('Sujet requis')
      .isLength({ max: 200 })
      .withMessage('Sujet trop long'),
    body('content')
      .notEmpty()
      .withMessage('Contenu requis'),
    body('templateId')
      .optional()
      .isNumeric()
      .withMessage('ID template invalide'),
    body('leadId')
      .optional()
      .isMongoId()
      .withMessage('ID lead invalide')
  ],
  auditLogger('email_sent_brevo', 'system'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { to, subject, content, templateId, leadId, params } = req.body

    try {
      // Récupérer la clé API Brevo (stockée dans les variables d'environnement ou user)
      const apiKey = process.env.BREVO_API_KEY || req.user.apiKeys?.brevo

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'Clé API Brevo non configurée'
        })
      }

      // Préparer les données d'email
      const emailData = {
        sender: {
          name: 'MDMC Music Ads',
          email: process.env.FROM_EMAIL || 'noreply@mdmc-music-ads.com'
        },
        to: [{ email: to }],
        subject,
        replyTo: {
          email: req.user.email,
          name: req.user.fullName
        }
      }

      // Utiliser un template ou contenu HTML
      if (templateId) {
        emailData.templateId = templateId
        emailData.params = params || {}
      } else {
        emailData.htmlContent = content
      }

      // Envoyer l'email
      const response = await axios.post('https://api.brevo.com/v3/smtp/email', emailData, {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      })

      // Ajouter une note au lead si spécifié
      if (leadId) {
        const lead = await Lead.findById(leadId)
        if (lead) {
          await lead.addNote(
            req.user._id,
            `Email envoyé: "${subject}"`,
            'email'
          )
        }
      }

      res.json({
        success: true,
        message: 'Email envoyé avec succès',
        data: {
          messageId: response.data.messageId
        }
      })

    } catch (error) {
      logger.error('Erreur envoi email Brevo:', error.response?.data || error.message)

      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'envoi de l\'email',
        error: error.response?.data?.message || error.message
      })
    }
  })
)

// @desc    Sync Google Ads data
// @route   POST /api/integrations/google-ads/sync
// @access  Private (Manager/Admin)
router.post('/google-ads/sync',
  authenticate,
  authorize('admin', 'manager'),
  sanitizeInput,
  [
    body('campaignId')
      .isMongoId()
      .withMessage('ID campagne invalide'),
    body('googleCampaignId')
      .notEmpty()
      .withMessage('ID campagne Google Ads requis')
  ],
  auditLogger('google_ads_sync', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { campaignId, googleCampaignId } = req.body

    try {
      // Vérifier que la campagne existe
      const campaign = await Campaign.findById(campaignId)

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campagne non trouvée'
        })
      }

      // Vérifier les permissions
      if (req.user.role !== 'admin') {
        if (req.user.role === 'manager' && campaign.managedTeam !== req.user.team) {
          return res.status(403).json({
            success: false,
            message: 'Accès refusé'
          })
        }
      }

      // Simuler la récupération des données Google Ads
      // En production, utiliser l'API Google Ads
      const mockGoogleAdsData = {
        impressions: Math.floor(Math.random() * 100000) + 10000,
        clicks: Math.floor(Math.random() * 5000) + 100,
        spend: Math.floor(Math.random() * 1000) + 50,
        conversions: Math.floor(Math.random() * 100) + 5,
        views: Math.floor(Math.random() * 50000) + 5000
      }

      // Calculer les métriques dérivées
      const ctr = ((mockGoogleAdsData.clicks / mockGoogleAdsData.impressions) * 100).toFixed(2)
      const cpc = (mockGoogleAdsData.spend / mockGoogleAdsData.clicks).toFixed(2)
      const cpv = (mockGoogleAdsData.spend / mockGoogleAdsData.views).toFixed(4)

      const kpiData = {
        ...mockGoogleAdsData,
        ctr: parseFloat(ctr),
        cpc: parseFloat(cpc),
        cpv: parseFloat(cpv),
        date: new Date()
      }

      // Mettre à jour la campagne
      await campaign.updateKpis(kpiData)

      // Mettre à jour l'ID Google Ads si pas déjà défini
      if (!campaign.platformCampaignId) {
        campaign.platformCampaignId = googleCampaignId
        await campaign.save()
      }

      res.json({
        success: true,
        message: 'Synchronisation Google Ads réussie',
        data: kpiData
      })

    } catch (error) {
      logger.error('Erreur sync Google Ads:', error)

      res.status(500).json({
        success: false,
        message: 'Erreur lors de la synchronisation Google Ads',
        error: error.message
      })
    }
  })
)

// @desc    Sync Meta Ads data
// @route   POST /api/integrations/meta-ads/sync
// @access  Private (Manager/Admin)
router.post('/meta-ads/sync',
  authenticate,
  authorize('admin', 'manager'),
  sanitizeInput,
  [
    body('campaignId')
      .isMongoId()
      .withMessage('ID campagne invalide'),
    body('metaCampaignId')
      .notEmpty()
      .withMessage('ID campagne Meta Ads requis')
  ],
  auditLogger('meta_ads_sync', 'campaign'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      })
    }

    const { campaignId, metaCampaignId } = req.body

    try {
      const campaign = await Campaign.findById(campaignId)

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campagne non trouvée'
        })
      }

      // Vérifier les permissions
      if (req.user.role !== 'admin') {
        if (req.user.role === 'manager' && campaign.managedTeam !== req.user.team) {
          return res.status(403).json({
            success: false,
            message: 'Accès refusé'
          })
        }
      }

      // Simuler la récupération des données Meta Ads
      const mockMetaAdsData = {
        impressions: Math.floor(Math.random() * 80000) + 8000,
        reach: Math.floor(Math.random() * 60000) + 6000,
        clicks: Math.floor(Math.random() * 3000) + 80,
        spend: Math.floor(Math.random() * 800) + 40,
        likes: Math.floor(Math.random() * 500) + 20,
        shares: Math.floor(Math.random() * 100) + 5,
        comments: Math.floor(Math.random() * 200) + 10,
        videoViews: Math.floor(Math.random() * 20000) + 2000
      }

      // Métriques spécifiques Meta
      const ctr = ((mockMetaAdsData.clicks / mockMetaAdsData.impressions) * 100).toFixed(2)
      const cpm = (mockMetaAdsData.spend / mockMetaAdsData.impressions * 1000).toFixed(2)
      const engagement = mockMetaAdsData.likes + mockMetaAdsData.shares + mockMetaAdsData.comments

      const kpiData = {
        ...mockMetaAdsData,
        views: mockMetaAdsData.videoViews,
        ctr: parseFloat(ctr),
        cpm: parseFloat(cpm),
        platformSpecific: {
          meta: {
            videoViews: mockMetaAdsData.videoViews,
            postEngagement: engagement,
            linkClicks: mockMetaAdsData.clicks
          }
        },
        date: new Date()
      }

      await campaign.updateKpis(kpiData)

      if (!campaign.platformCampaignId) {
        campaign.platformCampaignId = metaCampaignId
        await campaign.save()
      }

      res.json({
        success: true,
        message: 'Synchronisation Meta Ads réussie',
        data: kpiData
      })

    } catch (error) {
      logger.error('Erreur sync Meta Ads:', error)

      res.status(500).json({
        success: false,
        message: 'Erreur lors de la synchronisation Meta Ads',
        error: error.message
      })
    }
  })
)

// @desc    Webhook for external integrations
// @route   POST /api/integrations/webhook/:source
// @access  Public (with signature verification)
router.post('/webhook/:source',
  [
    body().custom((value, { req }) => {
      // Vérification basique de la signature (à adapter selon la source)
      const signature = req.headers['x-signature'] || req.headers['x-hub-signature-256']

      if (!signature) {
        throw new Error('Signature manquante')
      }

      // TODO: Vérifier la signature selon la source (GitHub, n8n, etc.)
      return true
    })
  ],
  asyncHandler(async (req, res) => {
    const source = req.params.source
    const payload = req.body

    try {
      switch (source) {
        case 'n8n':
          await handleN8nWebhook(payload)
          break
        case 'simulator':
          await handleSimulatorWebhook(payload)
          break
        case 'calendly':
          await handleCalendlyWebhook(payload)
          break
        default:
          return res.status(400).json({
            success: false,
            message: 'Source webhook inconnue'
          })
      }

      res.json({
        success: true,
        message: 'Webhook traité avec succès'
      })

    } catch (error) {
      logger.error(`Erreur webhook ${source}:`, error)

      res.status(500).json({
        success: false,
        message: 'Erreur lors du traitement du webhook',
        error: error.message
      })
    }
  })
)

// Fonctions de traitement des webhooks
async function handleN8nWebhook(payload) {
  // Traiter les données du workflow n8n
  if (payload.type === 'lead_created') {
    const leadData = payload.data

    // Auto-assignment logic
    const autoAssignLead = async (platform) => {
      let assignedTeam, assignedUser

      if (['youtube', 'spotify'].includes(platform)) {
        assignedTeam = 'denis'
      } else if (['meta', 'tiktok'].includes(platform)) {
        assignedTeam = 'marine'
      }

      // Trouver un utilisateur de l'équipe
      const User = (await import('../models/User.js')).default
      const teamUsers = await User.find({
        team: assignedTeam,
        isActive: true
      }).sort({ 'stats.leadsCreated': 1 })

      return {
        assignedTeam,
        assignedUser: teamUsers[0]?._id
      }
    }

    const { assignedTeam, assignedUser } = await autoAssignLead(leadData.platform)

    if (assignedUser) {
      await Lead.create({
        ...leadData,
        assignedTo: assignedUser,
        assignedTeam,
        source: 'manual' // ou autre selon le context
      })

      logger.info('Lead créé via webhook n8n:', leadData.email)
    }
  }
}

async function handleSimulatorWebhook(payload) {
  // Traiter les leads du simulateur MDMC
  const { assignedTeam, assignedUser } = await autoAssignLead(payload.platform)

  if (assignedUser) {
    const lead = await Lead.create({
      artistName: payload.artistName,
      email: payload.email,
      phone: payload.phone,
      platform: payload.platform,
      budget: payload.budget,
      campaignType: payload.campaignType,
      source: 'simulator',
      assignedTo: assignedUser,
      assignedTeam,
      sourceDetails: {
        url: payload.sourceUrl,
        utmSource: 'simulator',
        utmMedium: 'web'
      }
    })

    logger.info('Lead créé via simulateur:', lead.email)
  }
}

async function handleCalendlyWebhook(payload) {
  // Traiter les événements Calendly
  if (payload.event === 'invitee.created') {
    const invitee = payload.payload.invitee

    // Chercher un lead existant avec cet email
    const existingLead = await Lead.findOne({
      email: invitee.email,
      isArchived: false
    })

    if (existingLead) {
      // Mettre à jour le statut et ajouter une note
      existingLead.status = 'contacted'
      existingLead.lastContactDate = new Date()

      await existingLead.addNote(
        existingLead.assignedTo,
        `Rendez-vous Calendly programmé: ${payload.payload.event.name}`,
        'meeting'
      )

      logger.info('Lead mis à jour via Calendly:', invitee.email)
    }
  }
}

// Auto-assignment helper function
async function autoAssignLead(platform) {
  let assignedTeam, assignedUser

  if (['youtube', 'spotify'].includes(platform)) {
    assignedTeam = 'denis'
  } else if (['meta', 'tiktok'].includes(platform)) {
    assignedTeam = 'marine'
  } else {
    // Pour google ou multiple, équilibrer la charge
    const Lead = (await import('../models/Lead.js')).default
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

  const User = (await import('../models/User.js')).default
  const teamUsers = await User.find({
    team: assignedTeam,
    isActive: true
  }).sort({ 'stats.leadsCreated': 1 })

  return {
    assignedTeam,
    assignedUser: teamUsers[0]?._id
  }
}

// @desc    Get available Brevo templates
// @route   GET /api/integrations/brevo/templates
// @access  Private
router.get('/brevo/templates',
  authenticate,
  authorizePermission('campaigns', 'read'),
  auditLogger('brevo_templates_accessed', 'system'),
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.BREVO_API_KEY || req.user.apiKeys?.brevo

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'Clé API Brevo non configurée'
        })
      }

      const response = await axios.get('https://api.brevo.com/v3/smtp/templates', {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      })

      res.json({
        success: true,
        data: response.data.templates || []
      })

    } catch (error) {
      logger.error('Erreur récupération templates Brevo:', error.response?.data || error.message)

      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des templates',
        error: error.response?.data?.message || error.message
      })
    }
  })
)

export default router