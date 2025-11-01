import Lead from '../models/Lead.js'
import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import { logger } from '../utils/logger.js'
import { encrypt, decrypt } from '../utils/encryption.js'
import { validationResult } from 'express-validator'
import mongoose from 'mongoose'

/**
 * Contrôleur des leads avec fonctionnalités CRUD complètes
 * Gestion des permissions, chiffrement, audit trail RGPD
 */

/**
 * @desc    Récupérer tous les leads avec filtres et pagination
 * @route   GET /api/leads
 * @access  Private
 */
export const getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      platform,
      assignedTo,
      assignedTeam,
      source,
      priority,
      quality,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      startDate,
      endDate,
      minBudget,
      maxBudget,
      tags,
      isArchived = false
    } = req.query

    // Construction du filtre
    const filter = { isArchived: isArchived === 'true' }

    // Filtres spécifiques selon le rôle et l'équipe
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent') {
        // Agent ne voit que ses leads
        filter.assignedTo = req.user._id
      } else if (req.user.role === 'manager') {
        // Manager voit les leads de son équipe
        filter.assignedTeam = req.user.team
      }
    }

    // Application des filtres optionnels
    if (status) filter.status = status
    if (platform) filter.platform = platform
    if (assignedTo && req.user.role === 'admin') filter.assignedTo = assignedTo
    if (assignedTeam && req.user.role === 'admin') filter.assignedTeam = assignedTeam
    if (source) filter.source = source
    if (priority) filter.priority = priority
    if (quality) filter.quality = quality

    // Filtres de date
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate) filter.createdAt.$lte = new Date(endDate)
    }

    // Filtres de budget
    if (minBudget || maxBudget) {
      filter.budget = {}
      if (minBudget) filter.budget.$gte = Number(minBudget)
      if (maxBudget) filter.budget.$lte = Number(maxBudget)
    }

    // Filtre par tags
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim())
      filter.tags = { $in: tagArray }
    }

    // Recherche textuelle
    if (search) {
      filter.$or = [
        { artistName: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { genre: { $regex: search, $options: 'i' } },
        { label: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    }

    // Configuration de la pagination
    const skip = (Number(page) - 1) * Number(limit)
    const sortOptions = { [sortBy]: sortOrder === 'asc' ? 1 : -1 }

    // Exécution de la requête
    const [leads, totalCount] = await Promise.all([
      Lead.find(filter)
        .populate('assignedTo', 'firstName lastName email team')
        .populate('notes.author', 'firstName lastName')
        .populate('followUps.scheduledBy', 'firstName lastName')
        .sort(sortOptions)
        .skip(skip)
        .limit(Number(limit)),
      Lead.countDocuments(filter)
    ])

    // Déchiffrement des données sensibles pour l'affichage
    const decryptedLeads = leads.map(lead => {
      const leadObj = lead.toObject()
      if (leadObj.email) leadObj.email = decrypt(leadObj.email)
      if (leadObj.phone) leadObj.phone = decrypt(leadObj.phone)
      return leadObj
    })

    // Calcul des métadonnées de pagination
    const totalPages = Math.ceil(totalCount / Number(limit))
    const hasNext = Number(page) < totalPages
    const hasPrev = Number(page) > 1

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'list_leads',
      resourceType: 'lead',
      description: `Consultation de la liste des leads (page ${page}, ${leads.length} résultats)`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: {
        filters: filter,
        resultsCount: leads.length,
        totalCount,
        page: Number(page)
      }
    })

    res.status(200).json({
      success: true,
      data: decryptedLeads,
      pagination: {
        currentPage: Number(page),
        totalPages,
        totalCount,
        limit: Number(limit),
        hasNext,
        hasPrev
      },
      filters: {
        status,
        platform,
        assignedTo,
        assignedTeam,
        source,
        priority,
        quality,
        search
      }
    })

  } catch (error) {
    logger.error('Erreur lors de la récupération des leads:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'list_leads',
      resourceType: 'lead',
      description: 'Échec de la consultation des leads',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des leads'
    })
  }
}

/**
 * @desc    Récupérer un lead par ID
 * @route   GET /api/leads/:id
 * @access  Private
 */
