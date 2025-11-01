import mongoose from 'mongoose'

const kpiSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Métriques principales
  impressions: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  reach: { type: Number, default: 0 },
  frequency: { type: Number, default: 0 },

  // Engagement
  likes: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  follows: { type: Number, default: 0 },

  // Conversions
  conversions: { type: Number, default: 0 },
  conversionValue: { type: Number, default: 0 },
  streamClicks: { type: Number, default: 0 },
  actualStreams: { type: Number, default: 0 },

  // Coûts et performance
  spend: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpv: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  vtr: { type: Number, default: 0 }, // View Through Rate

  // Métriques spécifiques aux plateformes
  platformSpecific: {
    youtube: {
      watchTime: Number,
      avgViewDuration: Number,
      subscribers: Number,
      retention25: Number,
      retention50: Number,
      retention75: Number
    },
    spotify: {
      streams: Number,
      saves: Number,
      followers: Number,
      playlistAdds: Number,
      skipRate: Number
    },
    meta: {
      videoViews: Number,
      postEngagement: Number,
      pageFollows: Number,
      linkClicks: Number,
      videoPlays: Number
    },
    tiktok: {
      videoViews: Number,
      profileViews: Number,
      followers: Number,
      likes: Number,
      shares: Number
    }
  }
}, {
  _id: false
})

const creativeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'video', 'carousel', 'story'],
    required: true
  },
  url: String,
  thumbnailUrl: String,
  description: String,
  isActive: {
    type: Boolean,
    default: true
  },
  performance: {
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 }
  }
}, {
  timestamps: true
})

const audienceSchema = new mongoose.Schema({
  name: String,
  type: {
    type: String,
    enum: ['custom', 'lookalike', 'interest', 'behavior', 'demographic'],
    required: true
  },
  platform: {
    type: String,
    enum: ['youtube', 'meta', 'tiktok', 'google'],
    required: true
  },
  size: Number,
  targeting: {
    demographics: {
      ageMin: Number,
      ageMax: Number,
      genders: [String],
      locations: [String],
      languages: [String]
    },
    interests: [String],
    behaviors: [String],
    customAudiences: [String]
  },
  isActive: {
    type: Boolean,
    default: true
  }
})

