const mongoose = require('mongoose');
const crypto = require('crypto');

const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const Lab = require('../models/Lab');
const LabInventory = require('../models/LabInventory');
const Student = require('../models/Student');
const ComponentRequest = require('../models/ComponentRequest');
const { sendMail } = require('../services/mail.service');

/* ============================
   GET ALL ITEMS (STUDENT SAFE)
============================ */
exports.getAllItems = async (req, res) => {
  try {

    const items = await LabInventory.aggregate([
      {
        $lookup: {
          from: 'items',
          localField: 'item_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' },

      {
        $match: {
          'item.is_active': true,
          'item.is_student_visible': true
        }
      },

      {
        $addFields: {
          usable_quantity: {
            $subtract: [
              {
                $subtract: [
                  '$total_quantity',
                  { $ifNull: ['$reserved_quantity', 0] }
                ]
              },
              { $ifNull: ['$temp_reserved_quantity', 0] }
            ]
          }
        }
      },

      {
        $match: {
          usable_quantity: { $gt: 0 }
        }
      },

      {
        $group: {
          _id: '$item._id',
          name: { $first: '$item.name' },
          sku: { $first: '$item.sku' },
          category: { $first: '$item.category' },
          description: { $first: '$item.description' },
          tracking_type: { $first: '$item.tracking_type' },
          total_available: { $sum: '$usable_quantity' }
        }
      },

      { $sort: { name: 1 } }
    ]);

    return res.json({
      success: true,
      data: items
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load items'
    });
  }
};
/* ============================
   GET ITEM LABS
============================ */

exports.getItemLabs = async (req, res) => {
  try {
    const { item_id } = req.params;

    const inventories = await LabInventory.aggregate([
      {
        $match: {
          item_id: new mongoose.Types.ObjectId(item_id)
        }
      },
      {
        $addFields: {
          available_quantity: {
            $subtract: [
              {
                $subtract: [
                  '$total_quantity',
                  { $ifNull: ['$reserved_quantity', 0] }
                ]
              },
              { $ifNull: ['$temp_reserved_quantity', 0] }
            ]
          }
        }
      },
      {
        $match: {
          available_quantity: { $gt: 0 }
        }
      },
      {
        $lookup: {
          from: 'labs',
          localField: 'lab_id',
          foreignField: '_id',
          as: 'lab_id'
        }
      },
      { $unwind: '$lab_id' },
      {
        $project: {
          _id: 1,
          lab_id: {
            _id: '$lab_id._id',
            name: '$lab_id.name',
            code: '$lab_id.code',
            location: '$lab_id.location'
          },
          item_id: 1,
          total_quantity: 1,
          available_quantity: 1
        }
      }
    ]);

    return res.json({
      success: true,
      data: inventories
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
};

/* ============================
   RAISE TRANSACTION
============================ */
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

    if (!items?.length) {
      return res.status(400).json({ error: 'No items selected' });
    }

    if (!project_name?.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    if (!faculty_email || !faculty_id || !expected_return_date) {
      return res.status(400).json({
        error: 'Faculty details and return date required'
      });
    }

    const student = await Student.findById(req.user.id);
    if (!student || !student.is_active) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const existingTxn = await Transaction.findOne({
      student_id: student._id,
      status: { $in: ['raised','approved','active','overdue'] }
    });

    if (existingTxn) {
      return res.status(409).json({
        error: 'You already have an active or pending transaction'
      });
    }

    await session.startTransaction();

    const normalizedItems = [];

    for (const reqItem of items) {

      const { item_id, lab_id, quantity } = reqItem;

      if (!quantity || quantity <= 0) {
        throw new Error('Invalid quantity');
      }

      const labInventory = await LabInventory.findOne({
        lab_id,
        item_id
      }).session(session);

      if (!labInventory) {
        throw new Error('Item not found in selected lab');
      }

      const usable =
        labInventory.total_quantity
        - (labInventory.reserved_quantity || 0)
        - (labInventory.temp_reserved_quantity || 0);

      if (usable < quantity) {
        throw new Error('Insufficient stock in selected lab');
      }

      // TEMP RESERVE
      labInventory.temp_reserved_quantity =
        (labInventory.temp_reserved_quantity || 0) + quantity;

      await labInventory.save({ session });

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

    const transaction = await Transaction.create([{
      transaction_id: transactionId,
      project_name: project_name.trim(),
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

    /* ============================
       SEND APPROVAL EMAIL
    ============================ */

    const approvalLink =
      `${process.env.FRONTEND_URL}/faculty/approve?token=${approvalToken}`;

    await sendMail({
      to: faculty_email,
      subject: `Approval Required – ${transactionId}`,
      html: `
        <h2>IoT Lab Borrow Request</h2>
        <p><strong>Student:</strong> ${student.name} (${student.reg_no})</p>
        <p><strong>Project:</strong> ${project_name}</p>
        <p><strong>Transaction ID:</strong> ${transactionId}</p>
        <p><strong>Expected Return:</strong> ${new Date(expected_return_date).toDateString()}</p>
        <br/>
        <a href="${approvalLink}" 
           style="background:#2563eb;color:white;padding:10px 18px;
                  text-decoration:none;border-radius:6px;">
           Approve Request
        </a>
        <br/><br/>
        <p>If you did not expect this request, you may ignore this email.</p>
      `
    });

    return res.status(201).json({
      success: true,
      transaction_id: transactionId,
      data: transaction[0]
    });

  } catch (err) {

    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      error: err.message
    });
  }
};

/* ============================
   GET MY TRANSACTIONS (WITH ASSET TAGS)
============================ */
exports.getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      student_id: req.user.id
    })
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('items.asset_ids', 'asset_tag serial_no')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = transactions.map(tx => ({
      ...tx,
      items: tx.items.map(item => ({
        ...item,
        asset_tags: item.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    return res.json({
      success: true,
      data: formatted
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load transactions'
    });
  }
};

/* ============================
   GET TRANSACTION BY ID (WITH ASSET TAGS)
============================ */
exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      student_id: req.user.id
    })
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code location')
      .populate('items.asset_ids', 'asset_tag serial_no')
      .lean();

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    const formatted = {
      ...transaction,
      items: transaction.items.map(item => ({
        ...item,
        asset_tags: item.asset_ids?.map(a => a.asset_tag) || []
      }))
    };

    return res.json({
      success: true,
      data: formatted
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch transaction'
    });
  }
};

/* ============================
   EXTEND RETURN DATE
============================ */
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

    if (transaction.status !== 'active') {
      return res.status(400).json({
        error: 'Only active transactions can be extended'
      });
    }

    if (!transaction.issued_at || transaction.actual_return_date) {
      return res.status(400).json({
        error: 'Transaction not eligible for extension'
      });
    }

    const issuedAt = new Date(transaction.issued_at);
    const requestedDate = new Date(new_return_date);

    if (requestedDate <= transaction.expected_return_date) {
      return res.status(400).json({
        error: 'New return date must be later than current date'
      });
    }

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
      new_expected_return_date: transaction.expected_return_date
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to extend return date'
    });
  }
};



