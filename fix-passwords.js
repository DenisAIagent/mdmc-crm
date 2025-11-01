import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'

dotenv.config()

async function main() {
  try {
    console.log('🔗 Connexion à MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mdmc_crm')
    console.log('✅ Connecté à MongoDB')

    // Récupérer tous les utilisateurs
    const users = await mongoose.connection.db.collection('users').find({}).toArray()

    console.log(`👥 ${users.length} utilisateurs trouvés`)

    for (const user of users) {
      // Vérifier si le mot de passe est déjà haché (commence par $2a$ ou $2b$)
      if (!user.password.startsWith('$2')) {
        console.log(`🔐 Hashage du mot de passe pour ${user.email}`)
        const hashedPassword = await bcrypt.hash(user.password, 12)

        await mongoose.connection.db.collection('users').updateOne(
          { _id: user._id },
          { $set: { password: hashedPassword } }
        )
        console.log(`✅ Mot de passe mis à jour pour ${user.email}`)
      } else {
        console.log(`⏭️ Mot de passe déjà haché pour ${user.email}`)
      }
    }

    console.log('✅ Tous les mots de passe ont été traités!')

  } catch (error) {
    console.error('❌ Erreur:', error.message)
  } finally {
    await mongoose.disconnect()
    console.log('👋 Déconnecté de MongoDB')
  }
}

main()