const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  try {
    await mongoose.connect(uri, {
      autoIndex: true
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    if (error.message.includes('authentication failed')) {
      console.error('\n⚠️  Authentication failed. Check:');
      console.error('  1. Username and password in MONGODB_URI are correct');
      console.error('  2. Database user exists in MongoDB Atlas');
      console.error('  3. Your IP address is whitelisted in MongoDB Atlas Network Access');
      console.error('  4. Database name in URI is correct (currently: ai-chatbot)');
    }
    throw error;
  }
};

module.exports = connectDB;