export const getLead = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de lead invalide'
      })
    }

    const lead = await Lead.findById(id)
      .populate('assignedTo', 'firstName lastName email team')
      .populate('notes.author', 'firstName lastName email')
      .populate('followUps.scheduledBy', 'firstName lastName')
      .populate('followUps.completedBy', 'firstName lastName')

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    // Vérification des permissions d'accès
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent' && !lead.assignedTo.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé. Lead non assigné.'
        })
      }
      if (req.user.role === 'manager' && lead.assignedTeam !== req.user.team) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé. Lead d\'une autre équipe.'
        })
      }
    }

    // Déchiffrement des données sensibles
    const leadObj = lead.toObject()
    if (leadObj.email) leadObj.email = decrypt(leadObj.email)
    if (leadObj.phone) leadObj.phone = decrypt(leadObj.phone)

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'view_lead',
      resourceType: 'lead',
      resourceId: lead._id,
      description: `Consultation du lead ${lead.artistName}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true
    })

    res.status(200).json({
      success: true,
      data: leadObj
    })

  } catch (error) {
    logger.error('Erreur lors de la récupération du lead:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'view_lead',
      resourceType: 'lead',
      resourceId: req.params.id,
      description: 'Échec de la consultation du lead',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du lead'
    })
  }
}

/**
 * @desc    Créer un nouveau lead avec auto-assignment
 * @route   POST /api/leads
 * @access  Private
 */
export const createLead = async (req, res) => {
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

    const leadData = req.body

    // Auto-assignment basé sur la plateforme
    const assignmentResult = await autoAssignLead(leadData.platform)
    leadData.assignedTo = assignmentResult.userId
    leadData.assignedTeam = assignmentResult.team

    // Chiffrement des données sensibles
    if (leadData.email) leadData.email = encrypt(leadData.email)
    if (leadData.phone) leadData.phone = encrypt(leadData.phone)

    // Création du lead
    const lead = await Lead.create(leadData)

    // Mise à jour des statistiques de l'utilisateur assigné
    await User.findByIdAndUpdate(assignmentResult.userId, {
      $inc: { 'stats.leadsCreated': 1 }
    })

    // Population des champs pour la réponse
    await lead.populate('assignedTo', 'firstName lastName email team')

    // Déchiffrement pour la réponse
    const leadObj = lead.toObject()
    if (leadObj.email) leadObj.email = decrypt(leadObj.email)
    if (leadObj.phone) leadObj.phone = decrypt(leadObj.phone)

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'create_lead',
      resourceType: 'lead',
      resourceId: lead._id,
      description: `Création du lead ${lead.artistName} (${lead.platform})`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: {
        platform: lead.platform,
        assignedTo: assignmentResult.userId,
        assignedTeam: assignmentResult.team,
        source: lead.source
      }
    })

    res.status(201).json({
      success: true,
      message: 'Lead créé avec succès',
      data: leadObj
    })

  } catch (error) {
    logger.error('Erreur lors de la création du lead:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'create_lead',
      resourceType: 'lead',
      description: 'Échec de la création du lead',
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
      message: 'Erreur lors de la création du lead'
    })
  }
}

/**
 * @desc    Mettre à jour un lead
 * @route   PUT /api/leads/:id
 * @access  Private
 */
export const updateLead = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de lead invalide'
      })
    }

    // Validation des erreurs
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array()
      })
    }

    const lead = await Lead.findById(id)
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    // Vérification des permissions de modification
    if (req.user.role !== 'admin') {
      if (req.user.role === 'agent' && !lead.assignedTo.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé. Lead non assigné.'
        })
      }
      if (req.user.role === 'manager' && lead.assignedTeam !== req.user.team) {
        return res.status(403).json({
          success: false,
          message: 'Accès refusé. Lead d\'une autre équipe.'
        })
      }
    }

    // Sauvegarde des anciennes valeurs pour l'audit
    const oldValues = {
      status: lead.status,
      priority: lead.priority,
      quality: lead.quality,
      budget: lead.budget,
      assignedTo: lead.assignedTo,
      assignedTeam: lead.assignedTeam
    }

    const updateData = req.body

    // Chiffrement des nouvelles données sensibles
    if (updateData.email) updateData.email = encrypt(updateData.email)
    if (updateData.phone) updateData.phone = encrypt(updateData.phone)

    // Mise à jour du lead
    const updatedLead = await Lead.findByIdAndUpdate(
      id,
      { ...updateData, lastActivityDate: new Date() },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'firstName lastName email team')

    // Déchiffrement pour la réponse
    const leadObj = updatedLead.toObject()
    if (leadObj.email) leadObj.email = decrypt(leadObj.email)
    if (leadObj.phone) leadObj.phone = decrypt(leadObj.phone)

    // Détection des changements significatifs
    const changes = []
    if (oldValues.status !== updatedLead.status) {
      changes.push(`Statut: ${oldValues.status} → ${updatedLead.status}`)
    }
    if (oldValues.priority !== updatedLead.priority) {
      changes.push(`Priorité: ${oldValues.priority} → ${updatedLead.priority}`)
    }
    if (oldValues.budget !== updatedLead.budget) {
      changes.push(`Budget: ${oldValues.budget} → ${updatedLead.budget}`)
    }

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'update_lead',
      resourceType: 'lead',
      resourceId: lead._id,
      description: `Modification du lead ${lead.artistName}` +
                  (changes.length > 0 ? `: ${changes.join(', ')}` : ''),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      metadata: {
        oldValues,
        newValues: updateData,
        changes
      }
    })

    res.status(200).json({
      success: true,
      message: 'Lead mis à jour avec succès',
      data: leadObj
    })

  } catch (error) {
    logger.error('Erreur lors de la mise à jour du lead:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'update_lead',
      resourceType: 'lead',
      resourceId: req.params.id,
      description: 'Échec de la modification du lead',
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
      message: 'Erreur lors de la mise à jour du lead'
    })
  }
}

/**
 * @desc    Supprimer un lead (soft delete)
 * @route   DELETE /api/leads/:id
 * @access  Private (Admin/Manager seulement)
 */
export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de lead invalide'
      })
    }

    const lead = await Lead.findById(id)
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead non trouvé'
      })
    }

    // Vérification des permissions (Admin/Manager seulement)
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Permission insuffisante pour supprimer un lead'
      })
    }

    if (req.user.role === 'manager' && lead.assignedTeam !== req.user.team) {
      return res.status(403).json({
        success: false,
        message: 'Impossible de supprimer un lead d\'une autre équipe'
      })
    }

    // Soft delete (archivage)
    lead.isArchived = true
    lead.archivedAt = new Date()
    lead.archivedBy = req.user._id
    await lead.save()

    // Log de l'action pour audit
    await AuditLog.logAction({
      userId: req.user._id,
      userEmail: req.user.email,
      userName: req.user.fullName,
      action: 'delete_lead',
      resourceType: 'lead',
      resourceId: lead._id,
      description: `Suppression (archivage) du lead ${lead.artistName}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: true,
      severity: 'high',
      metadata: {
        leadArtistName: lead.artistName,
        leadPlatform: lead.platform,
        leadStatus: lead.status
      }
    })

    res.status(200).json({
      success: true,
      message: 'Lead supprimé avec succès'
    })

  } catch (error) {
    logger.error('Erreur lors de la suppression du lead:', error)

    await AuditLog.logAction({
      userId: req.user?._id,
      userEmail: req.user?.email,
      userName: req.user?.fullName,
      action: 'delete_lead',
      resourceType: 'lead',
      resourceId: req.params.id,
      description: 'Échec de la suppression du lead',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      requestUrl: req.originalUrl,
      requestMethod: req.method,
      success: false,
      errorMessage: error.message
    })

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du lead'
    })
  }
}