const campaignSchema = new mongoose.Schema({
  // Relation avec le lead
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: [true, 'L\'ID du lead est requis']
  },

  // Informations de base
  name: {
    type: String,
    required: [true, 'Le nom de la campagne est requis'],
    maxlength: [200, 'Le nom ne peut pas dépasser 200 caractères']
  },
  description: {
    type: String,
    maxlength: [1000, 'La description ne peut pas dépasser 1000 caractères']
  },

  // Plateforme et gestion
  platform: {
    type: String,
    enum: ['youtube', 'spotify', 'meta', 'tiktok', 'google'],
    required: [true, 'La plateforme est requise']
  },
  managedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  managedTeam: {
    type: String,
    enum: ['denis', 'marine'],
    required: true
  },

  // Statut et timeline
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  startDate: {
    type: Date,
    required: [true, 'La date de début est requise']
  },
  endDate: {
    type: Date,
    required: [true, 'La date de fin est requise']
  },
  actualStartDate: Date,
  actualEndDate: Date,

  // Budget et facturation
  budget: {
    total: {
      type: Number,
      required: [true, 'Le budget total est requis'],
      min: [0, 'Le budget ne peut pas être négatif']
    },
    daily: {
      type: Number,
      min: [0, 'Le budget quotidien ne peut pas être négatif']
    },
    currency: {
      type: String,
      default: 'EUR',
      enum: ['EUR', 'USD', 'GBP', 'CAD']
    }
  },
  spent: {
    type: Number,
    default: 0,
    min: [0, 'Le montant dépensé ne peut pas être négatif']
  },
  billingModel: {
    type: String,
    enum: ['cpm', 'cpc', 'cpv', 'cpa', 'fixed'],
    default: 'cpm'
  },

  // Objectifs et KPIs
  objectives: {
    primary: {
      type: String,
      enum: ['awareness', 'reach', 'engagement', 'traffic', 'conversions', 'streams', 'followers'],
      required: true
    },
    secondary: [String],
    targets: {
      views: Number,
      clicks: Number,
      conversions: Number,
      streams: Number,
      ctr: Number,
      cpv: Number,
      cpc: Number
    }
  },

  // Configuration créative
  creatives: [creativeSchema],
  audiences: [audienceSchema],

  // Paramètres de la campagne
  settings: {
    bidStrategy: String,
    placement: [String],
    schedule: {
      timezone: { type: String, default: 'Europe/Paris' },
      dayparting: [{
        day: String,
        startHour: Number,
        endHour: Number
      }]
    },
    frequencyCap: {
      impressions: Number,
      period: String // daily, weekly, monthly
    }
  },

  // Tracking et intégrations
  platformCampaignId: String, // ID de la campagne sur la plateforme
  trackingUrls: {
    landingPage: String,
    streamingPlatform: String,
    custom: [String]
  },
  utmParameters: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },

  // Performance en temps réel
  currentKpis: kpiSchema,
  historicalKpis: [kpiSchema],

  // Optimisations et tests
  optimizations: [{
    date: { type: Date, default: Date.now },
    type: String, // 'budget', 'targeting', 'creative', 'bid'
    description: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    impact: String
  }],

  abTests: [{
    name: String,
    variable: String, // 'creative', 'audience', 'bid'
    variants: [{
      name: String,
      allocation: Number, // percentage
      performance: kpiSchema
    }],
    winner: String,
    isActive: Boolean
  }],

  // Communication client
  clientAccess: {
    hasAccess: { type: Boolean, default: false },
    dashboardUrl: String,
    reportFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly'],
      default: 'weekly'
    },
    lastReportSent: Date
  },

  // Feedback et satisfaction
  clientFeedback: [{
    date: { type: Date, default: Date.now },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    category: {
      type: String,
      enum: ['performance', 'communication', 'reporting', 'overall']
    }
  }],
  nps: {
    type: Number,
    min: 0,
    max: 10
  },

  // Méta-données
  tags: [String],
  category: String,
  isTemplate: {
    type: Boolean,
    default: false
  },
  parentCampaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  },
  childCampaigns: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Index pour optimiser les requêtes
campaignSchema.index({ managedBy: 1, status: 1 })
campaignSchema.index({ platform: 1 })
campaignSchema.index({ leadId: 1 })
campaignSchema.index({ startDate: 1, endDate: 1 })
campaignSchema.index({ status: 1, createdAt: -1 })
campaignSchema.index({ 'currentKpis.date': -1 })

// Index composé pour les requêtes fréquentes
campaignSchema.index({ managedTeam: 1, status: 1, startDate: -1 })
campaignSchema.index({ platform: 1, status: 1 })

// Virtuals
campaignSchema.virtual('duration').get(function() {
  return Math.ceil((this.endDate - this.startDate) / (1000 * 60 * 60 * 24))
})

campaignSchema.virtual('daysRemaining').get(function() {
  if (this.status === 'completed' || this.status === 'cancelled') return 0
  return Math.max(0, Math.ceil((this.endDate - Date.now()) / (1000 * 60 * 60 * 24)))
})

campaignSchema.virtual('budgetUtilization').get(function() {
  if (this.budget.total === 0) return 0
  return (this.spent / this.budget.total * 100).toFixed(2)
})

campaignSchema.virtual('dailyBudgetRecommended').get(function() {
  const remainingBudget = this.budget.total - this.spent
  const remainingDays = this.daysRemaining
  return remainingDays > 0 ? (remainingBudget / remainingDays).toFixed(2) : 0
})

campaignSchema.virtual('performanceScore').get(function() {
  if (!this.currentKpis || !this.objectives.targets) return 0

  let score = 0
  let factors = 0

  // Score basé sur les objectifs atteints
  const targets = this.objectives.targets
  const current = this.currentKpis

  if (targets.views && current.views) {
    score += Math.min(100, (current.views / targets.views) * 100)
    factors++
  }

  if (targets.ctr && current.ctr) {
    score += Math.min(100, (current.ctr / targets.ctr) * 100)
    factors++
  }

  if (targets.cpv && current.cpv) {
    // Pour CPV, un score plus bas est meilleur
    score += Math.min(100, (targets.cpv / current.cpv) * 100)
    factors++
  }

  return factors > 0 ? Math.round(score / factors) : 0
})

