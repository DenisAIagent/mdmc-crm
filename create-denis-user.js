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

const User = mongoose.model('User', userSchema)

async function main() {
  try {
    console.log('🔗 Connexion à MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mdmc_crm')
    console.log('✅ Connecté à MongoDB')

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email: 'denis@mdmcmusicads.com' })
    if (existingUser) {
      console.log('⚠️ L\'utilisateur denis@mdmcmusicads.com existe déjà')

      // Mettre à jour le mot de passe
      const hashedPassword = await bcrypt.hash('albert18', 12)
      await User.findByIdAndUpdate(existingUser._id, { password: hashedPassword })
      console.log('✅ Mot de passe mis à jour pour denis@mdmcmusicads.com')
    } else {
      console.log('👤 Création du nouvel utilisateur Denis...')

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash('albert18', 12)

      // Créer l'utilisateur
      const newUser = await User.create({
        firstName: 'Denis',
        lastName: 'MDMC',
        email: 'denis@mdmcmusicads.com',
        password: hashedPassword,
        role: 'admin',
        team: 'denis',
        assignedPlatforms: ['youtube', 'spotify'],
        isActive: true,
        isVerified: true
      })

      console.log('✅ Utilisateur créé avec succès!')
    }

    console.log('')
    console.log('📋 Accès créé:')
    console.log('   Email:       denis@mdmcmusicads.com')
    console.log('   Mot de passe: albert18')
    console.log('   Rôle:        Admin')
    console.log('')

  } catch (error) {
    console.error('❌ Erreur:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('👋 Déconnecté de MongoDB')
  }
}

main()