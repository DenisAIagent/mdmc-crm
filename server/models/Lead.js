import mongoose from 'mongoose'
import CryptoJS from 'crypto-js'

const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production'

// Fonction pour chiffrer les données sensibles
const encrypt = (text) => {
  if (!text) return text
  return CryptoJS.AES.encrypt(text, encryptionKey).toString()
}

// Fonction pour déchiffrer les données sensibles
const decrypt = (encryptedText) => {
  if (!encryptedText) return encryptedText
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, encryptionKey)
    return bytes.toString(CryptoJS.enc.Utf8)
  } catch (error) {
    return encryptedText // Retourner la valeur originale si déchiffrement échoue
  }
}

const noteSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: [true, 'Le contenu de la note est requis'],
    maxlength: [2000, 'La note ne peut pas dépasser 2000 caractères']
  },
  type: {
    type: String,
    enum: ['note', 'call', 'email', 'meeting', 'task'],
    default: 'note'
  },
  isPrivate: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

const followUpSchema = new mongoose.Schema({
  scheduledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scheduledFor: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: ['call', 'email', 'meeting', 'task'],
    required: true
  },
  description: String,
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: Date,
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
})

const leadSchema = new mongoose.Schema({
  // Source et attribution
  source: {
    type: String,
    enum: ['simulator', 'contact_form', 'calendly', 'manual', 'referral', 'social_media'],
    required: [true, 'La source du lead est requise']
  },
  sourceDetails: {
    url: String,
    campaign: String,
    medium: String,
    utmSource: String,
    utmCampaign: String,
    utmMedium: String,
    utmTerm: String,
    utmContent: String
  },

  // Plateforme et assignation
  platform: {
    type: String,
    enum: ['youtube', 'spotify', 'meta', 'tiktok', 'google', 'multiple'],
    required: [true, 'La plateforme est requise']
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTeam: {
    type: String,
    enum: ['denis', 'marine'],
    required: true
  },

  // Statut et pipeline
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold'],
    default: 'new',
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  quality: {
    type: String,
    enum: ['cold', 'warm', 'hot'],
    default: 'cold'
  },

  // Informations client (chiffrées)
  artistName: {
    type: String,
    required: [true, 'Le nom de l\'artiste est requis'],
    maxlength: [100, 'Le nom de l\'artiste ne peut pas dépasser 100 caractères']
  },
  email: {
    type: String,
    required: [true, 'L\'email est requis'],
    set: encrypt,
    get: decrypt
  },
  phone: {
    type: String,
    set: encrypt,
    get: decrypt
  },
  country: {
    type: String,
    maxlength: [50, 'Le pays ne peut pas dépasser 50 caractères']
  },
  city: String,
  website: String,
  socialMedia: {
    youtube: String,
    spotify: String,
    instagram: String,
    tiktok: String,
    facebook: String
  },

  // Informations musical
  genre: String,
  label: String,
  monthlyListeners: Number,
  totalStreams: Number,
  releaseDate: Date,
  trackTitle: String,

  // Données campagne et budget
  budget: {
    type: Number,
    min: [0, 'Le budget ne peut pas être négatif']
  },
  budgetCurrency: {
    type: String,
    default: 'EUR',
    enum: ['EUR', 'USD', 'GBP', 'CAD']
  },
  campaignType: {
    type: String,
    enum: ['awareness', 'streams', 'subscribers', 'engagement', 'sales']
  },
  targetMarkets: [String],
  campaignDuration: Number, // en jours

  // Estimations et objectifs
  estimatedViews: Number,
  estimatedCPV: Number,
  estimatedReach: Number,
  goals: {
    primary: String,
    secondary: String,
    kpis: [String]
  },

  // Tracking temporel
  firstContactDate: Date,
  lastContactDate: Date,
  lastActivityDate: {
    type: Date,
    default: Date.now
  },
  wonDate: Date,
  lostDate: Date,

  // Résultat et raisons
  lostReason: {
    type: String,
    enum: ['budget', 'timing', 'competition', 'not_interested', 'bad_fit', 'no_response', 'other']
  },
  lostReasonDetails: String,

  // Valeur commerciale
  dealValue: {
    type: Number,
    min: [0, 'La valeur du deal ne peut pas être négative']
  },
  commission: {
    type: Number,
    min: [0, 'La commission ne peut pas être négative']
  },
  commissionRate: {
    type: Number,
    min: [0, 'Le taux de commission ne peut pas être négatif'],
    max: [100, 'Le taux de commission ne peut pas dépasser 100%']
  },

  // Communication et notes
  notes: [noteSchema],
  followUps: [followUpSchema],

  // Prochaine action
  nextFollowUp: Date,
  nextFollowUpType: {
    type: String,
    enum: ['call', 'email', 'meeting', 'proposal']
  },
  followUpCount: {
    type: Number,
    default: 0
  },

  // Documents et fichiers
  documents: [{
    name: String,
    url: String,
    type: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Métriques et scoring
  leadScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  responseTime: Number, // en minutes
  conversionProbability: Number, // pourcentage

  // Tags et catégorisation
  tags: [String],
  customFields: [{
    name: String,
    value: mongoose.Schema.Types.Mixed
  }],

  // Métadonnées
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: Date,
  archivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    getters: true,
    transform: function(doc, ret) {
      // Déchiffrer les champs sensibles pour l'affichage
      if (ret.email) ret.email = decrypt(ret.email)
      if (ret.phone) ret.phone = decrypt(ret.phone)
      return ret
    }
  },
  toObject: {
    virtuals: true,
    getters: true
  }
})

// Index pour optimiser les requêtes
leadSchema.index({ status: 1, assignedTo: 1 })
leadSchema.index({ platform: 1 })
leadSchema.index({ assignedTeam: 1 })
leadSchema.index({ source: 1 })
leadSchema.index({ createdAt: -1 })
leadSchema.index({ lastActivityDate: -1 })
leadSchema.index({ nextFollowUp: 1 })
leadSchema.index({ email: 1 })
leadSchema.index({ artistName: 'text' })
leadSchema.index({ isArchived: 1 })
leadSchema.index({ leadScore: -1 })

// Index composé pour les requêtes fréquentes
leadSchema.index({ assignedTo: 1, status: 1, createdAt: -1 })
leadSchema.index({ platform: 1, status: 1 })

// Virtuals
leadSchema.virtual('ageInDays').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24))
})

