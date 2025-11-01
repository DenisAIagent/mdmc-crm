import axios from 'axios'
import toast from 'react-hot-toast'
import Cookies from 'js-cookie'

// Configuration de base
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'

// Créer l'instance axios
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true
})

// Intercepteur de requête
api.interceptors.request.use(
  (config) => {
    // Ajouter le token d'authentification
    const token = Cookies.get('authToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // Ajouter un timestamp pour éviter le cache
    if (config.method === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now()
      }
    }

    // Log des requêtes en développement (seulement si pas en mode demo)
    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEBUG === 'true') {
      console.log(`REQUEST ${config.method?.toUpperCase()} ${config.url}`, {
        params: config.params,
        data: config.data
      })
    }

    return config
  },
  (error) => {
    console.error('Erreur de configuration de requête:', error)
    return Promise.reject(error)
  }
)

// Intercepteur de réponse
api.interceptors.response.use(
  (response) => {
    // Log des réponses en développement (seulement si debug activé)
    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEBUG === 'true') {
      console.log(`SUCCESS ${response.config.method?.toUpperCase()} ${response.config.url}`, {
        status: response.status,
        data: response.data
      })
    }

    return response
  },
  async (error) => {
    const originalRequest = error.config

    // Log des erreurs en développement (seulement si debug activé)
    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEBUG === 'true') {
      console.error(`ERROR ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      })
    }

    // Gestion de l'expiration du token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        // Tenter de rafraîchir le token
        const refreshToken = Cookies.get('refreshToken')

        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
            refreshToken
          })

          const { token } = response.data

          // Mettre à jour le cookie
          Cookies.set('authToken', token, {
            expires: 1,
            secure: import.meta.env.PROD,
            sameSite: 'strict'
          })

          // Relancer la requête originale avec le nouveau token
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        }
      } catch (refreshError) {
        console.error('Erreur de rafraîchissement du token:', refreshError)

        // Supprimer les tokens et rediriger vers la connexion
        Cookies.remove('authToken')
        Cookies.remove('refreshToken')

        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }

        return Promise.reject(refreshError)
      }
    }

    // Gestion des erreurs de réseau
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        toast.error('La requête a expiré. Veuillez réessayer.')
      } else if (error.message === 'Network Error') {
        toast.error('Erreur de connexion. Vérifiez votre connexion internet.')
      } else {
        toast.error('Une erreur est survenue. Veuillez réessayer.')
      }
      return Promise.reject(error)
    }

    // Gestion des erreurs HTTP
    const { status, data } = error.response

    switch (status) {
      case 400:
        if (data.errors && Array.isArray(data.errors)) {
          // Erreurs de validation
          data.errors.forEach(err => {
            toast.error(err.msg || err.message || 'Erreur de validation')
          })
        } else {
          toast.error(data.message || 'Requête invalide')
        }
        break

      case 401:
        if (originalRequest.url !== '/auth/login') {
          toast.error('Session expirée. Veuillez vous reconnecter.')
        }
        break

      case 403:
        toast.error('Accès refusé. Permissions insuffisantes.')
        break

      case 404:
        toast.error('Ressource non trouvée.')
        break

      case 409:
        toast.error(data.message || 'Conflit de données.')
        break

      case 422:
        if (data.errors && Array.isArray(data.errors)) {
          data.errors.forEach(err => {
            toast.error(err.msg || err.message || 'Erreur de validation')
          })
        } else {
          toast.error(data.message || 'Données invalides')
        }
        break

      case 429:
        toast.error('Trop de requêtes. Veuillez patienter.')
        break

      case 500:
        toast.error('Erreur serveur. Veuillez réessayer plus tard.')
        break

      case 502:
      case 503:
      case 504:
        toast.error('Service temporairement indisponible.')
        break

      default:
        toast.error(data.message || 'Une erreur est survenue.')
        break
    }

    return Promise.reject(error)
  }
)

// Fonctions utilitaires pour les requêtes API

// Leads API
export const leadsAPI = {
  // Récupérer tous les leads
  getAll: (params = {}) => api.get('/leads', { params }),

  // Récupérer un lead par ID
  getById: (id) => api.get(`/leads/${id}`),

  // Créer un lead
  create: (data) => api.post('/leads', data),

  // Mettre à jour un lead
  update: (id, data) => api.put(`/leads/${id}`, data),

  // Supprimer un lead
  delete: (id) => api.delete(`/leads/${id}`),

  // Ajouter une note
  addNote: (id, data) => api.post(`/leads/${id}/notes`, data),

  // Programmer un suivi
  scheduleFollowUp: (id, data) => api.post(`/leads/${id}/follow-ups`, data),

  // Marquer un suivi comme terminé
  completeFollowUp: (id, followUpId) => api.put(`/leads/${id}/follow-ups/${followUpId}/complete`),

  // Statistiques des leads
  getStats: (params = {}) => api.get('/leads/stats/overview', { params }),

  // Export CSV
  exportCSV: (params = {}) => api.get('/leads/export/csv', {
    params,
    responseType: 'blob'
  }),

  // Mise à jour en masse
  bulkUpdate: (data) => api.patch('/leads/bulk', data)
}

// Campagnes API
export const campaignsAPI = {
  // Récupérer toutes les campagnes
  getAll: (params = {}) => api.get('/campaigns', { params }),

  // Récupérer une campagne par ID
  getById: (id) => api.get(`/campaigns/${id}`),

  // Créer une campagne
  create: (data) => api.post('/campaigns', data),

  // Mettre à jour une campagne
  update: (id, data) => api.put(`/campaigns/${id}`, data),

  // Supprimer une campagne
  delete: (id) => api.delete(`/campaigns/${id}`),

  // Mettre à jour les KPIs
  updateKPIs: (id, data) => api.post(`/campaigns/${id}/kpis`, data),

  // Ajouter une optimisation
  addOptimization: (id, data) => api.post(`/campaigns/${id}/optimizations`, data),

  // Ajouter un feedback client
  addFeedback: (id, data) => api.post(`/campaigns/${id}/feedback`, data),

  // Statistiques des campagnes
  getStats: (params = {}) => api.get('/campaigns/stats/performance', { params }),

  // Campagnes nécessitant une optimisation
  getNeedingOptimization: () => api.get('/campaigns/optimization-needed'),

  // Export CSV
  exportCSV: (params = {}) => api.get('/campaigns/export/csv', {
    params,
    responseType: 'blob'
  })
}

// Analytics API
export const analyticsAPI = {
  // Dashboard général
  getDashboard: (params = {}) => api.get('/analytics/dashboard', { params }),

  // Métriques temps réel
  getRealtimeMetrics: (params = {}) => api.get('/analytics/realtime', { params }),

  // Analytics des leads
  getLeadsAnalytics: (params = {}) => api.get('/analytics/leads', { params }),

  // Analytics des campagnes
  getCampaignsAnalytics: (params = {}) => api.get('/analytics/campaigns', { params }),

  // Comparaison des équipes
  getTeamsComparison: (params = {}) => api.get('/analytics/teams', { params })
}

// Utilisateurs API
export const usersAPI = {
  // Récupérer tous les utilisateurs
  getAll: (params = {}) => api.get('/users', { params }),

  // Récupérer un utilisateur par ID
  getById: (id) => api.get(`/users/${id}`),

  // Créer un utilisateur
  create: (data) => api.post('/users', data),

  // Mettre à jour un utilisateur
  update: (id, data) => api.put(`/users/${id}`, data),

  // Supprimer un utilisateur
  delete: (id) => api.delete(`/users/${id}`),

  // Mettre à jour les permissions
  updatePermissions: (id, data) => api.put(`/users/${id}/permissions`, data),

  // Réinitialiser le mot de passe
  resetPassword: (id) => api.post(`/users/${id}/reset-password`),

  // Statistiques utilisateur
  getStats: (id) => api.get(`/users/${id}/stats`)
}

// Authentification API
export const authAPI = {
  // Connexion
  login: (data) => api.post('/auth/login', data),

  // Inscription
  register: (data) => api.post('/auth/register', data),

  // Déconnexion
  logout: () => api.post('/auth/logout'),

  // Profil actuel
  me: () => api.get('/auth/me'),

  // Rafraîchir le token
  refresh: (data) => api.post('/auth/refresh', data),

  // Changer le mot de passe
  changePassword: (data) => api.put('/auth/change-password', data),

  // Mot de passe oublié
  forgotPassword: (data) => api.post('/auth/forgot-password', data),

  // Réinitialiser le mot de passe
  resetPassword: (token, data) => api.post(`/auth/reset-password/${token}`, data),

  // Vérifier l'email
  verifyEmail: (token) => api.get(`/auth/verify-email/${token}`)
}

// Intégrations API
export const integrationsAPI = {
  // Test Brevo
  testBrevo: (data) => api.post('/integrations/brevo/test', data),

  // Envoyer email Brevo
  sendEmail: (data) => api.post('/integrations/brevo/send-email', data),

  // Templates Brevo
  getBrevoTemplates: () => api.get('/integrations/brevo/templates'),

  // Sync Google Ads
  syncGoogleAds: (data) => api.post('/integrations/google-ads/sync', data),

  // Sync Meta Ads
  syncMetaAds: (data) => api.post('/integrations/meta-ads/sync', data)
}

// Audit API
export const auditAPI = {
  // Récupérer les logs d'audit
  getLogs: (params = {}) => api.get('/audit', { params }),

  // Récupérer un log par ID
  getLogById: (id) => api.get(`/audit/${id}`),

  // Activité utilisateur
  getUserActivity: (userId, params = {}) => api.get(`/audit/user/${userId}`, { params }),

  // Historique d'une ressource
  getResourceHistory: (resourceType, resourceId) =>
    api.get(`/audit/resource/${resourceType}/${resourceId}`),

  // Événements de sécurité
  getSecurityEvents: (params = {}) => api.get('/audit/security/events', { params }),

  // Statistiques d'activité
  getActivityStats: (params = {}) => api.get('/audit/stats/activity', { params }),

  // Export CSV
  exportCSV: (params = {}) => api.get('/audit/export/csv', {
    params,
    responseType: 'blob'
  }),

  // Données GDPR
  getGDPRData: (email) => api.get(`/audit/gdpr/${email}`),

  // Archiver les anciens logs
  archiveOldLogs: (params = {}) => api.post('/audit/archive', null, { params }),

  // Activité suspecte
  getSuspiciousActivity: () => api.get('/audit/security/suspicious')
}

// Fonction utilitaire pour télécharger un fichier blob
export const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// Fonction utilitaire pour uploader un fichier
export const uploadFile = async (file, endpoint, onProgress) => {
  const formData = new FormData()
  formData.append('file', file)

  return api.post(endpoint, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress) {
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
        onProgress(progress)
      }
    }
  })
}

// Configuration pour les requêtes sans toast d'erreur automatique
export const apiSilent = axios.create({
  ...api.defaults,
  silent: true
})

// Supprimer l'intercepteur d'erreur pour les requêtes silencieuses
apiSilent.interceptors.response.handlers = []

export default api