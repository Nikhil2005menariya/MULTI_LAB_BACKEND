require('dotenv').config();

const app = require('./app');          // ✅ USE app.js
const connectDB = require('./config/db');
const { verifyMail } = require('./config/mail');
const startOverdueJob = require('./jobs/overdue.job');

const startServer = async () => {
  try {
    await connectDB();
    verifyMail();
    startOverdueJob();

    const PORT = process.env.PORT || 5050;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err);
  }
};

startServer();
