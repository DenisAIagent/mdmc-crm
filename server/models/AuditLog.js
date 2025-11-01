import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  // Utilisateur qui a effectué l'action
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      // userId peut être null pour les tentatives de connexion avec email inexistant
      return !['login_attempt', 'register_attempt'].includes(this.action)
    }
  },
  userEmail: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    required: true
  },

  // Action effectuée
  action: {
    type: String,
    required: [true, 'L\'action est requise'],
    enum: [
      // Actions utilisateur
      'user_login',
      'user_logout',
      'user_login_failed',
      'login_success',
      'login_attempt',
      'logout',
      'token_refresh',
      'register_attempt',
      'create_user',
      'user_created',
      'user_updated',
      'user_deleted',
      'user_password_changed',
      'user_role_changed',

      // Actions lead
      'lead_created',
      'lead_updated',
      'lead_deleted',
      'lead_status_changed',
      'lead_assigned',
      'lead_note_added',
      'lead_followup_scheduled',
      'lead_exported',
      'lead_imported',

      // Actions campagne
      'campaign_created',
      'campaign_updated',
      'campaign_deleted',
      'campaign_started',
      'campaign_paused',
      'campaign_completed',
      'campaign_optimized',
      'campaign_kpis_updated',

      // Actions système
      'data_exported',
      'data_imported',
      'settings_changed',
      'integration_connected',
      'integration_disconnected',
      'backup_created',
      'backup_restored',

      // Actions sécurité
      'security_incident',
      'suspicious_activity',
      'access_denied',
      'permission_changed'
    ]
  },

  // Ressource affectée
  resourceType: {
    type: String,
    enum: ['user', 'lead', 'campaign', 'setting', 'integration', 'system', 'auth'],
    required: true
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: function() {
      return ['user', 'lead', 'campaign'].includes(this.resourceType)
    }
  },
  resourceName: String, // Nom de la ressource pour faciliter la lecture

  // Détails de l'action
  description: {
    type: String,
    required: [true, 'La description est requise'],
    maxlength: [500, 'La description ne peut pas dépasser 500 caractères']
  },

  // Données avant/après pour les modifications
  previousData: mongoose.Schema.Types.Mixed,
  newData: mongoose.Schema.Types.Mixed,
  changedFields: [String],

  // Informations de session
  sessionId: String,
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: String,
  requestUrl: String,
  requestMethod: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  },

  // Géolocalisation (optionnelle)
  location: {
    country: String,
    city: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },

  // Métadonnées
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  category: {
    type: String,
    enum: ['authentication', 'authorization', 'data_access', 'data_modification', 'system', 'security'],
    required: true
  },
  tags: [String],

  // Résultat de l'action
  success: {
    type: Boolean,
    required: true
  },
  errorMessage: String,
  errorCode: String,

  // Temps de traitement
  processingTime: Number, // en millisecondes
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },

  // Conformité RGPD
  gdprRelevant: {
    type: Boolean,
    default: false
  },
  dataSubject: String, // Email de la personne concernée par les données

  // Retention et archivage
  retentionPeriod: {
    type: Number,
    default: 365 // jours
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: Date
}, {
  timestamps: false, // On utilise notre propre timestamp
  collection: 'audit_logs'
})

// Index pour optimiser les requêtes
auditLogSchema.index({ userId: 1, timestamp: -1 })
auditLogSchema.index({ action: 1, timestamp: -1 })
auditLogSchema.index({ resourceType: 1, resourceId: 1 })
auditLogSchema.index({ ipAddress: 1 })
auditLogSchema.index({ severity: 1, timestamp: -1 })
auditLogSchema.index({ category: 1, timestamp: -1 })
auditLogSchema.index({ success: 1, timestamp: -1 })
auditLogSchema.index({ gdprRelevant: 1 })
auditLogSchema.index({ isArchived: 1, timestamp: -1 })

// Index composé pour les requêtes fréquentes
auditLogSchema.index({ userId: 1, action: 1, timestamp: -1 })
auditLogSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 })
auditLogSchema.index({ severity: 1, category: 1, timestamp: -1 })

// Index TTL pour suppression automatique après rétention
auditLogSchema.index(
  { timestamp: 1 },
  {
    expireAfterSeconds: 31536000, // 365 jours par défaut
    partialFilterExpression: { isArchived: false }
  }
)

// Virtuals
auditLogSchema.virtual('age').get(function() {
  return Date.now() - this.timestamp
})

auditLogSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
})

auditLogSchema.virtual('isRecent').get(function() {
  const hourAgo = Date.now() - (60 * 60 * 1000)
  return this.timestamp > hourAgo
})

