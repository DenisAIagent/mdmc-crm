// Script d'initialisation MongoDB pour MDMC CRM
// Ce script est exécuté automatiquement lors du premier démarrage de MongoDB

// Passer à la base de données MDMC CRM
db = db.getSiblingDB('mdmc_crm');

// Créer un utilisateur pour l'application
db.createUser({
  user: 'mdmc_app',
  pwd: 'mdmc_app_password_2025',
  roles: [
    {
      role: 'readWrite',
      db: 'mdmc_crm'
    }
  ]
});

// Créer les collections avec validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['firstName', 'lastName', 'email', 'password', 'role', 'team'],
      properties: {
        firstName: {
          bsonType: 'string',
          description: 'Le prénom est requis et doit être une chaîne'
        },
        lastName: {
          bsonType: 'string',
          description: 'Le nom est requis et doit être une chaîne'
        },
        email: {
          bsonType: 'string',
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
          description: 'Email valide requis'
        },
        role: {
          enum: ['admin', 'manager', 'agent'],
          description: 'Le rôle doit être admin, manager ou agent'
        },
        team: {
          enum: ['denis', 'marine'],
          description: 'L\'équipe doit être denis ou marine'
        }
      }
    }
  }
});

db.createCollection('leads', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['artistName', 'email', 'platform', 'source', 'assignedTo', 'assignedTeam'],
      properties: {
        artistName: {
          bsonType: 'string',
          description: 'Le nom de l\'artiste est requis'
        },
        platform: {
          enum: ['youtube', 'spotify', 'meta', 'tiktok', 'google', 'multiple'],
          description: 'Plateforme valide requise'
        },
        source: {
          enum: ['simulator', 'contact_form', 'calendly', 'manual', 'referral', 'social_media'],
          description: 'Source valide requise'
        },
        status: {
          enum: ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'on_hold'],
          description: 'Statut valide'
        },
        assignedTeam: {
          enum: ['denis', 'marine'],
          description: 'Équipe assignée requise'
        }
      }
    }
  }
});

db.createCollection('campaigns', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['leadId', 'platform', 'status', 'managedBy'],
      properties: {
        platform: {
          enum: ['youtube', 'spotify', 'meta', 'tiktok', 'google'],
          description: 'Plateforme valide requise'
        },
        status: {
          enum: ['planning', 'active', 'paused', 'completed', 'cancelled'],
          description: 'Statut de campagne valide'
        }
      }
    }
  }
});

db.createCollection('auditlogs');

// Créer les index pour optimiser les performances
print('Création des index...');

// Index pour les utilisateurs
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ team: 1 });
db.users.createIndex({ role: 1 });
db.users.createIndex({ isActive: 1 });

// Index pour les leads
db.leads.createIndex({ status: 1, assignedTo: 1 });
db.leads.createIndex({ platform: 1, createdAt: -1 });
db.leads.createIndex({ assignedTeam: 1, lastActivityDate: -1 });
db.leads.createIndex({ nextFollowUp: 1 });
db.leads.createIndex({ leadScore: -1 });
db.leads.createIndex({ artistName: 'text' });
db.leads.createIndex({ isArchived: 1 });
db.leads.createIndex({ email: 1 });

// Index composés pour les requêtes fréquentes
db.leads.createIndex({ assignedTo: 1, status: 1, createdAt: -1 });
db.leads.createIndex({ platform: 1, status: 1 });

// Index pour les campagnes
db.campaigns.createIndex({ leadId: 1, status: 1 });
db.campaigns.createIndex({ managedBy: 1, startDate: -1 });
db.campaigns.createIndex({ platform: 1, status: 1 });

// Index pour les logs d'audit
db.auditlogs.createIndex({ userId: 1, createdAt: -1 });
db.auditlogs.createIndex({ action: 1, createdAt: -1 });
db.auditlogs.createIndex({ entityType: 1, entityId: 1 });
// TTL index pour supprimer automatiquement les anciens logs (2 ans)
db.auditlogs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 63072000 });

// Insérer des données de test (utilisateurs par défaut)
print('Insertion des utilisateurs par défaut...');

// Mot de passe hashé pour "password123" (à changer en production)
const hashedPassword = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBOJcTJM8HJ/T2';

db.users.insertMany([
  {
    firstName: 'Denis',
    lastName: 'Admin',
    email: 'denis@mdmc-music-ads.com',
    password: hashedPassword,
    role: 'admin',
    team: 'denis',
    assignedPlatforms: ['youtube', 'spotify'],
    permissions: {
      leads: { create: true, read: true, update: true, delete: true },
      campaigns: { create: true, read: true, update: true, delete: true },
      analytics: { read: true, export: true },
      admin: { users: true, settings: true, audit: true }
    },
    isActive: true,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    firstName: 'Marine',
    lastName: 'Manager',
    email: 'marine@mdmc-music-ads.com',
    password: hashedPassword,
    role: 'manager',
    team: 'marine',
    assignedPlatforms: ['meta', 'tiktok'],
    permissions: {
      leads: { create: true, read: true, update: true, delete: true },
      campaigns: { create: true, read: true, update: true, delete: true },
      analytics: { read: true, export: true },
      admin: { users: false, settings: false, audit: false }
    },
    isActive: true,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

// Insérer quelques leads de démonstration
print('Insertion des données de démonstration...');

const denisUser = db.users.findOne({ email: 'denis@mdmc-music-ads.com' });
const marineUser = db.users.findOne({ email: 'marine@mdmc-music-ads.com' });

db.leads.insertMany([
  {
    artistName: 'Artist Demo 1',
    email: 'encrypted_email_1',
    phone: 'encrypted_phone_1',
    platform: 'youtube',
    source: 'simulator',
    status: 'new',
    priority: 'medium',
    quality: 'warm',
    assignedTo: denisUser._id,
    assignedTeam: 'denis',
    budget: 5000,
    genre: 'Pop',
    monthlyListeners: 50000,
    leadScore: 75,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityDate: new Date()
  },
  {
    artistName: 'Artist Demo 2',
    email: 'encrypted_email_2',
    phone: 'encrypted_phone_2',
    platform: 'meta',
    source: 'contact_form',
    status: 'contacted',
    priority: 'high',
    quality: 'hot',
    assignedTo: marineUser._id,
    assignedTeam: 'marine',
    budget: 8000,
    genre: 'Hip-Hop',
    monthlyListeners: 120000,
    leadScore: 85,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityDate: new Date()
  }
]);

print('Initialisation de la base de données terminée avec succès !');
print('Utilisateurs créés:');
print('- denis@mdmc-music-ads.com (admin)');
print('- marine@mdmc-music-ads.com (manager)');
print('Mot de passe par défaut: password123 (à changer en production)');