leadSchema.virtual('timeSinceLastContact').get(function() {
  if (!this.lastContactDate) return null
  return Math.floor((Date.now() - this.lastContactDate) / (1000 * 60 * 60 * 24))
})

leadSchema.virtual('isStale').get(function() {
  const daysSinceLastContact = this.timeSinceLastContact
  return daysSinceLastContact && daysSinceLastContact > 7
})

leadSchema.virtual('nextFollowUpOverdue').get(function() {
  return this.nextFollowUp && this.nextFollowUp < new Date()
})

// Middleware pre-save
leadSchema.pre('save', function(next) {
  // Mettre à jour lastActivityDate
  if (this.isModified() && !this.isModified('lastActivityDate')) {
    this.lastActivityDate = new Date()
  }

  // Auto-calculer le lead score
  this.calculateLeadScore()

  next()
})

// Méthodes d'instance
leadSchema.methods.addNote = function(authorId, content, type = 'note', isPrivate = false) {
  this.notes.push({
    author: authorId,
    content,
    type,
    isPrivate
  })
  this.lastActivityDate = new Date()
  return this.save()
}

leadSchema.methods.scheduleFollowUp = function(scheduledBy, scheduledFor, type, description) {
  this.followUps.push({
    scheduledBy,
    scheduledFor,
    type,
    description
  })
  this.nextFollowUp = scheduledFor
  this.nextFollowUpType = type
  this.followUpCount += 1
  return this.save()
}

