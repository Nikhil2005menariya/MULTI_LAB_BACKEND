const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');

/* =====================================================
   SECURITY: Validation & Sanitization Helpers
===================================================== */
const BCRYPT_ROUNDS = 12;
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NAME_REGEX = /^[a-zA-Z\s.'-]{2,100}$/;
const HEX_TOKEN_REGEX = /^[a-fA-F0-9]{64}$/;
const OTP_REGEX = /^[0-9]{6}$/;
const REG_NO_REGEX = /^[a-zA-Z0-9]{3,20}$/;
const FACULTY_ID_REGEX = /^[a-zA-Z0-9-]{2,50}$/;

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return EMAIL_REGEX.test(email);
};

const isValidName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return NAME_REGEX.test(name);
};

const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) return false;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUpperCase && hasLowerCase && hasNumber;
};

const isValidHexToken = (token) => {
  if (!token || typeof token !== 'string') return false;
  return HEX_TOKEN_REGEX.test(token);
};

const isValidOTP = (otp) => {
  if (!otp || typeof otp !== 'string') return false;
  return OTP_REGEX.test(otp);
};

const isValidRegNo = (regNo) => {
  if (!regNo || typeof regNo !== 'string') return false;
  return REG_NO_REGEX.test(regNo);
};

const isValidFacultyId = (facultyId) => {
  if (!facultyId || typeof facultyId !== 'string') return false;
  return FACULTY_ID_REGEX.test(facultyId);
};

