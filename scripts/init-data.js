#!/usr/bin/env node

/**
 * Script d'initialisation des données pour MDMC CRM
 * Crée les utilisateurs par défaut et les données de démonstration
 */

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Configuration du chemin
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Charger les variables d'environnement
dotenv.config({ path: join(__dirname, '../.env') })

// Importer les modèles
import User from '../server/models/User.js'
import Lead from '../server/models/Lead.js'
import Campaign from '../server/models/Campaign.js'
import { encrypt } from '../server/utils/encryption.js'

async function connectDatabase() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mdmc_crm'
    await mongoose.connect(mongoURI)
    console.log('✅ Connexion à MongoDB réussie')
  } catch (error) {
    console.error('❌ Erreur de connexion à MongoDB:', error.message)
    process.exit(1)
  }
}

async function createDefaultUsers() {
  console.log('📝 Création des utilisateurs par défaut...')

  try {
    // Vérifier si des utilisateurs existent déjà
    const existingUsers = await User.countDocuments()
    if (existingUsers > 0) {
      console.log('⚠️ Des utilisateurs existent déjà, ignorer la création')
      return
    }

    // Créer l'administrateur Denis
    const denisUser = await User.create({
      firstName: 'Denis',
      lastName: 'Administrateur',
      email: 'denis@mdmc-music-ads.com',
      password: 'AdminPassword123!',
      role: 'admin',
      team: 'denis',
      assignedPlatforms: ['youtube', 'spotify'],
      permissions: {
        leads: { create: true, read: true, update: true, delete: true },
        campaigns: { create: true, read: true, update: true, delete: true },
        analytics: { read: true, export: true },
        admin: { users: true, settings: true, audit: true }
      },
      preferences: {
        language: 'fr',
        timezone: 'Europe/Paris',
        notifications: {
          email: true,
          browser: true,
          slack: false
        },
        dashboard: {
          defaultView: 'kanban',
          refreshInterval: 30000
        }
      },
      isActive: true,
      isVerified: true
    })

    // Créer la manager Marine
    const marineUser = await User.create({
      firstName: 'Marine',
      lastName: 'Manager',
      email: 'marine@mdmc-music-ads.com',
      password: 'ManagerPassword123!',
      role: 'manager',
      team: 'marine',
      assignedPlatforms: ['meta', 'tiktok'],
      permissions: {
        leads: { create: true, read: true, update: true, delete: true },
        campaigns: { create: true, read: true, update: true, delete: true },
        analytics: { read: true, export: true },
        admin: { users: false, settings: false, audit: false }
      },
      preferences: {
        language: 'fr',
        timezone: 'Europe/Paris',
        notifications: {
          email: true,
          browser: true,
          slack: false
        },
        dashboard: {
          defaultView: 'list',
          refreshInterval: 30000
        }
      },
      isActive: true,
      isVerified: true
    })

    // Créer un agent pour l'équipe Denis
    const agentDenis = await User.create({
      firstName: 'Agent',
      lastName: 'Denis Team',
      email: 'agent.denis@mdmc-music-ads.com',
      password: 'AgentPassword123!',
      role: 'agent',
      team: 'denis',
      assignedPlatforms: ['youtube', 'spotify'],
      permissions: {
        leads: { create: true, read: true, update: true, delete: false },
        campaigns: { create: true, read: true, update: true, delete: false },
        analytics: { read: true, export: false },
        admin: { users: false, settings: false, audit: false }
      },
      isActive: true,
      isVerified: true
    })

    // Créer un agent pour l'équipe Marine
    const agentMarine = await User.create({
      firstName: 'Agent',
      lastName: 'Marine Team',
      email: 'agent.marine@mdmc-music-ads.com',
      password: 'AgentPassword123!',
      role: 'agent',
      team: 'marine',
      assignedPlatforms: ['meta', 'tiktok'],
      permissions: {
        leads: { create: true, read: true, update: true, delete: false },
        campaigns: { create: true, read: true, update: true, delete: false },
        analytics: { read: true, export: false },
        admin: { users: false, settings: false, audit: false }
      },
      isActive: true,
      isVerified: true
    })

    console.log('✅ Utilisateurs par défaut créés:')
    console.log(`   👨‍💼 Admin Denis: ${denisUser.email}`)
    console.log(`   👩‍💼 Manager Marine: ${marineUser.email}`)
    console.log(`   👨‍💻 Agent Denis: ${agentDenis.email}`)
    console.log(`   👩‍💻 Agent Marine: ${agentMarine.email}`)

    return { denisUser, marineUser, agentDenis, agentMarine }

  } catch (error) {
    console.error('❌ Erreur lors de la création des utilisateurs:', error.message)
    throw error
  }
}

