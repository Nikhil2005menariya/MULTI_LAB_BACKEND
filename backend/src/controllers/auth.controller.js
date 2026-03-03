const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');

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

    await sendMail({
      to: student.email,
      subject: 'Student Password Reset OTP',
      html: `
        <p>Hello ${student.name},</p>
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
   REGISTER FACULTY (SEND VERIFICATION EMAIL)
===================================================== */
exports.registerFaculty = async (req, res) => {
  try {
    const { name, email, faculty_id } = req.body;

    if (!name || !email || !faculty_id) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Optional domain restriction
    // if (!email.endsWith('@vit.ac.in')) {
    //   return res.status(400).json({
    //     message: 'Only official VIT email is allowed'
    //   });
    // }

    const existing = await Faculty.findOne({ email });

    if (existing) {
      return res.status(400).json({
        message: 'Faculty account already exists'
      });
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

    const verificationLink =
      `${process.env.FRONTEND_URL}/faculty/verify?token=${verificationToken}`;

    await sendMail({
      to: email,
      subject: 'Verify Your Faculty Account',
      html: `
        <p>Hello ${name},</p>
        <p>Please verify your faculty account by clicking the link below:</p>
        <a href="${verificationLink}">Verify Account</a>
      `
    });

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
   SET PASSWORD (AFTER VERIFICATION)
===================================================== */
exports.setPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
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

    const hashed = await bcrypt.hash(password, 10);

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

    const token = require('jsonwebtoken').sign(
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
   FACULTY FORGOT PASSWORD – SEND OTP
===================================================== */
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

    await sendMail({
      to: faculty.email,
      subject: 'Faculty Password Reset OTP',
      html: `
        <p>Hello ${faculty.name},</p>
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

    const faculty = await Faculty.findOne({ email }).select(
      '+reset_otp +reset_otp_expiry +password'
    );

    if (!faculty) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    if (
      faculty.reset_otp !== otp ||
      Date.now() > faculty.reset_otp_expiry
    ) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    faculty.password = await bcrypt.hash(newPassword, 10);
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

    await sendMail({
      to: staff.email,
      subject: 'Password Reset OTP',
      html: `
        <p>Hello ${staff.name},</p>
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
exports.staffChangePassword = async (req, res) => {
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
exports.staffRequestEmailChangeOTP = async (req, res) => {
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
exports.staffConfirmEmailChange = async (req, res) => {
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







