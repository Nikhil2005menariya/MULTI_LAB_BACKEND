const Lab = require('../models/Lab');
const Staff = require('../models/Staff');
const LabInventory = require('../models/LabInventory');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const mongoose = require('mongoose');

const inchargeController = require('./incharge.controller');

/* =====================================================
   HELPER: Validate Lab Exists
===================================================== */
const validateLab = async (labId) => {
  const lab = await Lab.findById(labId);
  if (!lab || !lab.is_active) return null;
  return lab;
};

/* =====================================================
   ================= GLOBAL CAPABILITIES =================
===================================================== */

/* ============================
   CREATE LAB
============================ */
exports.createLab = async (req, res) => {
  try {
    const { name, code, location } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const exists = await Lab.findOne({
      $or: [{ name }, { code }]
    });

    if (exists) {
      return res.status(400).json({
        error: 'Lab with same name or code already exists'
      });
    }

    const lab = await Lab.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      location
    });

    res.status(201).json({
      success: true,
      data: lab
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to create lab' });
  }
};

/* ============================
   VIEW ALL LABS + STATS
============================ */
exports.getAllLabs = async (req, res) => {
  try {
    const labs = await Lab.find().lean();

    const enriched = await Promise.all(
      labs.map(async (lab) => {
        const staffCount = await Staff.countDocuments({
          lab_id: lab._id,
          role: { $in: ['incharge', 'assistant'] }
        });

        const studentCount = await Student.countDocuments({
          lab_id: lab._id
        });

        const inventoryCount = await LabInventory.countDocuments({
          lab_id: lab._id
        });

        return {
          ...lab,
          stats: {
            staffCount,
            studentCount,
            inventoryCount
          }
        };
      })
    );

    res.json({ success: true, data: enriched });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch labs' });
  }
};

/* ============================
   REMOVE LAB (SAFE DELETE)
============================ */
exports.removeLab = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await Lab.findById(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Lab not found' });
    }

    // 1. Deactivate lab
    lab.is_active = false;
    await lab.save();

    // 2. Deactivate all staff in lab
    await Staff.updateMany(
      { lab_id: labId },
      { $set: { is_active: false, lab_id: null } }
    );

    // 3. Optional: Keep inventory but mark logically inactive
    // (No hard delete to preserve audit integrity)

    res.json({
      success: true,
      message: 'Lab deactivated successfully'
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to remove lab' });
  }
};

/* =====================================================
   ================= LAB-SCOPED CAPABILITIES =================
===================================================== */

/* ============================
   ADD ASSISTANT TO LAB
============================ */
exports.addAssistant = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email, password } = req.body;

    const lab = await validateLab(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    const existing = await Staff.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const assistant = await Staff.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'assistant',
      lab_id: labId
    });

    res.status(201).json({
      success: true,
      data: assistant
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to add assistant' });
  }
};

/* ============================
   REMOVE ASSISTANT
============================ */
exports.removeAssistant = async (req, res) => {
  try {
    const { labId, staffId } = req.params;

    const staff = await Staff.findOne({
      _id: staffId,
      lab_id: labId,
      role: 'assistant'
    });

    if (!staff) {
      return res.status(404).json({ error: 'Assistant not found' });
    }

    staff.is_active = false;
    staff.lab_id = null;
    await staff.save();

    res.json({
      success: true,
      message: 'Assistant removed successfully'
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to remove assistant' + err });
  }
};

/* ============================
   CHANGE INCHARGE (ONLY ONE ALLOWED)
============================ */
exports.changeIncharge = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email, password } = req.body;

    const lab = await validateLab(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    // Remove existing incharge (if exists)
    await Staff.updateMany(
      { lab_id: labId, role: 'incharge' },
      { $set: { is_active: false, lab_id: null } }
    );

    const existing = await Staff.findOne({ email });
    if (existing) {
      return res.status(400).json({
        error: 'Email already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const incharge = await Staff.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'incharge',
      lab_id: labId
    });

    res.status(201).json({
      success: true,
      data: incharge
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to change incharge' });
  }
};

/* ============================
   GET LAB STAFF
============================ */
exports.getLabStaff = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await validateLab(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    const staff = await Staff.find({
      lab_id: labId,
      role: { $in: ['incharge', 'assistant'] }
    }).select('-password');

    res.json({
      success: true,
      data: staff
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lab staff' });
  }
};

/* ============================
   GET CURRENT INCHARGE
============================ */
exports.getCurrentIncharge = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await Lab.findById(labId);
    if (!lab || !lab.is_active) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    const incharge = await Staff.findOne({
      lab_id: labId,
      role: 'incharge',
      is_active: true
    }).select('-password');

    return res.json({
      success: true,
      data: incharge || null
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch incharge'
    });
  }
};


/* ============================
   ANALYTICS - TRANSACTIONS
   (CORRECT MULTI-LAB VERSION)
============================ */
exports.getTransactionAnalytics = async (req, res) => {
  try {
    const {
      fields,
      startDate,
      endDate,
      labId,
      filters,
      format
    } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        error: 'Fields array is required'
      });
    }

    /* ============================
       ALLOWED FIELDS
    ============================= */

    const allowedFields = [
      'transaction_id',
      'project_name',
      'transaction_type',
      'status',
      'student_id',
      'student_reg_no',
      'faculty_email',
      'faculty_id',
      'issued_at',
      'expected_return_date',
      'actual_return_date',
      'createdAt',
      'updatedAt'
    ];

    const selectedFields = fields.filter(f =>
      allowedFields.includes(f)
    );

    if (selectedFields.length === 0) {
      return res.status(400).json({
        error: 'No valid fields selected'
      });
    }

    /* ============================
       AGGREGATION PIPELINE
    ============================= */

    const pipeline = [];

    // Date filtering
    if (startDate || endDate) {
      const dateFilter = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }

      pipeline.push({
        $match: { createdAt: dateFilter }
      });
    }

    // Unwind items because lab_id is inside items[]
    pipeline.push({ $unwind: '$items' });

    // Filter by lab (correct way)
    if (labId) {
      pipeline.push({
        $match: {
          'items.lab_id':
            new mongoose.Types.ObjectId(labId)
        }
      });
    }

    // Dynamic filters
    if (filters && typeof filters === 'object') {
      const filterMatch = {};

      Object.entries(filters).forEach(([key, value]) => {
        if (!allowedFields.includes(key)) return;

        if (
          ['student_id'].includes(key)
        ) {
          filterMatch[key] =
            new mongoose.Types.ObjectId(value);
        } else {
          filterMatch[key] = value;
        }
      });

      if (Object.keys(filterMatch).length > 0) {
        pipeline.push({ $match: filterMatch });
      }
    }

    // Group back to transaction level
    pipeline.push({
      $group: {
        _id: '$_id',
        doc: { $first: '$$ROOT' }
      }
    });

    pipeline.push({
      $replaceRoot: { newRoot: '$doc' }
    });

    // Projection
    const projectStage = {};
    selectedFields.forEach(field => {
      projectStage[field] = 1;
    });

    pipeline.push({
      $project: projectStage
    });

    pipeline.push({
      $sort: { createdAt: -1 }
    });

    const transactions = await Transaction.aggregate(pipeline);

    /* ============================
       CSV EXPORT
    ============================= */

    if (format === 'csv') {
      const header = selectedFields.join(',');

      const rows = transactions.map(txn =>
        selectedFields
          .map(field => {
            const value = txn[field] ?? '';
            return `"${String(value).replace(/"/g, '""')}"`;
          })
          .join(',')
      );

      const csvContent = [header, ...rows].join('\n');

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=transaction_report.csv'
      );
      res.setHeader('Content-Type', 'text/csv');

      return res.send(csvContent);
    }

    return res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    console.error('Transaction analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch transaction analytics'+err
    });
  }
};