async function createDemoLeads(users) {
  console.log('🎯 Création des leads de démonstration...')

  try {
    const { denisUser, marineUser, agentDenis, agentMarine } = users

    // Leads pour l'équipe Denis (YouTube/Spotify)
    const denisLeads = [
      {
        artistName: 'Alex Melody',
        email: encrypt('alex.melody@example.com'),
        phone: encrypt('+33123456789'),
        platform: 'youtube',
        source: 'simulator',
        status: 'new',
        priority: 'high',
        quality: 'hot',
        assignedTo: denisUser._id,
        assignedTeam: 'denis',
        budget: 8000,
        budgetCurrency: 'EUR',
        genre: 'Pop',
        country: 'France',
        city: 'Paris',
        monthlyListeners: 75000,
        totalStreams: 2500000,
        campaignType: 'awareness',
        targetMarkets: ['France', 'Belgium', 'Switzerland'],
        campaignDuration: 30,
        estimatedViews: 500000,
        estimatedCPV: 0.02,
        goals: {
          primary: 'Augmenter la notoriété',
          secondary: 'Développer l\'audience YouTube',
          kpis: ['views', 'subscribers', 'engagement']
        },
        leadScore: 85,
        socialMedia: {
          youtube: 'https://youtube.com/@alexmelody',
          spotify: 'https://open.spotify.com/artist/alexmelody',
          instagram: '@alexmelody'
        }
      },
      {
        artistName: 'Sophie Acoustic',
        email: encrypt('sophie.acoustic@example.com'),
        phone: encrypt('+33187654321'),
        platform: 'spotify',
        source: 'contact_form',
        status: 'contacted',
        priority: 'medium',
        quality: 'warm',
        assignedTo: agentDenis._id,
        assignedTeam: 'denis',
        budget: 5000,
        budgetCurrency: 'EUR',
        genre: 'Folk',
        country: 'Canada',
        city: 'Montreal',
        monthlyListeners: 35000,
        totalStreams: 1200000,
        campaignType: 'streams',
        targetMarkets: ['Canada', 'France', 'United States'],
        campaignDuration: 45,
        leadScore: 70,
        firstContactDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        lastContactDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      },
      {
        artistName: 'Urban Beats Collective',
        email: encrypt('contact@urbanbeatscollective.com'),
        phone: encrypt('+33198765432'),
        platform: 'youtube',
        source: 'referral',
        status: 'qualified',
        priority: 'high',
        quality: 'hot',
        assignedTo: denisUser._id,
        assignedTeam: 'denis',
        budget: 12000,
        budgetCurrency: 'EUR',
        genre: 'Hip-Hop',
        country: 'United States',
        city: 'Los Angeles',
        monthlyListeners: 150000,
        totalStreams: 5000000,
        campaignType: 'engagement',
        targetMarkets: ['United States', 'United Kingdom', 'France'],
        campaignDuration: 60,
        leadScore: 92,
        firstContactDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        lastContactDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    ]

    // Leads pour l'équipe Marine (Meta/TikTok)
    const marineLeads = [
      {
        artistName: 'TikTok Star Luna',
        email: encrypt('luna.star@example.com'),
        phone: encrypt('+33156789123'),
        platform: 'tiktok',
        source: 'social_media',
        status: 'proposal_sent',
        priority: 'urgent',
        quality: 'hot',
        assignedTo: marineUser._id,
        assignedTeam: 'marine',
        budget: 15000,
        budgetCurrency: 'EUR',
        genre: 'Dance',
        country: 'Germany',
        city: 'Berlin',
        monthlyListeners: 200000,
        totalStreams: 8000000,
        campaignType: 'viral',
        targetMarkets: ['Germany', 'France', 'Netherlands'],
        campaignDuration: 21,
        estimatedReach: 2000000,
        leadScore: 95,
        dealValue: 15000,
        firstContactDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        lastContactDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      },
      {
        artistName: 'Meta Music Band',
        email: encrypt('info@metamusicband.com'),
        phone: encrypt('+33167891234'),
        platform: 'meta',
        source: 'calendly',
        status: 'negotiation',
        priority: 'high',
        quality: 'hot',
        assignedTo: agentMarine._id,
        assignedTeam: 'marine',
        budget: 10000,
        budgetCurrency: 'EUR',
        genre: 'Rock',
        country: 'United Kingdom',
        city: 'London',
        monthlyListeners: 95000,
        totalStreams: 3500000,
        campaignType: 'awareness',
        targetMarkets: ['United Kingdom', 'Ireland', 'France'],
        campaignDuration: 35,
        leadScore: 88,
        dealValue: 9500,
        firstContactDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        lastContactDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      },
      {
        artistName: 'Viral Sensation',
        email: encrypt('viral.sensation@example.com'),
        phone: encrypt('+33178912345'),
        platform: 'tiktok',
        source: 'simulator',
        status: 'won',
        priority: 'medium',
        quality: 'warm',
        assignedTo: marineUser._id,
        assignedTeam: 'marine',
        budget: 6000,
        budgetCurrency: 'EUR',
        genre: 'Pop',
        country: 'Spain',
        city: 'Madrid',
        monthlyListeners: 60000,
        totalStreams: 1800000,
        campaignType: 'viral',
        targetMarkets: ['Spain', 'France', 'Portugal'],
        campaignDuration: 28,
        leadScore: 75,
        dealValue: 6000,
        commission: 600,
        commissionRate: 10,
        wonDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        firstContactDate: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
        lastContactDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      }
    ]

    // Insérer les leads
    const allLeads = [...denisLeads, ...marineLeads]
    await Lead.insertMany(allLeads)

    console.log(`✅ ${allLeads.length} leads de démonstration créés`)
    console.log(`   🎵 Équipe Denis: ${denisLeads.length} leads`)
    console.log(`   🎵 Équipe Marine: ${marineLeads.length} leads`)

    return allLeads

  } catch (error) {
    console.error('❌ Erreur lors de la création des leads:', error.message)
    throw error
  }
}

async function createDemoCampaigns(leads) {
  console.log('🚀 Création des campagnes de démonstration...')

  try {
    // Trouver les leads gagnés pour créer des campagnes
    const wonLeads = leads.filter(lead => lead.status === 'won')

    if (wonLeads.length === 0) {
      console.log('⚠️ Aucun lead gagné trouvé, aucune campagne créée')
      return
    }

    const campaigns = wonLeads.map(lead => ({
      leadId: lead._id,
      platform: lead.platform,
      status: 'active',
      managedBy: lead.assignedTo,
      team: lead.assignedTeam,

      // Informations campagne
      name: `Campagne ${lead.artistName}`,
      description: `Campagne de promotion pour ${lead.artistName}`,

      // Dates
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),

      // Budget
      budget: lead.dealValue,
      currency: lead.budgetCurrency || 'EUR',

      // Objectifs
      objectives: lead.goals || {
        primary: 'Augmenter la notoriété',
        kpis: ['views', 'engagement']
      },

      // KPIs simulés
      kpis: {
        views: Math.floor(Math.random() * 100000) + 50000,
        clicks: Math.floor(Math.random() * 5000) + 2000,
        impressions: Math.floor(Math.random() * 500000) + 200000,
        engagement: Math.random() * 5 + 2,
        cpm: Math.random() * 10 + 5,
        cpc: Math.random() * 2 + 0.5,
        ctr: Math.random() * 3 + 1
      },

      // Progression
      progress: {
        completion: Math.floor(Math.random() * 80) + 20,
        milestones: [
          {
            name: 'Lancement',
            completed: true,
            completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
          },
          {
            name: 'Optimisation',
            completed: true,
            completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
          }
        ]
      }
    }))

    await Campaign.insertMany(campaigns)

    console.log(`✅ ${campaigns.length} campagnes de démonstration créées`)

    return campaigns

  } catch (error) {
    console.error('❌ Erreur lors de la création des campagnes:', error.message)
    throw error
  }
}

