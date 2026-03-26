const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const Lab = require('../models/Lab');
const LabInventory = require('../models/LabInventory');
const Student = require('../models/Student');
const ComponentRequest = require('../models/ComponentRequest');
const { sendMail } = require('../services/mail.service');

/* ============================
   INPUT VALIDATION & SANITIZATION
============================ */

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const PASSWORD_MIN_LENGTH = 8;

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email) && email.length <= 254;
};

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const isValidPositiveInteger = (num) => {
  const parsed = Number(num);
  return !isNaN(parsed) && parsed > 0 && Number.isInteger(parsed);
};

const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) return false;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUpperCase && hasLowerCase && hasNumber;
};

const escapeRegex = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const sanitizeText = (text, maxLength = 1000) => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').trim().substring(0, maxLength);
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

/* ============================
   GET ALL ITEMS (STUDENT SAFE)
============================ */
exports.getAllItems = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();

    // Build search match with escaped regex to prevent ReDoS
    let searchMatch = {};
    if (search) {
      const escapedSearch = escapeRegex(search);
      const regex = new RegExp(`^${escapedSearch}`, 'i'); // prefix match (fast)

      searchMatch = {
        $or: [
          { 'item.name': regex },
          { 'item.sku': regex },
          { 'item.category': regex }
        ]
      };
    }

    const result = await LabInventory.aggregate([

      /* 🔥 STUDENT VISIBILITY */
      {
        $match: {
          is_student_visible: true
        }
      },

      /* 🔥 LOOKUP LAB FIRST */
      {
        $lookup: {
          from: 'labs',
          localField: 'lab_id',
          foreignField: '_id',
          as: 'lab'
        }
      },
      { $unwind: '$lab' },

      /* 🔥 FILTER OUT INACTIVE LABS */
      {
        $match: {
          'lab.is_active': true
        }
      },

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
          'item.is_active': true
        }
      },

      /* 🔍 SEARCH (ONLY IF PRESENT) */
      ...(search ? [{ $match: searchMatch }] : []),

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

      { $sort: { name: 1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit }
          ],
          totalCount: [
            { $count: 'count' }
          ]
        }
      }
    ]);

    const data = result[0]?.data || [];
    const totalItems = result[0]?.totalCount[0]?.count || 0;

    return res.json({
      success: true,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: data.length,
      data
    });

  } catch (err) {
    console.error('GET STUDENT ITEMS ERROR:', err);
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

    // Validate ObjectId
    if (!item_id || !isValidObjectId(item_id)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    const inventories = await LabInventory.aggregate([

      {
        $match: {
          item_id: new mongoose.Types.ObjectId(item_id),
          is_student_visible: true
        }
      },
      {
        $addFields: {
          available_quantity: {
            $subtract: [
              {
                $subtract: [
                  '$available_quantity',
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

      /* 🔥 FILTER OUT INACTIVE LABS */
      {
        $match: {
          'lab_id.is_active': true
        }
      },

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
    console.error('Get item labs error:', err);
    return res.status(500).json({
      error: 'Failed to fetch item labs'
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

    // Validate email format
    if (!isValidEmail(faculty_email)) {
      return res.status(400).json({ error: 'Invalid faculty email format' });
    }

    // Sanitize inputs
    const sanitizedProjectName = sanitizeText(project_name, 200);
    const sanitizedFacultyId = sanitizeText(faculty_id, 50);

    const student = await Student.findById(req.user.id);
    if (!student || !student.is_active) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const existingTxn = await Transaction.findOne({
      student_id: student._id,
      status: { $in: ['raised','approved','active','overdue','partial_issued','partial_returned'] }
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

      // Validate ObjectIds
      if (!item_id || !isValidObjectId(item_id)) {
        throw new Error('Invalid item ID format');
      }
      if (!lab_id || !isValidObjectId(lab_id)) {
        throw new Error('Invalid lab ID format');
      }

      // Validate quantity
      if (!quantity || !isValidPositiveInteger(quantity)) {
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
      project_name: sanitizedProjectName,
      student_id: student._id,
      student_reg_no: student.reg_no,
      faculty_email,
      faculty_id: sanitizedFacultyId,
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

    // Escape user content for HTML email
    const escapedStudentName = escapeHtml(student.name);
    const escapedProjectName = escapeHtml(sanitizedProjectName);

    // Fetch lab and item details for email
    const itemDetailsPromises = normalizedItems.map(async (item) => {
      const [lab, itemData] = await Promise.all([
        Lab.findById(item.lab_id).lean(),
        Item.findById(item.item_id).lean()
      ]);
      return {
        labName: lab?.name || 'Unknown Lab',
        labCode: lab?.code || 'N/A',
        itemName: itemData?.name || 'Unknown Item',
        itemSku: itemData?.sku || 'N/A',
        quantity: item.quantity
      };
    });

    const itemDetails = await Promise.all(itemDetailsPromises);

    // Generate component rows for email
    const componentRows = itemDetails.map((detail) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:600;color:#1f2937;">${escapeHtml(detail.itemName)}</div>
          <div style="font-size:13px;color:#6b7280;">SKU: ${escapeHtml(detail.itemSku)}</div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#4b5563;">
          ${escapeHtml(detail.labName)} (${escapeHtml(detail.labCode)})
        </td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:#1f2937;">
          ${detail.quantity}
        </td>
      </tr>
    `).join('');

    await sendMail({
      to: faculty_email,
      subject: `VLabs Approval Required – ${transactionId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);overflow:hidden;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#2563eb 0%,#1e40af 100%);padding:32px 40px;text-align:center;">
                      <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">VLabs</h1>
                      <p style="margin:8px 0 0 0;color:#dbeafe;font-size:15px;">VIT Chennai Laboratory Management System</p>
                    </td>
                  </tr>

                  <!-- Content -->
                  <tr>
                    <td style="padding:40px;">

                      <h2 style="margin:0 0 8px 0;color:#1f2937;font-size:22px;font-weight:700;">Component Approval Request</h2>
                      <p style="margin:0 0 32px 0;color:#6b7280;font-size:15px;">A student has requested to borrow components from the lab.</p>

                      <!-- Info Card -->
                      <div style="background-color:#f9fafb;border-left:4px solid #2563eb;padding:20px;margin-bottom:32px;border-radius:6px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="padding:8px 0;">
                              <span style="color:#6b7280;font-size:14px;">Student</span>
                              <div style="color:#1f2937;font-weight:600;font-size:16px;margin-top:4px;">${escapedStudentName}</div>
                              <div style="color:#6b7280;font-size:14px;margin-top:2px;">Reg No: ${escapeHtml(student.reg_no)}</div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;">
                              <span style="color:#6b7280;font-size:14px;">Project Name</span>
                              <div style="color:#1f2937;font-weight:600;font-size:16px;margin-top:4px;">${escapedProjectName}</div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;">
                              <span style="color:#6b7280;font-size:14px;">Transaction ID</span>
                              <div style="color:#1f2937;font-weight:600;font-family:monospace;font-size:15px;margin-top:4px;">${transactionId}</div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;">
                              <span style="color:#6b7280;font-size:14px;">Expected Return Date</span>
                              <div style="color:#1f2937;font-weight:600;font-size:16px;margin-top:4px;">${new Date(expected_return_date).toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <!-- Components Table -->
                      <h3 style="margin:0 0 16px 0;color:#1f2937;font-size:18px;font-weight:600;">Requested Components</h3>
                      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                        <thead>
                          <tr style="background-color:#f9fafb;">
                            <th style="padding:12px;text-align:left;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Component</th>
                            <th style="padding:12px;text-align:left;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Lab</th>
                            <th style="padding:12px;text-align:center;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${componentRows}
                        </tbody>
                      </table>

                      <!-- CTA Button -->
                      <div style="text-align:center;margin-top:40px;">
                        <a href="${approvalLink}"
                           style="display:inline-block;background:linear-gradient(135deg,#2563eb 0%,#1e40af 100%);color:#ffffff;padding:16px 40px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 4px 6px rgba(37,99,235,0.3);">
                          Review & Approve Request
                        </a>
                      </div>

                      <!-- Footer Note -->
                      <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
                        <p style="margin:0;color:#9ca3af;font-size:14px;text-align:center;">
                          If you did not expect this request, please contact the lab administrator or ignore this email.
                        </p>
                      </div>

                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color:#f9fafb;padding:24px 40px;text-align:center;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:13px;">
                        © ${new Date().getFullYear()} VLabs - VIT Chennai. All rights reserved.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
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

    console.error('Raise transaction error:', err);
    return res.status(400).json({
      error: err.message || 'Failed to raise transaction'
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
    const { transaction_id } = req.params;

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    const sanitizedTxnId = sanitizeText(transaction_id, 100);

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
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
    console.error('Get transaction error:', err);
    return res.status(500).json({
      error: 'Failed to fetch transaction'
    });
  }
};

exports.extendReturnDate = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { new_return_date } = req.body;

    if (!new_return_date) {
      return res.status(400).json({ error: 'New return date is required' });
    }

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }
    const sanitizedTxnId = sanitizeText(transaction_id, 100);

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      student_id: req.user.id
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // ✅ Allow active, overdue, partial_returned — all have items still out
    if (!['active', 'overdue', 'partial_returned'].includes(transaction.status)) {
      return res.status(400).json({
        error: 'Only active or overdue transactions can be extended'
      });
    }

    if (!transaction.issued_at) {
      return res.status(400).json({ error: 'Transaction not yet issued' });
    }

    const now = new Date();
    const requestedDate = new Date(new_return_date);
    const issuedAt = new Date(transaction.issued_at);

    // ✅ New date must be in the future
    if (requestedDate <= now) {
      return res.status(400).json({
        error: 'New return date must be in the future'
      });
    }

    // ✅ New date must be later than current expected return date
    if (requestedDate <= new Date(transaction.expected_return_date)) {
      return res.status(400).json({
        error: 'New return date must be later than the current expected return date'
      });
    }

    // ✅ Cannot exceed 2 months from issued_at
    const maxAllowedDate = new Date(issuedAt);
    maxAllowedDate.setMonth(maxAllowedDate.getMonth() + 2);

    if (requestedDate > maxAllowedDate) {
      return res.status(400).json({
        error: `Return date cannot exceed 2 months from issue date (max: ${maxAllowedDate.toDateString()})`
      });
    }

    transaction.expected_return_date = requestedDate;

    // ✅ If transaction was overdue, revert to active since date is now extended
    if (transaction.status === 'overdue') {
      transaction.status = 'active';
    }

    await transaction.save();

    return res.json({
      success: true,
      message: 'Return date extended successfully',
      new_expected_return_date: transaction.expected_return_date,
      max_allowed_date: maxAllowedDate
    });

  } catch (err) {
    console.error('Extend return date error:', err);
    return res.status(500).json({ error: 'Failed to extend return date' });
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

    // Validate lab_id ObjectId
    if (!isValidObjectId(lab_id)) {
      return res.status(400).json({ error: 'Invalid lab ID format' });
    }

    // Validate quantity
    if (!isValidPositiveInteger(quantity_requested)) {
      return res.status(400).json({ error: 'Invalid quantity requested' });
    }

    // Validate urgency
    const validUrgencies = ['low', 'medium', 'high'];
    if (urgency && !validUrgencies.includes(urgency)) {
      return res.status(400).json({ error: 'Invalid urgency level' });
    }

    // Sanitize text inputs
    const sanitizedComponentName = sanitizeText(component_name, 200);
    const sanitizedCategory = sanitizeText(category, 100);
    const sanitizedUseCase = sanitizeText(use_case, 1000);

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
      component_name: sanitizedComponentName,
      category: sanitizedCategory,
      quantity_requested,
      use_case: sanitizedUseCase,
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
    console.error('Request component error:', err);
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

/* ============================
   GET MY PROFILE
============================ */
exports.getProfile = async (req, res) => {
  try {
    const student = await Student.findById(req.user.id).select(
      'name email reg_no is_active is_verified createdAt'
    );
 
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
 
    return res.json({
      success: true,
      data: student,
    });
  } catch (err) {
    console.error('GET PROFILE ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
};
 
/* ============================
   CHANGE PASSWORD
============================ */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
      });
    }

    // Validate password strength
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        error: 'Password must be 8-128 characters with at least one uppercase, one lowercase, and one number',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'New password must be different from current password',
      });
    }

    // Explicitly select password (select: false in schema)
    const student = await Student.findById(req.user.id).select('+password');

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, student.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    student.password = hashed;
    await student.save();

    return res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (err) {
    console.error('CHANGE PASSWORD ERROR:', err);
    return res.status(500).json({ error: 'Failed to update password' });
  }
};