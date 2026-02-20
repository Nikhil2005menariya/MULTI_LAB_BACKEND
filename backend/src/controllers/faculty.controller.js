const Transaction = require('../models/Transaction');
const Faculty = require('../models/Faculty');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../services/mail.service');
/* =====================================================
   ================= EMAIL TOKEN FLOW ==================
===================================================== */

/* ============================
   APPROVE VIA EMAIL TOKEN
============================ */
exports.approveTransaction = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Approval token missing' });
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
    res.status(500).json({ error: err.message });
  }
};


/* ============================
   GET APPROVAL DETAILS (TOKEN)
============================ */
exports.getApprovalDetails = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Approval token missing' });
    }

    const transaction = await Transaction.findOne({
      'faculty_approval.approval_token': token,
      status: 'raised'
    }).populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type');

    if (!transaction) {
      return res.status(400).json({ error: 'Invalid or expired approval token' });
    }

    res.json({
      success: true,
      data: transaction
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/* ============================
   REJECT VIA EMAIL TOKEN
============================ */
exports.rejectTransaction = async (req, res) => {
  try {
    const { token, reason } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Approval token missing' });
    }

    const transaction = await Transaction.findOne({
      'faculty_approval.approval_token': token,
      status: 'raised'
    });

    if (!transaction) {
      return res.status(400).json({ error: 'Invalid or expired approval token' });
    }

    transaction.status = 'rejected';
    transaction.faculty_approval.approved = false;
    transaction.faculty_approval.rejected_reason = reason || '';
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction rejected successfully'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    const transactions = await Transaction.find({
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('issued_by_incharge_id', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    console.error('Faculty transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
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
    console.error('Pending transactions error:', err);
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

    const transaction = await Transaction.findOne({
      transaction_id,
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id
    })
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
    console.error('Transaction details error:', err);
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
      status: { $in: ['approved', 'active', 'completed', 'overdue', 'rejected'] }
    })
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
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
};








/* =====================================================
   APPROVE FROM DASHBOARD
===================================================== */
/* =====================================================
   APPROVE TRANSACTION (DASHBOARD)
===================================================== */
exports.approveTransactionByFaculty = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const faculty = await getFaculty(req);

    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    const transaction = await Transaction.findOne({
      transaction_id,
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
/* =====================================================
   REJECT TRANSACTION (DASHBOARD)
===================================================== */
exports.rejectTransactionByFaculty = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { reason } = req.body;

    const faculty = await getFaculty(req);
    if (!faculty) return res.status(404).json({ error: 'Faculty not found' });

    const transaction = await Transaction.findOne({
      transaction_id,
      faculty_email: faculty.email,
      faculty_id: faculty.faculty_id,
      status: 'raised'
    });

    if (!transaction) {
      return res.status(400).json({
        error: 'Transaction not found or already processed'
      });
    }

    transaction.status = 'rejected';
    transaction.faculty_approval.approved = false;
    transaction.faculty_approval.rejected_reason = reason || '';
    transaction.faculty_approval.approved_at = new Date();
    transaction.faculty_approval.approval_token = undefined;

    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction rejected successfully'
    });

  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Failed to reject transaction' });
  }
};
