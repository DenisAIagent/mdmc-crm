const corsOptions = {
  origin: function (origin, callback) {
    // Liste des domaines autorisés
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:4173',
      'https://mdmc-crm.up.railway.app',
      'https://mdmc-music-ads.com',
      'https://www.mdmc-music-ads.com'
    ]

    // Autoriser les requêtes sans origin (mobile apps, postman, etc.)
    if (!origin) return callback(null, true)

    // En développement, autoriser localhost sur n'importe quel port
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Non autorisé par CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 heures
}

export { corsOptions }