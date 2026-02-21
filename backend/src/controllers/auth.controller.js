const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const Student = require('../models/Student');

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

/* =====================================================
   STAFF LOGIN (SUPER_ADMIN / INCHARGE / ASSISTANT)
===================================================== */
exports.staffLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const staff = await Staff.findOne({
      email,
      is_active: true
    }).select('+password');

    if (!staff) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, staff.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: staff._id,
        role: staff.role,
        lab_id: staff.lab_id || null
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    staff.last_login = new Date();
    await staff.save();

    return res.json({
      success: true,
      token,
      user: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        lab_id: staff.lab_id
      }
    });

  } catch (err) {
    console.error('Staff login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};


/* =====================================================
   FORGOT PASSWORD – SEND OTP
===================================================== */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const staff = await Staff.findOne({ email });

    if (!staff) {
      return res.status(404).json({
        error: 'Account not found'
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    staff.reset_otp = otp;
    staff.reset_otp_expiry = Date.now() + 10 * 60 * 1000; // 10 mins
    await staff.save();

    await sendMail({
      to: email,
      subject: 'Password Reset OTP',
      html: `
        <p>Your password reset OTP is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    return res.json({
      success: true,
      message: 'OTP sent to registered email'
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
};


/* =====================================================
   RESET PASSWORD USING OTP
===================================================== */
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    const staff = await Staff.findOne({ email }).select(
      '+reset_otp +reset_otp_expiry'
    );

    if (!staff) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (
      staff.reset_otp !== otp ||
      Date.now() > staff.reset_otp_expiry
    ) {
      return res.status(400).json({
        error: 'Invalid or expired OTP'
      });
    }

    staff.password = await bcrypt.hash(newPassword, 10);
    staff.reset_otp = undefined;
    staff.reset_otp_expiry = undefined;

    await staff.save();

    return res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
};


/* =====================================================
   CHANGE PASSWORD (LOGGED IN)
===================================================== */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const staff = await Staff.findById(req.user.id).select('+password');

    if (!staff) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, staff.password);

    if (!isMatch) {
      return res.status(400).json({
        error: 'Current password is incorrect'
      });
    }

    staff.password = await bcrypt.hash(newPassword, 10);
    await staff.save();

    return res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
};


/* =====================================================
   REQUEST EMAIL CHANGE – SEND OTP
===================================================== */
exports.requestEmailChangeOTP = async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail) {
      return res.status(400).json({
        error: 'New email is required'
      });
    }

    const existing = await Staff.findOne({ email: newEmail });
    if (existing) {
      return res.status(400).json({
        error: 'Email already in use'
      });
    }

    const staff = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!staff) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    staff.pending_email = newEmail;
    staff.email_otp = otp;
    staff.email_otp_expiry = Date.now() + 10 * 60 * 1000; // 10 mins
    await staff.save();

    await sendMail({
      to: newEmail,
      subject: 'Email Change Verification OTP',
      html: `
        <p>Your OTP to change email is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    return res.json({
      success: true,
      message: 'OTP sent to new email'
    });

  } catch (err) {
    console.error('Request email change error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
};


/* =====================================================
   CONFIRM EMAIL CHANGE
===================================================== */
exports.confirmEmailChange = async (req, res) => {
  try {
    const { newEmail, otp } = req.body;

    const staff = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!staff) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (
      staff.pending_email !== newEmail ||
      staff.email_otp !== otp ||
      Date.now() > staff.email_otp_expiry
    ) {
      return res.status(400).json({
        error: 'Invalid or expired OTP'
      });
    }

    staff.email = newEmail;
    staff.pending_email = undefined;
    staff.email_otp = undefined;
    staff.email_otp_expiry = undefined;

    await staff.save();

    return res.json({
      success: true,
      message: 'Email updated successfully'
    });

  } catch (err) {
    console.error('Confirm email change error:', err);
    return res.status(500).json({ error: 'Failed to update email' });
  }
};