// Méthodes statiques
auditLogSchema.statics.logAction = async function(actionData) {
  try {
    const log = new this(actionData)
    await log.save()
    return log
  } catch (error) {
    console.error('Erreur lors de la création du log d\'audit:', error)
    throw error
  }
}

auditLogSchema.statics.getUserActivity = function(userId, startDate = null, endDate = null) {
  const match = { userId: mongoose.Types.ObjectId(userId) }

  if (startDate && endDate) {
    match.timestamp = { $gte: startDate, $lte: endDate }
  }

  return this.find(match)
    .sort({ timestamp: -1 })
    .limit(100)
}

auditLogSchema.statics.getResourceHistory = function(resourceType, resourceId) {
  return this.find({
    resourceType,
    resourceId: mongoose.Types.ObjectId(resourceId)
  }).sort({ timestamp: -1 })
}

auditLogSchema.statics.getSecurityEvents = function(startDate = null, endDate = null) {
  const match = {
    $or: [
      { severity: { $in: ['high', 'critical'] } },
      { category: 'security' },
      { action: { $in: ['user_login_failed', 'access_denied', 'suspicious_activity'] } }
    ]
  }

  if (startDate && endDate) {
    match.timestamp = { $gte: startDate, $lte: endDate }
  }

  return this.find(match).sort({ timestamp: -1 })
}

auditLogSchema.statics.getActivityStats = function(startDate = null, endDate = null) {
  const match = {}

  if (startDate && endDate) {
    match.timestamp = { $gte: startDate, $lte: endDate }
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          action: '$action',
          date: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$timestamp'
            }
          }
        },
        count: { $sum: 1 },
        successCount: { $sum: { $cond: ['$success', 1, 0] } },
        errorCount: { $sum: { $cond: ['$success', 0, 1] } }
      }
    },
    { $sort: { '_id.date': -1, count: -1 } }
  ])
}

auditLogSchema.statics.getTopUsers = function(startDate = null, endDate = null, limit = 10) {
  const match = {}

  if (startDate && endDate) {
    match.timestamp = { $gte: startDate, $lte: endDate }
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$userId',
        userName: { $first: '$userName' },
        userEmail: { $first: '$userEmail' },
        totalActions: { $sum: 1 },
        successfulActions: { $sum: { $cond: ['$success', 1, 0] } },
        failedActions: { $sum: { $cond: ['$success', 0, 1] } },
        lastActivity: { $max: '$timestamp' }
      }
    },
    { $sort: { totalActions: -1 } },
    { $limit: limit }
  ])
}

auditLogSchema.statics.findSuspiciousActivity = function() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: oneHourAgo },
        success: false
      }
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          ipAddress: '$ipAddress'
        },
        failedAttempts: { $sum: 1 },
        actions: { $push: '$action' },
        lastAttempt: { $max: '$timestamp' }
      }
    },
    {
      $match: {
        failedAttempts: { $gte: 3 } // 3 échecs ou plus en 1 heure
      }
    },
    { $sort: { failedAttempts: -1 } }
  ])
}

auditLogSchema.statics.getGDPRLogs = function(dataSubject) {
  return this.find({
    $or: [
      { gdprRelevant: true, dataSubject },
      { userEmail: dataSubject }
    ]
  }).sort({ timestamp: -1 })
}

auditLogSchema.statics.archiveOldLogs = async function(daysOld = 365) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)

  const result = await this.updateMany(
    {
      timestamp: { $lt: cutoffDate },
      isArchived: false
    },
    {
      $set: {
        isArchived: true,
        archivedAt: new Date()
      }
    }
  )

  return result
}

// Méthodes d'instance
auditLogSchema.methods.archive = function() {
  this.isArchived = true
  this.archivedAt = new Date()
  return this.save()
}

auditLogSchema.methods.addTags = function(tags) {
  this.tags = [...new Set([...this.tags, ...tags])]
  return this.save()
}

// Middleware pre-save
auditLogSchema.pre('save', function(next) {
  // S'assurer que la timestamp est définie
  if (!this.timestamp) {
    this.timestamp = new Date()
  }

  // Déterminer automatiquement la sévérité si non définie
  if (!this.severity) {
    if (this.category === 'security' || !this.success) {
      this.severity = 'high'
    } else if (['data_modification', 'authorization'].includes(this.category)) {
      this.severity = 'medium'
    } else {
      this.severity = 'low'
    }
  }

  // Marquer comme pertinent RGPD si nécessaire
  if (['user_created', 'user_updated', 'user_deleted', 'data_exported'].includes(this.action)) {
    this.gdprRelevant = true
  }

  next()
})

const AuditLog = mongoose.model('AuditLog', auditLogSchema)

export default AuditLog