async function updateUserStats(users) {
  console.log('📊 Mise à jour des statistiques utilisateurs...')

  try {
    const { denisUser, marineUser, agentDenis, agentMarine } = users

    // Calculer les stats pour chaque utilisateur
    const updateStats = async (user) => {
      const userLeads = await Lead.find({ assignedTo: user._id })
      const wonLeads = userLeads.filter(lead => lead.status === 'won')
      const totalRevenue = wonLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0)

      await User.findByIdAndUpdate(user._id, {
        'stats.leadsCreated': userLeads.length,
        'stats.leadsConverted': wonLeads.length,
        'stats.totalRevenue': totalRevenue,
        'stats.campaignsManaged': wonLeads.length
      })
    }

    await Promise.all([
      updateStats(denisUser),
      updateStats(marineUser),
      updateStats(agentDenis),
      updateStats(agentMarine)
    ])

    console.log('✅ Statistiques utilisateurs mises à jour')

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour des stats:', error.message)
    throw error
  }
}

async function main() {
  console.log('🚀 Initialisation des données MDMC CRM')
  console.log('=====================================')

  try {
    // Connexion à la base de données
    await connectDatabase()

    // Création des utilisateurs par défaut
    const users = await createDefaultUsers()

    // Création des leads de démonstration
    const leads = await createDemoLeads(users)

    // Création des campagnes de démonstration
    await createDemoCampaigns(leads)

    // Mise à jour des statistiques utilisateurs
    await updateUserStats(users)

    console.log('')
    console.log('🎉 Initialisation terminée avec succès !')
    console.log('')
    console.log('📋 Comptes créés:')
    console.log('   Admin Denis:     denis@mdmc-music-ads.com      / AdminPassword123!')
    console.log('   Manager Marine:  marine@mdmc-music-ads.com     / ManagerPassword123!')
    console.log('   Agent Denis:     agent.denis@mdmc-music-ads.com / AgentPassword123!')
    console.log('   Agent Marine:    agent.marine@mdmc-music-ads.com / AgentPassword123!')
    console.log('')
    console.log('⚠️  IMPORTANT: Changez ces mots de passe en production !')
    console.log('')

  } catch (error) {
    console.error('💥 Erreur lors de l\'initialisation:', error.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('👋 Déconnexion de MongoDB')
  }
}

// Exécuter le script
main()