const escapeHtml = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const timingSafeEqual = (a, b) => {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/* ======================
   STUDENT LOGIN
====================== */

exports.studentLogin = async (req, res) => {
  try {
    const { reg_no, password } = req.body;

    if (!reg_no || !password) {
      return res.status(400).json({ error: 'Registration number and password are required' });
    }

    if (!isValidRegNo(reg_no)) {
      return res.status(400).json({ error: 'Invalid registration number format' });
    }

    if (typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ error: 'Invalid password format' });
    }

    const student = await Student.findOne({ reg_no }).select('+password');
    if (!student) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!student.is_verified) {
      return res.status(403).json({ error: 'Email not verified' });
    }

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: student._id, role: 'student' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({ token });
  } catch (err) {
    console.error('Student login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};

// student account creation


exports.registerStudent = async (req, res) => {
  try {
    const { name, reg_no, email, password } = req.body;

    if (!name || !reg_no || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!isValidName(name)) {
      return res.status(400).json({
        error: 'Invalid name format. Use only letters, spaces, dots, hyphens, and apostrophes (2-100 characters)'
      });
    }

    if (!isValidRegNo(reg_no)) {
      return res.status(400).json({ error: 'Invalid registration number format' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const exists = await Student.findOne({
      $or: [{ reg_no }, { email }]
    });

    if (exists && exists.is_verified) {
      return res.status(400).json({ error: 'Student already exists' });
    }

    // If unverified account exists, delete it to allow re-registration
    if (exists && !exists.is_verified) {
      await Student.deleteOne({ _id: exists._id });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const student = await Student.create({
      name,
      reg_no,
      email,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      email_verification_token: verificationToken
    });

    const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    const escapedName = escapeHtml(name);

    try {
      await sendMail({
        to: email,
        subject: 'Verify your IoT Lab Account',
        html: `
          <p>Hello ${escapedName},</p>
          <p>Click the link below to verify your account:</p>
          <a href="${verifyLink}">Verify Email</a>
        `
      });
    } catch (emailErr) {
      // If email fails, delete the created student account
      await Student.deleteOne({ _id: student._id });
      console.error('Student registration - email send failed:', emailErr);
      return res.status(500).json({
        error: 'Failed to send verification email. Please try again later.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful. Verify email to login.'
    });
  } catch (err) {
    console.error('Student registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
};


exports.verifyStudentEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!isValidHexToken(token)) {
      return res.status(400).json({ error: 'Invalid verification token format' });
    }

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
    console.error('Student email verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
};

/* =====================================================
   RESEND STUDENT VERIFICATION EMAIL
===================================================== */
exports.resendStudentVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const student = await Student.findOne({ email }).select('+email_verification_token');

    if (!student) {
      return res.status(404).json({ error: 'Student account not found' });
    }

    if (student.is_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    student.email_verification_token = verificationToken;
    await student.save();

    const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    const escapedName = escapeHtml(student.name);

    try {
      await sendMail({
        to: email,
        subject: 'Verify your IoT Lab Account',
        html: `
          <p>Hello ${escapedName},</p>
          <p>Click the link below to verify your account:</p>
          <a href="${verifyLink}">Verify Email</a>
        `
      });
    } catch (emailErr) {
      console.error('Resend verification email failed:', emailErr);
      return res.status(500).json({
        error: 'Failed to send verification email. Please try again later.'
      });
    }

    res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (err) {
    console.error('Resend verification email error:', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
};


/* =====================================================
   STUDENT FORGOT PASSWORD – STRICT CHECK
===================================================== */
exports.studentForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    const student = await Student.findOne({ email });

    if (!student) {
      return res.status(404).json({
        error: 'Student account not found'
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    student.reset_otp = otp;
    student.reset_otp_expiry = Date.now() + 15 * 60 * 1000;

    await student.save();

    const escapedName = escapeHtml(student.name);

    await sendMail({
      to: student.email,
      subject: 'Student Password Reset OTP',
      html: `
        <p>Hello ${escapedName},</p>
        <p>Your password reset OTP is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 15 minutes.</p>
      `
    });

    return res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (err) {
    console.error('Student forgot password error:', err);
    return res.status(500).json({
      error: 'Failed to send reset OTP'
    });
  }
};


exports.studentResetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    if (!isValidOTP(token)) {
      return res.status(400).json({ message: 'Invalid OTP format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const student = await Student.findOne({
      reset_otp_expiry: { $gt: Date.now() }
    }).select('+reset_otp +reset_otp_expiry');

    if (!student || !timingSafeEqual(student.reset_otp, token)) {
      return res.status(400).json({
        message: 'Invalid or expired reset link'
      });
    }

    student.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
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

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ error: 'Invalid password format' });
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
   REGISTER FACULTY (SEND VERIFICATION EMAIL)
===================================================== */
exports.registerFaculty = async (req, res) => {
  try {
    const { name, email, faculty_id } = req.body;

    if (!name || !email || !faculty_id) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!isValidName(name)) {
      return res.status(400).json({
        message: 'Invalid name format. Use only letters, spaces, dots, hyphens, and apostrophes (2-100 characters)'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidFacultyId(faculty_id)) {
      return res.status(400).json({ message: 'Invalid faculty ID format' });
    }

    const existing = await Faculty.findOne({ email });

    if (existing && existing.is_verified) {
      return res.status(400).json({
        message: 'Faculty account already exists'
      });
    }

    // If unverified account exists, delete it to allow re-registration
    if (existing && !existing.is_verified) {
      await Faculty.deleteOne({ _id: existing._id });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const faculty = await Faculty.create({
      name,
      email,
      faculty_id,
      verification_token: verificationToken,
      verification_token_expiry: Date.now() + 1000 * 60 * 60, // 1 hour
      is_verified: false
    });

    const verificationLink = `${process.env.FRONTEND_URL}/faculty/verify-email?token=${verificationToken}`;

    const escapedName = escapeHtml(name);

    try {
      await sendMail({
        to: email,
        subject: 'Verify Your Faculty Account',
        html: `
          <p>Hello ${escapedName},</p>
          <p>Please verify your faculty account by clicking the link below:</p>
          <a href="${verificationLink}">Verify Account</a>
        `
      });
    } catch (emailErr) {
      // If email fails, delete the created faculty account
      await Faculty.deleteOne({ _id: faculty._id });
      console.error('Faculty registration - email send failed:', emailErr);
      return res.status(500).json({
        message: 'Failed to send verification email. Please try again later.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Verification email sent'
    });

  } catch (err) {
    console.error('Faculty register error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
};


/* =====================================================
   VERIFY EMAIL
===================================================== */
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Verification token missing' });
    }

    if (!isValidHexToken(token)) {
      return res.status(400).json({ message: 'Invalid token format' });
    }

    const faculty = await Faculty.findOne({
      verification_token: token,
      verification_token_expiry: { $gt: Date.now() }
    });

    if (!faculty) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    faculty.is_verified = true;
    faculty.verification_token = undefined;
    faculty.verification_token_expiry = undefined;

    await faculty.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ message: 'Verification failed' });
  }
};

/* =====================================================
   RESEND FACULTY VERIFICATION EMAIL
===================================================== */
exports.resendFacultyVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const faculty = await Faculty.findOne({ email }).select('+verification_token +verification_token_expiry');

    if (!faculty) {
      return res.status(404).json({ message: 'Faculty account not found' });
    }

    if (faculty.is_verified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new verification token with 1 hour expiry
    const verificationToken = crypto.randomBytes(32).toString('hex');
    faculty.verification_token = verificationToken;
    faculty.verification_token_expiry = Date.now() + 1000 * 60 * 60;
    await faculty.save();

    const verificationLink = `${process.env.FRONTEND_URL}/faculty/verify-email?token=${verificationToken}`;
    const escapedName = escapeHtml(faculty.name);

    try {
      await sendMail({
        to: email,
        subject: 'Verify Your Faculty Account',
        html: `
          <p>Hello ${escapedName},</p>
          <p>Please verify your faculty account by clicking the link below:</p>
          <a href="${verificationLink}">Verify Account</a>
        `
      });
    } catch (emailErr) {
      console.error('Resend faculty verification email failed:', emailErr);
      return res.status(500).json({
        message: 'Failed to send verification email. Please try again later.'
      });
    }

    res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (err) {
    console.error('Resend faculty verification email error:', err);
    res.status(500).json({ message: 'Failed to resend verification email' });
  }
};



/* =====================================================
   SET PASSWORD (AFTER VERIFICATION)
===================================================== */
exports.setPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const faculty = await Faculty.findOne({ email });

    if (!faculty || !faculty.is_verified) {
      return res.status(400).json({
        message: 'Email not verified'
      });
    }

    if (faculty.password) {
      return res.status(400).json({
        message: 'Password already set'
      });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    faculty.password = hashed;
    await faculty.save();

    res.json({
      success: true,
      message: 'Password set successfully'
    });

  } catch (err) {
    console.error('Set password error:', err);
    res.status(500).json({ message: 'Failed to set password' });
  }
};



/* =====================================================
   LOGIN FACULTY
===================================================== */
exports.loginFaculty = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ message: 'Invalid password format' });
    }

    const faculty = await Faculty.findOne({ email }).select('+password');

    if (!faculty || !faculty.is_verified) {
      return res.status(400).json({
        message: 'Invalid credentials or not verified'
      });
    }

    const isMatch = await bcrypt.compare(password, faculty.password);

    if (!isMatch) {
      return res.status(400).json({
        message: 'Invalid credentials'
      });
    }

    faculty.last_login = new Date();
    await faculty.save();

    const token = jwt.sign(
      {
        id: faculty._id,
        role: 'faculty'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: faculty._id,
        name: faculty.name,
        email: faculty.email,
        faculty_id: faculty.faculty_id
      }
    });

  } catch (err) {
    console.error('Faculty login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
};


/* =====================================================
   FACULTY FORGOT PASSWORD – STRICT CHECK
===================================================== */
exports.facultyForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    const faculty = await Faculty.findOne({ email });

    if (!faculty) {
      return res.status(404).json({
        error: 'Faculty account not found'
      });
    }

    if (!faculty.is_verified) {
      return res.status(403).json({
        error: 'Faculty email not verified'
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    faculty.reset_otp = otp;
    faculty.reset_otp_expiry = Date.now() + 10 * 60 * 1000;

    await faculty.save();

    const escapedName = escapeHtml(faculty.name);

    await sendMail({
      to: faculty.email,
      subject: 'Faculty Password Reset OTP',
      html: `
        <p>Hello ${escapedName},</p>
        <p>Your password reset OTP is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    return res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (err) {
    console.error('Faculty forgot password error:', err);
    return res.status(500).json({
      error: 'Failed to send reset OTP'
    });
  }
};

/* =====================================================
   FACULTY RESET PASSWORD
===================================================== */
exports.facultyResetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: 'Missing required fields'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidOTP(otp)) {
      return res.status(400).json({ message: 'Invalid OTP format' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const faculty = await Faculty.findOne({ email }).select(
      '+reset_otp +reset_otp_expiry +password'
    );

    if (!faculty) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    if (
      !timingSafeEqual(faculty.reset_otp, otp) ||
      Date.now() > faculty.reset_otp_expiry
    ) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    faculty.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    faculty.reset_otp = undefined;
    faculty.reset_otp_expiry = undefined;

    await faculty.save();

    return res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (err) {
    console.error('Faculty reset password error:', err);
    return res.status(500).json({
      message: 'Failed to reset password'
    });
  }
};


/* =====================================================
   FORGOT PASSWORD – SEND OTP
===================================================== */
/* =====================================================
   STAFF FORGOT PASSWORD – STRICT CHECK
===================================================== */
exports.staffForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    const staff = await Staff.findOne({ email });

    if (!staff) {
      return res.status(404).json({
        error: 'Staff account not found'
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    staff.reset_otp = otp;
    staff.reset_otp_expiry = Date.now() + 10 * 60 * 1000;

    await staff.save();

    const escapedName = escapeHtml(staff.name);

    await sendMail({
      to: staff.email,
      subject: 'Password Reset OTP',
      html: `
        <p>Hello ${escapedName},</p>
        <p>Your password reset OTP is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `
    });

    return res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (err) {
    console.error('Staff forgot password error:', err);
    return res.status(500).json({
      error: 'Failed to send OTP'
    });
  }
};


/* =====================================================
   RESET PASSWORD USING OTP
===================================================== */
exports.staffResetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isValidOTP(otp)) {
      return res.status(400).json({ error: 'Invalid OTP format' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        error: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const staff = await Staff.findOne({ email }).select(
      '+reset_otp +reset_otp_expiry'
    );

    if (!staff) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (
      !timingSafeEqual(staff.reset_otp, otp) ||
      Date.now() > staff.reset_otp_expiry
    ) {
      return res.status(400).json({
        error: 'Invalid or expired OTP'
      });
    }

    staff.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
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
exports.staffChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password are required' });
    }

    if (typeof currentPassword !== 'string' || currentPassword.length > 128) {
      return res.status(400).json({ error: 'Invalid current password format' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        error: 'New password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

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

    staff.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
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
exports.staffRequestEmailChangeOTP = async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail) {
      return res.status(400).json({
        error: 'New email is required'
      });
    }

    if (!isValidEmail(newEmail)) {
      return res.status(400).json({
        error: 'Invalid email format'
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
exports.staffConfirmEmailChange = async (req, res) => {
  try {
    const { newEmail, otp } = req.body;

    if (!newEmail || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    if (!isValidEmail(newEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isValidOTP(otp)) {
      return res.status(400).json({ error: 'Invalid OTP format' });
    }

    const staff = await Staff.findById(req.user.id).select(
      '+email_otp +email_otp_expiry +pending_email'
    );

    if (!staff) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (
      staff.pending_email !== newEmail ||
      !timingSafeEqual(staff.email_otp, otp) ||
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







