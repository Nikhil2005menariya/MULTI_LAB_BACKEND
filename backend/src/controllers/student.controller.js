const mongoose = require('mongoose');
const crypto = require('crypto');

const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const Lab = require('../models/Lab');
const LabInventory = require('../models/LabInventory');
const Student = require('../models/Student');
const ComponentRequest = require('../models/ComponentRequest');
const { sendMail } = require('../services/mail.service');

exports.getAllItems = async (req, res) => {
  try {
    const items = await Item.find(
      { is_active: true, is_student_visible: true },
      {
        name: 1,
        sku: 1,
        category: 1,
        description: 1,
        tracking_type: 1,
        available_quantity: 1,
        temp_reserved_quantity: 1
      }
    ).sort({ name: 1 });

    res.json({ success: true, data: items });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load items' });
  }
};

exports.getItemLabs = async (req, res) => {
  try {
    const { item_id } = req.params;

    const inventories = await LabInventory.find({
      item_id,
      available_quantity: { $gt: 0 }
    })
      .populate('lab_id', 'name code location')
      .lean();

    res.json({ success: true, data: inventories });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load lab availability' +err});
  }
};

exports.raiseTransaction = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      items,
      faculty_email,
      faculty_id,
      expected_return_date,
      project_name
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items selected' });
    }

    if (!faculty_email || !faculty_id || !expected_return_date || !project_name) {
      return res.status(400).json({
        error: 'Project name, faculty details and return date required'
      });
    }

    const student = await Student.findById(req.user.id);
    if (!student || !student.is_active) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Block active transactions
    const existingTxn = await Transaction.findOne({
      student_id: student._id,
      status: { $in: ['raised', 'approved', 'active', 'overdue'] }
    });

    if (existingTxn) {
      return res.status(409).json({
        error: 'You already have an active or pending transaction'
      });
    }

    session.startTransaction();

    const normalizedItems = [];

    for (const reqItem of items) {
      const { item_id, lab_id, quantity } = reqItem;

      const item = await Item.findById(item_id).session(session);
      if (!item || !item.is_active) {
        throw new Error('Invalid item selected');
      }

      const labInventory = await LabInventory.findOne({
        lab_id,
        item_id,
        available_quantity: { $gte: quantity }
      }).session(session);

      if (!labInventory) {
        throw new Error(`Insufficient stock in selected lab`);
      }

      // TEMP RESERVE (LAB LEVEL)
      labInventory.reserved_quantity += quantity;
      await labInventory.save({ session });

      // TEMP RESERVE (GLOBAL)
      item.temp_reserved_quantity += quantity;
      await item.save({ session });

      normalizedItems.push({
        lab_id,
        item_id,
        quantity,
        asset_ids: []
      });
    }

    const transactionId =
      'TXN-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    const approvalToken =
      crypto.randomBytes(32).toString('hex');

    const approvalLink =
      `${process.env.FRONTEND_URL}/faculty/approve?token=${approvalToken}`;

    await sendMail({
      to: faculty_email,
      subject: 'IoT Lab Borrow Approval',
      html: `
        <p><b>${student.name}</b> requested components.</p>
        <p>Transaction ID: <b>${transactionId}</b></p>
        <p>Project: <b>${project_name}</b></p>
        <a href="${approvalLink}">Approve</a>
      `
    });

    const transaction = await Transaction.create([{
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
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      transaction_id: transactionId,
      data: transaction[0]
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      error: err.message || 'Failed to raise transaction'
    });
  }
};

exports.getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      student_id: req.user.id
    })
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('items.asset_ids', 'asset_tag serial_no')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: transactions });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load transactions' });
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      student_id: req.user.id
    })
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code location')
      .populate('items.asset_ids', 'asset_tag serial_no');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ success: true, data: transaction });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
};

exports.requestComponent = async (req, res) => {
  try {
    const {
      lab_id,
      component_name,
      category,
      quantity_requested,
      use_case,
      urgency
    } = req.body;

    const student = await Student.findById(req.user.id);

    const lab = await mongoose.model('Lab').findById(lab_id);

    const request = await ComponentRequest.create({
      lab_id,
      lab_name_snapshot: lab.name,
      student_id: student._id,
      student_reg_no: student.reg_no,
      student_email: student.email,
      component_name,
      category,
      quantity_requested,
      use_case,
      urgency: urgency || 'medium',
      status: 'pending'
    });

    res.status(201).json({ success: true, data: request });

  } catch (err) {
    res.status(500).json({ error: 'Failed to submit request' });
  }
};


exports.getMyComponentRequests = async (req, res) => {
  try {
    const requests = await ComponentRequest.find({
      student_id: req.user.id
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: requests
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch component requests'
    });
  }
};




exports.extendReturnDate = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { new_return_date } = req.body;

    if (!new_return_date) {
      return res.status(400).json({
        error: 'New return date is required'
      });
    }

    const transaction = await Transaction.findOne({
      transaction_id,
      student_id: req.user.id
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    // 🔒 Must be active
    if (transaction.status !== 'active') {
      return res.status(400).json({
        error: 'Only active transactions can be extended'
      });
    }

    if (!transaction.issued_at) {
      return res.status(400).json({
        error: 'Transaction not yet issued'
      });
    }

    if (transaction.actual_return_date) {
      return res.status(400).json({
        error: 'Transaction already completed'
      });
    }

    const issuedAt = new Date(transaction.issued_at);
    const requestedDate = new Date(new_return_date);

    if (requestedDate <= transaction.expected_return_date) {
      return res.status(400).json({
        error: 'New return date must be greater than current expected date'
      });
    }

    // 🔥 Maximum allowed = issued_at + 2 months
    const maxAllowedDate = new Date(issuedAt);
    maxAllowedDate.setMonth(maxAllowedDate.getMonth() + 2);

    if (requestedDate > maxAllowedDate) {
      return res.status(400).json({
        error: 'Return date cannot exceed 2 months from issue date'
      });
    }

    transaction.expected_return_date = requestedDate;
    await transaction.save();

    return res.json({
      success: true,
      message: 'Return date extended successfully',
      new_expected_return_date: transaction.expected_return_date
    });

  } catch (err) {
    console.error('Extend return date error:', err);
    return res.status(500).json({
      error: 'Failed to extend return date'
    });
  }
};