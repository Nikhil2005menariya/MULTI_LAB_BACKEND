const Transaction = require('../models/Transaction');
const Faculty = require('../models/Faculty');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../services/mail.service');
const mongoose = require('mongoose');

/* =====================================================
   ================= VALIDATION HELPERS ================
===================================================== */

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NAME_REGEX = /^[a-zA-Z\s.'-]{2,100}$/;
const FACULTY_ID_REGEX = /^[a-zA-Z0-9_-]{2,50}$/;
const HEX_TOKEN_REGEX = /^[a-fA-F0-9]{64}$/;
const OTP_REGEX = /^[0-9]{6}$/;
const PASSWORD_MIN_LENGTH = 8;

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim()) && email.length <= 254;
};

const isValidName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return NAME_REGEX.test(name.trim());
};

const isValidFacultyId = (facultyId) => {
  if (!facultyId || typeof facultyId !== 'string') return false;
  return FACULTY_ID_REGEX.test(facultyId.trim());
};

const isValidHexToken = (token) => {
  if (!token || typeof token !== 'string') return false;
  return HEX_TOKEN_REGEX.test(token);
};

const isValidOtp = (otp) => {
  if (!otp || typeof otp !== 'string') return false;
  return OTP_REGEX.test(otp);
};

const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) return false;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUpperCase && hasLowerCase && hasNumber;
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

const sanitizeString = (str, maxLength = 500) => {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
};

const timingSafeEqual = (a, b) => {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
/* =====================================================
   ================= EMAIL TOKEN FLOW ==================
===================================================== */

/* ============================
   APPROVE VIA EMAIL TOKEN
============================ */
exports.approveTransaction = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || !isValidHexToken(token)) {
      return res.status(400).json({ error: 'Invalid approval token format' });
    }

    const transaction = await Transaction.findOne({
      'faculty_approval.approval_token': token,
      status: 'raised'
    });

    if (!transaction) {
      return res.status(400).json({ error: 'Invalid or expired approval token' });
    }

    transaction.status = 'approved';
    transaction.faculty_approval.approved = true;
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction approved successfully'
    });

  } catch (err) {
    console.error('Approve transaction error:', err);
    res.status(500).json({ error: 'Failed to approve transaction' });
  }
};


/* ============================
   GET APPROVAL DETAILS (TOKEN)
============================ */
exports.getApprovalDetails = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || !isValidHexToken(token)) {
      return res.status(400).json({ error: 'Invalid approval token format' });
    }

    const transaction = await Transaction.findOne({
      'faculty_approval.approval_token': token,
      status: 'raised'
    })
      .select('+project_name')
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .lean();

    if (!transaction) {
      return res.status(400).json({ error: 'Invalid or expired approval token' });
    }

    res.json({
      success: true,
      data: transaction
    });

  } catch (err) {
    console.error('Get approval details error:', err);
    res.status(500).json({ error: 'Failed to fetch approval details' });
  }
};

