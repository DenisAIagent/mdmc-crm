import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'

dotenv.config()

// Schéma utilisateur simplifié
const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['admin', 'manager', 'agent'], default: 'agent' },
  team: String,
  assignedPlatforms: [String],
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: true }
}, { timestamps: true })

// Hash du mot de passe avant sauvegarde
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

const User = mongoose.model('User', userSchema)

async function main() {
  try {
    console.log('🔗 Connexion à MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mdmc_crm')
    console.log('✅ Connecté à MongoDB')

    // Vérifier si des utilisateurs existent
    const userCount = await User.countDocuments()
    if (userCount > 0) {
      console.log('⚠️ Des utilisateurs existent déjà')
      await mongoose.disconnect()
      return
    }

    console.log('👥 Création des utilisateurs...')

    // Créer les utilisateurs
    const users = [
      {
        firstName: 'Denis',
        lastName: 'Admin',
        email: 'denis@mdmc-music-ads.com',
        password: 'AdminPassword123!',
        role: 'admin',
        team: 'denis',
        assignedPlatforms: ['youtube', 'spotify']
      },
      {
        firstName: 'Marine',
        lastName: 'Manager',
        email: 'marine@mdmc-music-ads.com',
        password: 'ManagerPassword123!',
        role: 'manager',
        team: 'marine',
        assignedPlatforms: ['meta', 'tiktok']
      },
      {
        firstName: 'Agent',
        lastName: 'Denis Team',
        email: 'agent.denis@mdmc-music-ads.com',
        password: 'AgentPassword123!',
        role: 'agent',
        team: 'denis',
        assignedPlatforms: ['youtube', 'spotify']
      },
      {
        firstName: 'Agent',
        lastName: 'Marine Team',
        email: 'agent.marine@mdmc-music-ads.com',
        password: 'AgentPassword123!',
        role: 'agent',
        team: 'marine',
        assignedPlatforms: ['meta', 'tiktok']
      }
    ]

    await User.insertMany(users)

    console.log('✅ Utilisateurs créés avec succès!')
    console.log('')
    console.log('📋 Comptes disponibles:')
    console.log('   Admin Denis:     denis@mdmc-music-ads.com      / AdminPassword123!')
    console.log('   Manager Marine:  marine@mdmc-music-ads.com     / ManagerPassword123!')
    console.log('   Agent Denis:     agent.denis@mdmc-music-ads.com / AgentPassword123!')
    console.log('   Agent Marine:    agent.marine@mdmc-music-ads.com / AgentPassword123!')
    console.log('')

  } catch (error) {
    console.error('❌ Erreur:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('👋 Déconnecté de MongoDB')
  }
}

main()