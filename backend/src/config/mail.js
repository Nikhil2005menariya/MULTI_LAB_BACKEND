const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false, // true only for port 465
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// Optional: verify connection on startup
const verifyMail = async () => {
  try {
    await transporter.verify();
    console.log('Mail server connected');
  } catch (err) {
    console.error('Mail server connection failed', err.message);
  }
};

module.exports = {
  transporter,
  verifyMail
};
