const mongoose = require('mongoose');
const Booking = require('../models/Booking');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  }

  // Double-booking protection lives in a unique index. If it could not be built
  // (old conflicting index, duplicate data, unsupported server) say so loudly.
  try {
    await Booking.init();
    const indexes = await Booking.collection.indexes();
    if (!indexes.some((i) => i.name === 'unique_active_slot')) {
      throw new Error('index "unique_active_slot" is missing');
    }
  } catch (err) {
    console.error(
      '\n*** WARNING: booking slot index is not active (' + err.message + ').\n' +
      '*** Two people could book the same slot at the same moment.\n' +
      '*** Fix: in mongosh run  db.bookings.dropIndexes()  and restart the server,\n' +
      '*** or drop the bookings collection if it only holds test data.\n'
    );
  }
};

module.exports = connectDB;
