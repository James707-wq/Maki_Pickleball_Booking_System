/**
 * One-time helper to populate the courts collection with sample data,
 * since court creation (AF-108 Admin Court Management) hasn't been built yet.
 * Run with: node scripts/seedCourts.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Court = require('../models/Court');
const Settings = require('../models/Settings');

const sampleCourts = [
  {
    name: 'Court 1',
    courtNumber: 'C1',
    location: 'Main Building, Ground Floor',
    description: 'Indoor court with cushioned flooring, great for beginners.',
    facilities: ['Indoor', 'Lighting', 'Restroom', 'Parking'],
    pricePerHour: 250,
    status: 'available',
    openTime: '06:00',
    closeTime: '22:00',
  },
  {
    name: 'Court 2',
    courtNumber: 'C2',
    location: 'Main Building, Ground Floor',
    description: 'Indoor court next to Court 1, tournament-grade net.',
    facilities: ['Indoor', 'Lighting', 'Restroom', 'Parking', 'Scoreboard'],
    pricePerHour: 250,
    status: 'available',
    openTime: '06:00',
    closeTime: '22:00',
  },
  {
    name: 'Court 3 (Outdoor)',
    courtNumber: 'C3',
    location: 'Back Lot',
    description: 'Open-air court, weather permitting.',
    facilities: ['Outdoor', 'Parking'],
    pricePerHour: 180,
    status: 'available',
    openTime: '06:00',
    closeTime: '19:00',
  },
  {
    name: 'Court 4',
    courtNumber: 'C4',
    location: 'Main Building, Second Floor',
    description: 'Currently closed for resurfacing.',
    facilities: ['Indoor', 'Lighting'],
    pricePerHour: 250,
    status: 'maintenance',
    openTime: '06:00',
    closeTime: '22:00',
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    await Court.deleteMany({}); // clear old sample data before reseeding
    const created = await Court.insertMany(sampleCourts);
    console.log(`Seeded ${created.length} courts`);
    await Settings.get(); // make sure facility settings exist

    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
})();