/* ============================
   REJECT VIA EMAIL TOKEN
============================ */
exports.rejectTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { token, reason } = req.body;

    if (!token || !isValidHexToken(token)) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Invalid approval token format' });
    }

    // Sanitize reason to prevent XSS
    const sanitizedReason = sanitizeString(reason, 500);

    const transaction = await Transaction.findOne({
      'faculty_approval.approval_token': token,
      status: 'raised'
    }).session(session);

    if (!transaction) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'Invalid or expired approval token'
      });
    }

    /* ======================================
       RELEASE TEMP RESERVED STOCK
    ====================================== */

    const LabInventory = require('../models/LabInventory');

    for (const item of transaction.items) {

      const inventory = await LabInventory.findOne({
        lab_id: item.lab_id,
        item_id: item.item_id
      }).session(session);

      if (!inventory) continue;

      const reservedQty =
        item.quantity ||
        item.asset_ids?.length ||
        0;

      inventory.temp_reserved_quantity =
        Math.max(
          0,
          inventory.temp_reserved_quantity - reservedQty
        );

      await inventory.save({ session });
    }

    /* ======================================
       UPDATE TRANSACTION
    ====================================== */

    transaction.status = 'rejected';
    transaction.faculty_approval.approved = false;
    transaction.faculty_approval.rejected_reason = sanitizedReason;
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: 'Transaction rejected successfully and stock released'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('REJECT TRANSACTION ERROR:', err);

    return res.status(500).json({
      error: 'Failed to reject transaction'
    });
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

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate name (letters, spaces, dots, hyphens, apostrophes only)
    if (!isValidName(name)) {
      return res.status(400).json({
        message: 'Invalid name format. Use only letters, spaces, dots, hyphens, and apostrophes (2-100 characters)'
      });
    }

    // Validate faculty_id (alphanumeric with underscores and hyphens)
    if (!isValidFacultyId(faculty_id)) {
      return res.status(400).json({
        message: 'Invalid faculty ID format. Use only letters, numbers, underscores, and hyphens (2-50 characters)'
      });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const sanitizedName = name.trim();
    const sanitizedFacultyId = faculty_id.trim();

    const existing = await Faculty.findOne({ email: sanitizedEmail });

    if (existing) {
      return res.status(400).json({
        message: 'Faculty account already exists'
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const faculty = await Faculty.create({
      name: sanitizedName,
      email: sanitizedEmail,
      faculty_id: sanitizedFacultyId,
      verification_token: verificationToken,
      verification_token_expiry: Date.now() + 1000 * 60 * 60, // 1 hour
      is_verified: false
    });

    const verificationLink =
      `${process.env.FRONTEND_URL}/faculty/verify-email?token=${verificationToken}`;

    // Escape name for HTML email to prevent XSS
    const escapedName = escapeHtml(sanitizedName);

    await sendMail({
      to: sanitizedEmail,
      subject: 'Verify Your Faculty Account',
      html: `
        <p>Hello ${escapedName},</p>
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

    if (!token || !isValidHexToken(token)) {
      return res.status(400).json({ message: 'Invalid verification token format' });
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

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password strength
    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const faculty = await Faculty.findOne({ email: sanitizedEmail });

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

    const hashed = await bcrypt.hash(password, 12);

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

    // Validate inputs exist
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const faculty = await Faculty.findOne({ email: sanitizedEmail }).select('+password');

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
   FACULTY FORGOT PASSWORD – SEND OTP
===================================================== */
exports.facultyForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: 'Email is required'
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const faculty = await Faculty.findOne({ email: sanitizedEmail });

    // Do NOT reveal if email exists (security best practice)
    if (!faculty || !faculty.is_verified) {
      return res.json({ success: true });
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    faculty.reset_otp = otp;
    faculty.reset_otp_expiry = Date.now() + 10 * 60 * 1000; // 10 mins

    await faculty.save();

    // Escape name for HTML email to prevent XSS
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
      message: 'If account exists, OTP has been sent'
    });

  } catch (err) {
    console.error('Faculty forgot password error:', err);
    return res.status(500).json({
      message: 'Failed to send reset OTP'
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

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate OTP format (6 digits)
    if (!isValidOtp(otp)) {
      return res.status(400).json({ message: 'Invalid OTP format' });
    }

    // Validate password strength
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number'
      });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const faculty = await Faculty.findOne({ email: sanitizedEmail }).select(
      '+reset_otp +reset_otp_expiry +password'
    );

    if (!faculty) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    // Check OTP expiry first
    if (!faculty.reset_otp || Date.now() > faculty.reset_otp_expiry) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    // Use timing-safe comparison to prevent timing attacks
    if (!timingSafeEqual(faculty.reset_otp, otp)) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    faculty.password = await bcrypt.hash(newPassword, 12);
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
   ================ DASHBOARD FLOW =====================
*/

const getFaculty = async (req) => {
  return await Faculty.findById(req.user.id);
};

/* =====================================================
   GET FACULTY PROFILE
===================================================== */
exports.getFacultyProfile = async (req, res) => {
  try {
    const faculty = await getFaculty(req);

    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found' });
    }

    res.json({
      success: true,
      data: {
        id: faculty._id,
        name: faculty.name,
        email: faculty.email,
        faculty_id: faculty.faculty_id,
        is_verified: faculty.is_verified,
        last_login: faculty.last_login
      }
    });

  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};



/* =====================================================
   GET ALL FACULTY TRANSACTIONS
===================================================== */
exports.getAllTransactions = async (req, res) => {
  try {
    const faculty = await getFaculty(req);
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found' });
    }

    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();

    // Base filter
    const filter = {
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id
    };

    // 🔍 Search filter (prefix match)
    if (search) {
      // Escape special regex characters to prevent ReDoS attacks
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escapedSearch}`, 'i');

      filter.$or = [
        { transaction_id: regex },
        { project_name: regex },
        { student_reg_no: regex }
      ];
    }

    // Parallel execution
    const [totalItems, transactions] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .select('+project_name')
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return res.json({
      success: true,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    console.error('GET FACULTY TRANSACTIONS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch transactions'
    });
  }
};

/* =====================================================
  GET PENDING TRANSACTIONS
===================================================== */
exports.getPendingTransactions = async (req, res) => {
  try {
    const faculty = await getFaculty(req);
    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    const transactions = await Transaction.find({
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id,
      status: 'raised'
    })
      .select('+project_name')
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending transactions' });
  }
};



/* =====================================================
   GET SINGLE TRANSACTION DETAILS
===================================================== */
exports.getTransactionDetails = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const faculty = await getFaculty(req);

    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    const sanitizedTxnId = sanitizeString(transaction_id, 100);

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id
    })
      .select('+project_name')
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found or unauthorized'
      });
    }

    res.json({
      success: true,
      data: transaction
    });

  } catch (err) {
    console.error('Get transaction details error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};

/* =====================================================
   GET TRANSACTION HISTORY
===================================================== */
exports.getTransactionHistory = async (req, res) => {
  try {
    const faculty = await getFaculty(req);
    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    const transactions = await Transaction.find({
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id,
      status: { $in: ['approved','active','completed','overdue','rejected'] }
    })
      .select('+project_name')
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
};








/* =====================================================
   APPROVE FROM DASHBOARD
===================================================== */

exports.approveTransactionByFaculty = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const faculty = await getFaculty(req);

    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    const sanitizedTxnId = sanitizeString(transaction_id, 100);

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id,
      status: 'raised'
    });

    if (!transaction) {
      return res.status(400).json({
        error: 'Transaction not found or already processed'
      });
    }

    transaction.status = 'approved';
    transaction.faculty_approval.approved = true;
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction approved successfully'
    });

  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Failed to approve transaction' });
  }
};