leadSchema.methods.completeFollowUp = function(followUpId, completedBy) {
  const followUp = this.followUps.id(followUpId)
  if (followUp) {
    followUp.completed = true
    followUp.completedAt = new Date()
    followUp.completedBy = completedBy
    this.lastContactDate = new Date()
    this.lastActivityDate = new Date()
    return this.save()
  }
  throw new Error('Follow-up non trouvé')
}

leadSchema.methods.updateStatus = function(newStatus, userId, reason = null) {
  const oldStatus = this.status
  this.status = newStatus
  this.lastActivityDate = new Date()

  // Actions spéciales selon le statut
  if (newStatus === 'won') {
    this.wonDate = new Date()
  } else if (newStatus === 'lost') {
    this.lostDate = new Date()
    if (reason) this.lostReason = reason
  } else if (newStatus === 'contacted' && !this.firstContactDate) {
    this.firstContactDate = new Date()
    this.lastContactDate = new Date()
  }

  // Ajouter une note automatique du changement de statut
  this.addNote(userId, `Statut changé de "${oldStatus}" vers "${newStatus}"`, 'note')

  return this.save()
}

leadSchema.methods.calculateLeadScore = function() {
  let score = 0

  // Score basé sur le budget (0-30 points)
  if (this.budget) {
    if (this.budget >= 10000) score += 30
    else if (this.budget >= 5000) score += 20
    else if (this.budget >= 1000) score += 10
    else score += 5
  }

  // Score basé sur les followers/streams (0-25 points)
  if (this.monthlyListeners) {
    if (this.monthlyListeners >= 100000) score += 25
    else if (this.monthlyListeners >= 50000) score += 20
    else if (this.monthlyListeners >= 10000) score += 15
    else if (this.monthlyListeners >= 1000) score += 10
    else score += 5
  }

  // Score basé sur l'engagement (0-20 points)
  if (this.socialMedia.instagram || this.socialMedia.tiktok) score += 10
  if (this.website) score += 5
  if (this.label) score += 5

  // Score basé sur la source (0-15 points)
  switch (this.source) {
    case 'referral': score += 15; break
    case 'calendly': score += 12; break
    case 'contact_form': score += 8; break
    case 'simulator': score += 5; break
    default: score += 3
  }

  // Score basé sur la rapidité de réponse (0-10 points)
  if (this.responseTime) {
    if (this.responseTime <= 60) score += 10 // 1 heure
    else if (this.responseTime <= 240) score += 7 // 4 heures
    else if (this.responseTime <= 1440) score += 5 // 24 heures
    else score += 2
  }

  this.leadScore = Math.min(score, 100)
}

// Méthodes statiques
leadSchema.statics.findByStatus = function(status) {
  return this.find({ status, isArchived: false })
}

leadSchema.statics.findByAssignee = function(userId) {
  return this.find({ assignedTo: userId, isArchived: false })
}

leadSchema.statics.findByPlatform = function(platform) {
  return this.find({ platform, isArchived: false })
}

leadSchema.statics.findOverdueFollowUps = function() {
  return this.find({
    nextFollowUp: { $lt: new Date() },
    status: { $nin: ['won', 'lost'] },
    isArchived: false
  })
}

leadSchema.statics.getLeadStats = function(userId = null, startDate = null, endDate = null) {
  const match = { isArchived: false }

  if (userId) match.assignedTo = mongoose.Types.ObjectId(userId)
  if (startDate && endDate) {
    match.createdAt = { $gte: startDate, $lte: endDate }
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
        contacted: { $sum: { $cond: [{ $eq: ['$status', 'contacted'] }, 1, 0] } },
        qualified: { $sum: { $cond: [{ $eq: ['$status', 'qualified'] }, 1, 0] } },
        proposal_sent: { $sum: { $cond: [{ $eq: ['$status', 'proposal_sent'] }, 1, 0] } },
        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
        totalValue: { $sum: '$dealValue' },
        avgDealValue: { $avg: '$dealValue' },
        avgLeadScore: { $avg: '$leadScore' }
      }
    }
  ])
}

const Lead = mongoose.model('Lead', leadSchema)

export default Lead