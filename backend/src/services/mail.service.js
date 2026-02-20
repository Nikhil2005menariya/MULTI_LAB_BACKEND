const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

exports.sendMail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"IoT Lab" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html
  });
};