/* =====================================================
   REJECT FROM DASHBOARD
===================================================== */
exports.rejectTransactionByFaculty = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transaction_id } = req.params;
    const { reason } = req.body;

    const faculty = await getFaculty(req);
    if (!faculty) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Faculty not found' });
    }

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    const sanitizedTxnId = sanitizeString(transaction_id, 100);

    // Sanitize reason to prevent XSS
    const sanitizedReason = sanitizeString(reason, 500);

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id,
      status: 'raised'
    }).session(session);

    if (!transaction) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'Transaction not found or already processed'
      });
    }

    /* ======================================
       RELEASE TEMP RESERVED STOCK
    ====================================== */

    const LabInventory = require('../models/LabInventory');

    for (const item of transaction.items) {

      const inventory = await LabInventory.findOne({
        lab_id: item.lab_id,
        item_id: item.item_id
      }).session(session);

      if (!inventory) continue;

      const reservedQty =
        item.quantity ||
        item.asset_ids?.length ||
        0;

      inventory.temp_reserved_quantity = Math.max(
        0,
        inventory.temp_reserved_quantity - reservedQty
      );

      await inventory.save({ session });
    }

    /* ======================================
       UPDATE TRANSACTION
    ====================================== */

    transaction.status = 'rejected';
    transaction.faculty_approval.approved = false;
    transaction.faculty_approval.rejected_reason = sanitizedReason;
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: 'Transaction rejected successfully and stock released'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Reject error:', err);

    return res.status(500).json({
      error: 'Failed to reject transaction'
    });
  }
};