// Middleware pre-save
campaignSchema.pre('save', function(next) {
  // Valider que la date de fin est après la date de début
  if (this.endDate <= this.startDate) {
    return next(new Error('La date de fin doit être après la date de début'))
  }

  // Calculer le budget quotidien si non défini
  if (!this.budget.daily && this.budget.total) {
    this.budget.daily = this.budget.total / this.duration
  }

  // Mettre à jour l'équipe managée selon l'utilisateur assigné
  if (this.isModified('managedBy')) {
    // Cette logique sera complétée avec la référence User
  }

  next()
})

// Méthodes d'instance
campaignSchema.methods.updateKpis = function(newKpis) {
  // Sauvegarder les KPIs actuels dans l'historique
  if (this.currentKpis && this.currentKpis.date) {
    this.historicalKpis.push(this.currentKpis)
  }

  // Mettre à jour les KPIs actuels
  this.currentKpis = {
    ...newKpis,
    date: new Date()
  }

  return this.save()
}

campaignSchema.methods.addOptimization = function(type, description, performedBy, impact = null) {
  this.optimizations.push({
    type,
    description,
    performedBy,
    impact
  })
  return this.save()
}

campaignSchema.methods.updateStatus = function(newStatus, userId) {
  const oldStatus = this.status
  this.status = newStatus

  if (newStatus === 'active' && !this.actualStartDate) {
    this.actualStartDate = new Date()
  } else if (['completed', 'cancelled'].includes(newStatus) && !this.actualEndDate) {
    this.actualEndDate = new Date()
  }

  // Ajouter une optimisation pour tracker le changement de statut
  this.addOptimization(
    'status_change',
    `Statut changé de "${oldStatus}" vers "${newStatus}"`,
    userId
  )

  return this.save()
}

campaignSchema.methods.calculateROI = function() {
  if (this.spent === 0) return 0

  // ROI basé sur les conversions et leur valeur
  const revenue = this.currentKpis.conversionValue || 0
  return ((revenue - this.spent) / this.spent * 100).toFixed(2)
}

campaignSchema.methods.addClientFeedback = function(rating, comment, category = 'overall') {
  this.clientFeedback.push({
    rating,
    comment,
    category
  })

  // Calculer la note moyenne
  const totalRatings = this.clientFeedback.length
  const sumRatings = this.clientFeedback.reduce((sum, feedback) => sum + feedback.rating, 0)
  this.averageRating = (sumRatings / totalRatings).toFixed(1)

  return this.save()
}

// Méthodes statiques
campaignSchema.statics.findActive = function() {
  return this.find({
    status: 'active',
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() }
  })
}

campaignSchema.statics.findByManager = function(userId) {
  return this.find({ managedBy: userId })
}

campaignSchema.statics.findByPlatform = function(platform) {
  return this.find({ platform })
}

campaignSchema.statics.getPerformanceStats = function(managerId = null, startDate = null, endDate = null) {
  const match = {}

  if (managerId) match.managedBy = mongoose.Types.ObjectId(managerId)
  if (startDate && endDate) {
    match.createdAt = { $gte: startDate, $lte: endDate }
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCampaigns: { $sum: 1 },
        activeCampaigns: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        completedCampaigns: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalBudget: { $sum: '$budget.total' },
        totalSpent: { $sum: '$spent' },
        avgPerformanceScore: { $avg: '$performanceScore' },
        totalViews: { $sum: '$currentKpis.views' },
        totalClicks: { $sum: '$currentKpis.clicks' },
        avgCPV: { $avg: '$currentKpis.cpv' },
        avgCTR: { $avg: '$currentKpis.ctr' }
      }
    }
  ])
}

campaignSchema.statics.findNeedingOptimization = function() {
  return this.find({
    status: 'active',
    $or: [
      { 'currentKpis.ctr': { $lt: 1 } }, // CTR faible
      { 'currentKpis.cpv': { $gt: 0.1 } }, // CPV élevé
      { budgetUtilization: { $gt: 80 } } // Budget presque épuisé
    ]
  })
}

const Campaign = mongoose.model('Campaign', campaignSchema)

export default Campaign