/* ============================
   ITEM ANALYTICS
   (DATE RANGE + OPTIONAL LAB)
============================ */

exports.getItemAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, labId } = req.body;

    const filter = {};

    // Date filtering
    if (startDate || endDate) {
      filter.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    // Lab filtering
    if (labId) {
      filter.source_lab_id = new mongoose.Types.ObjectId(labId);
    }

    /* ============================
       1️⃣ TRANSACTION AGGREGATION
    ============================= */
    const transactionStats = await Transaction.aggregate([
      { $match: filter },
      { $unwind: '$items' },
      ...(labId
        ? [
            {
              $match: {
                'items.lab_id': new mongoose.Types.ObjectId(labId)
              }
            }
          ]
        : []),
      {
        $group: {
          _id: '$items.item_id',
          total_issued: { $sum: '$items.issued_quantity' },
          total_damaged: { $sum: '$items.damaged_quantity' },
          total_returned: { $sum: '$items.returned_quantity' }
        }
      }
    ]);

    /* ============================
       2️⃣ CURRENT INVENTORY STATE
    ============================= */
    const assetMatch = labId
      ? { lab_id: new mongoose.Types.ObjectId(labId) }
      : {};

    const assetStats = await ItemAsset.aggregate([
      { $match: assetMatch },
      {
        $group: {
          _id: '$item_id',
          good_count: {
            $sum: {
              $cond: [{ $eq: ['$condition', 'good'] }, 1, 0]
            }
          },
          faulty_count: {
            $sum: {
              $cond: [{ $eq: ['$condition', 'faulty'] }, 1, 0]
            }
          },
          broken_count: {
            $sum: {
              $cond: [{ $eq: ['$condition', 'broken'] }, 1, 0]
            }
          }
        }
      }
    ]);

    /* ============================
       3️⃣ MERGE RESULTS
    ============================= */

    const items = await Item.find({ is_active: true })
      .select('name sku category')
      .lean();

    const result = items.map(item => {
      const txn = transactionStats.find(
        t => String(t._id) === String(item._id)
      );

      const asset = assetStats.find(
        a => String(a._id) === String(item._id)
      );

      return {
        item_id: item._id,
        name: item.name,
        sku: item.sku,
        category: item.category,

        // Date-range stats
        issued_in_range: txn?.total_issued || 0,
        damaged_in_range: txn?.total_damaged || 0,
        returned_in_range: txn?.total_returned || 0,

        // Current condition
        good_now: asset?.good_count || 0,
        faulty_now: asset?.faulty_count || 0,
        broken_now: asset?.broken_count || 0
      };
    });

    return res.json({
      success: true,
      count: result.length,
      data: result
    });

  } catch (err) {
    console.error('Item analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch item analytics '+err
    });
  }
};

/* =====================================================
   SUPER ADMIN = LAB INCHARGE FOR ANY LAB
   Proxy Calls to Incharge Controllers
===================================================== */

// exports.issueTransaction = inchargeController.issueTransaction;
// exports.returnTransaction = inchargeController.returnTransaction;
exports.getActiveTransactions = inchargeController.getActiveTransactions;
exports.getPendingTransactions = inchargeController.getPendingTransactions;
exports.getAvailableAssetsByItem = inchargeController.getAvailableAssetsByItem;
// exports.issueLabSession = inchargeController.issueLabSession;
exports.getAvailableLabItems = inchargeController.getAvailableLabItems;
exports.searchLabItems = inchargeController.searchLabItems;
exports.getActiveLabSessions = inchargeController.getActiveLabSessions;
// exports.issueLabTransfer = inchargeController.issueLabTransfer;
exports.getActiveLabTransfers = inchargeController.getActiveLabTransfers;