/**
 * Fonction d'auto-assignment des leads basée sur la plateforme
 */
const autoAssignLead = async (platform) => {
  try {
    let targetTeam, targetPlatforms

    // Logique d'assignment selon les spécifications
    if (['youtube', 'spotify'].includes(platform)) {
      targetTeam = 'denis'
      targetPlatforms = ['youtube', 'spotify']
    } else if (['meta', 'tiktok'].includes(platform)) {
      targetTeam = 'marine'
      targetPlatforms = ['meta', 'tiktok']
    } else {
      // Par défaut, chercher l'utilisateur avec le moins de charge
      const users = await User.find({ isActive: true })
      const userLoads = await Promise.all(
        users.map(async (user) => {
          const activeLeads = await Lead.countDocuments({
            assignedTo: user._id,
            status: { $nin: ['won', 'lost'] },
            isArchived: false
          })
          return { userId: user._id, team: user.team, load: activeLeads }
        })
      )

      const leastLoaded = userLoads.reduce((min, current) =>
        current.load < min.load ? current : min
      )

      return {
        userId: leastLoaded.userId,
        team: leastLoaded.team
      }
    }

    // Trouver l'utilisateur de l'équipe avec le moins de charge
    const teamUsers = await User.find({
      team: targetTeam,
      isActive: true,
      assignedPlatforms: { $in: targetPlatforms }
    })

    if (teamUsers.length === 0) {
      throw new Error(`Aucun utilisateur actif trouvé pour l'équipe ${targetTeam}`)
    }

    // Calculer la charge de travail de chaque utilisateur
    const userLoads = await Promise.all(
      teamUsers.map(async (user) => {
        const activeLeads = await Lead.countDocuments({
          assignedTo: user._id,
          status: { $nin: ['won', 'lost'] },
          isArchived: false
        })
        return { userId: user._id, load: activeLeads }
      })
    )

    // Assigner à l'utilisateur avec le moins de charge
    const assignedUser = userLoads.reduce((min, current) =>
      current.load < min.load ? current : min
    )

    return {
      userId: assignedUser.userId,
      team: targetTeam
    }

  } catch (error) {
    logger.error('Erreur lors de l\'auto-assignment:', error)

    // Fallback: assigner à Denis par défaut
    const defaultUser = await User.findOne({ team: 'denis', isActive: true })
    if (!defaultUser) {
      throw new Error('Aucun utilisateur par défaut trouvé')
    }

    return {
      userId: defaultUser._id,
      team: 'denis'
    }
  }
}

export default {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead
}