/* ============================
   REQUEST COMPONENT (UPDATED)
============================ */
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

    if (!lab_id || !component_name || !quantity_requested || !use_case) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    const student = await Student.findById(req.user.id);
    if (!student) {
      return res.status(404).json({
        error: 'Student not found'
      });
    }

    const lab = await Lab.findOne({
      _id: lab_id,
      is_active: true
    });

    if (!lab) {
      return res.status(404).json({
        error: 'Lab not found or inactive'
      });
    }

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

    const populated = await ComponentRequest.findById(request._id)
      .populate('lab_id', 'name code location')
      .lean();

    return res.status(201).json({
      success: true,
      data: populated
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to submit request'
    });
  }
};


/* ============================
   GET MY COMPONENT REQUESTS (WITH LAB INFO)
============================ */
exports.getMyComponentRequests = async (req, res) => {
  try {
    const requests = await ComponentRequest.find({
      student_id: req.user.id
    })
      .populate('lab_id', 'name code location')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: requests.length,
      data: requests
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch component requests'
    });
  }
};


/* ============================
   GET ALL LABS (STUDENT)
============================ */
exports.getAllLabsForStudents = async (req, res) => {
  try {
    const labs = await Lab.find(
      { is_active: true },
      { name: 1, code: 1, location: 1 }
    ).sort({ name: 1 });

    return res.json({
      success: true,
      count: labs.length,
      data: labs
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load labs'
    });
  }
};