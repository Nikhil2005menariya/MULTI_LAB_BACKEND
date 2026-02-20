const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const Student = require('../models/Student');
const { sendMail } = require('../services/mail.service');
const ComponentRequest = require("../models/ComponentRequest");



// GET AVAILABLE ITEMS FOR STUDENT
exports.getAvailableItemsForStudent = async (req, res) => {
  try {
    const items = await Item.find(
      { is_active: true },
      {
        name: 1,
        sku: 1,
        category: 1,
        description: 1,
        tracking_type: 1,
        available_quantity: 1,
        total_quantity: 1,          // ✅ REQUIRED
        min_threshold_quantity: 1   // ✅ REQUIRED (low-stock UI)
      }
    ).sort({ name: 1 });

    res.json({
      success: true,
      data: items
    });
  } catch (err) {
    console.error('STUDENT ITEMS ERROR:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load available items'
    });
  }
};



/* ============================
   RAISE TRANSACTION (FINAL)
============================ */
exports.raiseTransaction = async (req, res) => {
  try {
    const {
      items,
      faculty_email,
      faculty_id,
      expected_return_date
    } = req.body;

    /* ============================
       BASIC VALIDATION
    ============================ */
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items selected' });
    }

    if (!faculty_email || !faculty_id || !expected_return_date) {
      return res.status(400).json({
        error: 'Faculty details and expected return date are required'
      });
    }

    // ✅ Faculty email domain check
    if (!faculty_email.endsWith('@vit.ac.in')) {
      return res.status(400).json({
        error: 'Faculty email must be a valid @vit.ac.in address'
      });
    }

    /* ============================
       FETCH STUDENT
    ============================ */
    const student = await Student.findById(req.user.id);

    if (!student || !student.is_active) {
      return res.status(404).json({ error: 'Student not found or inactive' });
    }

    /* ============================
       BLOCK MULTIPLE TRANSACTIONS
    ============================ */
    const existingTxn = await Transaction.findOne({
      student_id: student._id,
      status: { $in: ['raised', 'approved', 'active', 'overdue'] }
    }).sort({ createdAt: -1 });

    if (existingTxn) {
      if (existingTxn.status === 'raised') {
        return res.status(409).json({
          error: 'You already have a pending request awaiting faculty approval'
        });
      }

      if (existingTxn.status === 'approved' || existingTxn.status === 'active') {
        return res.status(409).json({
          error: 'You already have an active transaction. Return items before raising a new request'
        });
      }

      if (existingTxn.status === 'overdue') {
        return res.status(409).json({
          error: 'You have overdue components. Please clear overdue before raising a new request'
        });
      }
    }

    /* ============================
       VALIDATE INVENTORY REQUEST
    ============================ */
    for (const reqItem of items) {
      const item = await Item.findById(reqItem.item_id);

      if (!item || !item.is_active) {
        return res.status(400).json({
          error: 'Invalid or inactive item selected'
        });
      }

      if (!reqItem.quantity || reqItem.quantity <= 0) {
        return res.status(400).json({
          error: `Quantity required for ${item.name}`
        });
      }

      // BULK ITEMS
      if (item.tracking_type === 'bulk') {
        const usableQty =
          item.available_quantity - item.reserved_quantity;

        if (usableQty < reqItem.quantity) {
          return res.status(400).json({
            error: `Insufficient quantity for ${item.name}`
          });
        }
      }

      // ASSET ITEMS → validated later by in-charge
    }

    /* ============================
       GENERATE IDS
    ============================ */
    const transactionId =
      'TXN-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    const approvalToken =
      crypto.randomBytes(32).toString('hex');

    /* ============================
       NORMALIZE ITEMS
    ============================ */
    const normalizedItems = items.map(i => ({
      item_id: i.item_id,
      quantity: i.quantity,
      asset_tags: []
    }));

    /* ============================
       SEND FACULTY EMAIL FIRST
       (DO NOT CREATE TXN IF MAIL FAILS)
    ============================ */
    const approvalLink =
      `${process.env.FRONTEND_URL}/faculty/approve?token=${approvalToken}`;

    await sendMail({
      to: faculty_email,
      subject: 'IoT Lab Component Borrow Approval',
      html: `
        <p>
          Student <b>${student.name}</b>
          (Reg No: <b>${student.reg_no}</b>)
          has requested lab components.
        </p>
        <p>Transaction ID: <b>${transactionId}</b></p>
        <p>Expected Return Date: <b>${new Date(expected_return_date).toDateString()}</b></p>
        <a href="${approvalLink}">Approve Request</a>
      `
    });

    /* ============================
       CREATE TRANSACTION
    ============================ */
    await Transaction.create({
      transaction_id: transactionId,
      student_id: student._id,
      student_reg_no: student.reg_no,
      faculty_email,
      faculty_id,
      expected_return_date,
      items: normalizedItems,
      status: 'raised',
      faculty_approval: {
        approved: false,
        approval_token: approvalToken
      }
    });

    return res.status(201).json({
      success: true,
      transaction_id: transactionId,
      message: 'Transaction raised successfully and sent for faculty approval'
    });

  } catch (err) {
    console.error('Raise transaction error:', err);
    return res.status(500).json({
      error: 'Failed to raise transaction. Please try again later.'
    });
  }
};



/* ============================
   STUDENT TRANSACTION HISTORY
============================ */

exports.getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      student_id: req.user.id
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   TRACK TRANSACTION BY ID
============================ */

exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      student_id: req.user.id
    }).populate('items.item_id', 'name sku');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ success: true, data: transaction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


//component request 


/* ============================
   STUDENT: REQUEST COMPONENT
============================ */
/* ============================
   CREATE COMPONENT REQUEST
============================ */
exports.requestComponent = async (req, res) => {
  try {
    const {
      component_name,
      category,
      quantity_requested,
      use_case,
      urgency
    } = req.body;

    if (!component_name || !quantity_requested || !use_case) {
      return res.status(400).json({
        message: 'Missing required fields'
      });
    }

    /* ============================
       FETCH STUDENT (FROM TOKEN)
    ============================ */
    const student = await Student.findById(req.user.id);

    if (!student || !student.is_active) {
      return res.status(404).json({
        message: 'Student not found'
      });
    }

    /* ============================
       CREATE REQUEST
    ============================ */
    const request = await ComponentRequest.create({
      component_name,
      category,
      quantity_requested,
      use_case,
      urgency: urgency || 'medium',

      // 🔥 REQUIRED FIELDS — FIX
      student_id: student._id,
      student_reg_no: student.reg_no,
      student_email: student.email,

      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      message: 'Component request submitted successfully',
      data: request
    });

  } catch (err) {
    console.error('Component request error:', err);
    return res.status(500).json({
      message: 'Failed to submit component request'
    });
  }
};


/* ============================
   GET STUDENT REQUESTS
============================ */
exports.getMyComponentRequests = async (req, res) => {
  try {
    const requests = await ComponentRequest.find({
      student_id: req.user.id
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (err) {
    console.error('Fetch student requests error:', err);
    res.status(500).json({
      message: 'Failed to fetch requests'
    });
  }
};