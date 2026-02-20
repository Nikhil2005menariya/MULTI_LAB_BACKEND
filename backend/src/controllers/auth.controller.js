const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const Student = require('../models/Student');

/* ======================
   ADMIN LOGIN
====================== */

exports.adminLogin = async (req, res) => {
  const { email, password } = req.body;

  const admin = await Staff.findOne({ email, role: 'admin' }).select('+password');

  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: admin._id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  admin.last_login = new Date();
  await admin.save();

  res.json({ token });
};


/* ======================
   STAFF LOGIN (ADMIN + INCHARGE)
====================== */

exports.staffLogin = async (req, res) => {
  const { email, password } = req.body;

  const staff = await Staff.findOne({
    email,
    role: { $in: ['admin', 'incharge'] }
  }).select('+password');

  if (!staff || !(await bcrypt.compare(password, staff.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: staff._id, role: staff.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  staff.last_login = new Date();
  await staff.save();

  res.json({ token });
};


/* ======================
   STUDENT LOGIN
====================== */

exports.studentLogin = async (req, res) => {
  const { reg_no, password } = req.body;

  const student = await Student.findOne({ reg_no }).select('+password');
  if (!student) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!student.is_verified) {
  return res.status(403).json({ error: 'Email not verified' });
  }


  const isMatch = await require('bcryptjs').compare(password, student.password);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = require('jsonwebtoken').sign(
    { id: student._id, role: 'student' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  res.json({ token });
};

// student account creation


exports.registerStudent = async (req, res) => {
  try {
    const { name, reg_no, email, password } = req.body;

    const exists = await Student.findOne({
      $or: [{ reg_no }, { email }]
    });

    if (exists) {
      return res.status(400).json({ error: 'Student already exists' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const student = await Student.create({
      name,
      reg_no,
      email,
      password: await bcrypt.hash(password, 10),
      email_verification_token: verificationToken
    });

    const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    await sendMail({
      to: email,
      subject: 'Verify your IoT Lab Account',
      html: `
        <p>Click the link below to verify your account:</p>
        <a href="${verifyLink}">Verify Email</a>
      `
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Verify email to login.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.verifyStudentEmail = async (req, res) => {
  try {
    const { token } = req.query;

    const student = await Student.findOne({
      email_verification_token: token
    }).select('+email_verification_token');

    if (!student) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    student.is_verified = true;
    student.email_verification_token = undefined;

    await student.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.studentForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const student = await Student.findOne({ email });
    if (!student) {
      // security: don't reveal existence
      return res.json({ success: true });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    student.reset_otp = otp;
    student.reset_otp_expiry = Date.now() + 15 * 60 * 1000; // 15 min
    await student.save();

    const resetLink =
      `${process.env.FRONTEND_URL}/student/reset-password?token=${otp}`;

    await sendMail({
      to: student.email,
      subject: 'Student Password Reset',
      html: `
        <p>You requested a password reset.</p>
        <p>click the link below:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This OTP expires in 15 minutes.</p>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Student forgot password error:', err);
    res.status(500).json({ message: 'Failed to send reset email' });
  }
};


exports.studentResetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const student = await Student.findOne({
      reset_otp: token,
      reset_otp_expiry: { $gt: Date.now() }
    }).select('+reset_otp +reset_otp_expiry');

    if (!student) {
      return res.status(400).json({
        message: 'Invalid or expired reset link'
      });
    }

    student.password = await bcrypt.hash(password, 10);
    student.reset_otp = null;
    student.reset_otp_expiry = null;

    await student.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Student reset password error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};



/* ============================
   ADMIN PROFILE – CHANGE PASSWORD
============================ */
exports.changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const admin = await Staff.findById(req.user.id).select('+password');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Change admin password error:', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
};

/* ============================
   ADMIN PROFILE – REQUEST EMAIL OTP
============================ */
exports.requestAdminEmailOTP = async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail) {
      return res.status(400).json({ message: 'New email is required' });
    }

    const admin = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const emailExists = await Staff.findOne({ email: newEmail });
    if (emailExists) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    admin.pending_email = newEmail;
    admin.email_otp = otp;
    admin.email_otp_expiry = Date.now() + 10 * 60 * 1000; // 10 mins
    await admin.save();

    await sendMail({
      to: newEmail,
      subject: 'Admin Email Change Verification',
      html: `
        <p>Your OTP to change admin email is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Request admin email OTP error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};

/* ============================
   ADMIN PROFILE – UPDATE EMAIL
============================ */
exports.updateAdminEmail = async (req, res) => {
  try {
    const { newEmail, otp } = req.body;

    if (!newEmail || !otp) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const admin = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (
      admin.pending_email !== newEmail ||
      admin.email_otp !== otp ||
      Date.now() > admin.email_otp_expiry
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    admin.email = newEmail;
    admin.pending_email = null;
    admin.email_otp = null;
    admin.email_otp_expiry = null;

    await admin.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Update admin email error:', err);
    res.status(500).json({ message: 'Failed to update email' });
  }
};



exports.changeInchargePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    // ✅ MUST SELECT password
    const incharge = await Staff.findById(req.user.id).select('+password');

    if (!incharge || incharge.role !== 'incharge') {
      return res.status(404).json({ message: 'Incharge not found' });
    }

    const isMatch = await bcrypt.compare(
      current_password,
      incharge.password
    );

    if (!isMatch) {
      return res.status(400).json({
        message: 'Current password is incorrect',
      });
    }

    incharge.password = await bcrypt.hash(new_password, 10);
    await incharge.save();

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (err) {
    console.error('Incharge change password error:', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
};



exports.requestInchargeEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const incharge = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!incharge || incharge.role !== 'incharge') {
      return res.status(404).json({ message: 'Incharge not found' });
    }

    const emailExists = await Staff.findOne({ email });
    if (emailExists) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    incharge.pending_email = email;
    incharge.email_otp = otp;
    incharge.email_otp_expiry = Date.now() + 10 * 60 * 1000;

    await incharge.save();

    await sendMail({
      to: email,
      subject: 'Email Change Verification',
      html: `
        <p>Your OTP is:</p>
        <h2>${otp}</h2>
        <p>Valid for 10 minutes.</p>
      `,
    });

    res.json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (err) {
    console.error('Incharge request OTP error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};



exports.updateInchargeEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const incharge = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!incharge || incharge.role !== 'incharge') {
      return res.status(404).json({ message: 'Incharge not found' });
    }

    if (
      incharge.pending_email !== email ||
      incharge.email_otp !== otp ||
      Date.now() > incharge.email_otp_expiry
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    incharge.email = email;
    incharge.pending_email = null;
    incharge.email_otp = null;
    incharge.email_otp_expiry = null;

    await incharge.save();

    res.json({
      success: true,
      message: 'Email updated successfully',
    });
  } catch (err) {
    console.error('Incharge update email error:', err);
    res.status(500).json({ message: 'Failed to update email' });
  }
};

