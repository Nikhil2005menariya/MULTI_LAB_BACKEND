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
const adminController = require('./admin.controller');
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
   ANALYTICS - TRANSACTIONS (ENHANCED)
============================ */

exports.getTransactionAnalytics = async (req, res) => {
  try {
    const {
      fields,
      startDate,
      endDate,
      labId,
      filters,
      format,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      order = -1
    } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        error: 'Fields array is required'
      });
    }

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
       FILTER BUILDING
    ============================= */

    const txnMatch = {};
    const itemMatch = {};

    // Date filter
    if (startDate || endDate) {
      txnMatch.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        txnMatch.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txnMatch.createdAt.$lte = end;
      }
    }

    // Lab filter (item level)
    if (labId) {
      itemMatch['items.lab_id'] = new mongoose.Types.ObjectId(labId);
    }

    // Dynamic filters
    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (!allowedFields.includes(key)) return;

        if (key === 'student_id') {
          txnMatch[key] = new mongoose.Types.ObjectId(value);
        } else {
          txnMatch[key] = value;
        }
      });
    }

    /* ============================
       BASE PIPELINE
    ============================= */

    const basePipeline = [
      { $match: txnMatch },
      { $unwind: '$items' },
      ...(Object.keys(itemMatch).length ? [{ $match: itemMatch }] : [])
    ];

    /* ============================
       SUMMARY PIPELINE
    ============================= */

    const summaryPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: null,
          total_transactions: { $addToSet: '$_id' },
          total_issued: { $sum: '$items.issued_quantity' },
          total_returned: { $sum: '$items.returned_quantity' },
          total_damaged: { $sum: '$items.damaged_quantity' }
        }
      },
      {
        $project: {
          total_transactions: { $size: '$total_transactions' },
          total_issued: 1,
          total_returned: 1,
          total_damaged: 1
        }
      }
    ];

    /* ============================
       TOP ITEMS
    ============================= */

    const topItemsPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$items.item_id',
          issued: { $sum: '$items.issued_quantity' }
        }
      },
      { $sort: { issued: -1 } },
      { $limit: 5 }
    ];

    /* ============================
       TOP LABS
    ============================= */

    const topLabsPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$items.lab_id',
          issued: { $sum: '$items.issued_quantity' }
        }
      },
      { $sort: { issued: -1 } },
      { $limit: 5 }
    ];

    /* ============================
       MAIN DATA PIPELINE
    ============================= */

    const dataPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      {
        $project: selectedFields.reduce((acc, f) => {
          acc[f] = 1;
          return acc;
        }, {})
      },
      { $sort: { [sortBy]: order } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ];

    /* ============================
       EXECUTE IN PARALLEL
    ============================= */

    const [summary, topItems, topLabs, transactions] =
      await Promise.all([
        Transaction.aggregate(summaryPipeline),
        Transaction.aggregate(topItemsPipeline),
        Transaction.aggregate(topLabsPipeline),
        Transaction.aggregate(dataPipeline)
      ]);

    /* ============================
       CSV EXPORT
    ============================= */

    if (format === 'csv') {
      const header = selectedFields.join(',');

      const rows = transactions.map(txn =>
        selectedFields
          .map(field => {
            const value = txn[field] ?? '';
            const safe = String(value)
              .replace(/"/g, '""')
              .replace(/\n/g, ' ');
            return `"${safe}"`;
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

    /* ============================
       RESPONSE
    ============================= */

    return res.json({
      success: true,
      page,
      limit,
      count: transactions.length,

      summary: summary[0] || {
        total_transactions: 0,
        total_issued: 0,
        total_returned: 0,
        total_damaged: 0
      },

      top_items: topItems,
      top_labs: topLabs,

      data: transactions
    });

  } catch (err) {
    console.error('Transaction analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch transaction analytics'
    });
  }
};


/* ============================
   ITEM ANALYTICS (ENHANCED)
============================ */

exports.getItemAnalytics = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      labId,
      page = 1,
      limit = 50
    } = req.body;

    /* ============================
       FILTER BUILDING
    ============================= */

    const txnMatch = {};

    if (startDate || endDate) {
      txnMatch.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        txnMatch.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txnMatch.createdAt.$lte = end;
      }
    }

    const itemLabMatch = labId
      ? { 'items.lab_id': new mongoose.Types.ObjectId(labId) }
      : {};

    const assetMatch = labId
      ? { lab_id: new mongoose.Types.ObjectId(labId) }
      : {};

    /* ============================
       1️⃣ TRANSACTION STATS
    ============================= */

    const transactionStats = await Transaction.aggregate([
      { $match: txnMatch },
      { $unwind: '$items' },
      ...(labId ? [{ $match: itemLabMatch }] : []),
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
       3️⃣ CONVERT TO MAPS (FAST LOOKUP)
    ============================= */

    const txnMap = new Map(
      transactionStats.map(t => [String(t._id), t])
    );

    const assetMap = new Map(
      assetStats.map(a => [String(a._id), a])
    );

    /* ============================
       4️⃣ FETCH ITEMS (PAGINATED)
    ============================= */

    const skip = (page - 1) * limit;

    const [items, totalItems] = await Promise.all([
      Item.find({ is_active: true })
        .select('name sku category')
        .skip(skip)
        .limit(limit)
        .lean(),

      Item.countDocuments({ is_active: true })
    ]);

    /* ============================
       5️⃣ MERGE DATA
    ============================= */

    const data = items.map(item => {
      const txn = txnMap.get(String(item._id));
      const asset = assetMap.get(String(item._id));

      const totalStock =
        (asset?.good_count || 0) +
        (asset?.faulty_count || 0) +
        (asset?.broken_count || 0);

      const issued = txn?.total_issued || 0;

      return {
        item_id: item._id,
        name: item.name,
        sku: item.sku,
        category: item.category,

        // Transaction stats
        issued_in_range: issued,
        damaged_in_range: txn?.total_damaged || 0,
        returned_in_range: txn?.total_returned || 0,

        // Current inventory
        good_now: asset?.good_count || 0,
        faulty_now: asset?.faulty_count || 0,
        broken_now: asset?.broken_count || 0,

        // Derived metric
        utilization_rate:
          totalStock > 0 ? +(issued / totalStock).toFixed(2) : 0
      };
    });

    /* ============================
       6️⃣ SUMMARY STATS
    ============================= */

    const summary = {
      total_items: totalItems,
      total_issued: transactionStats.reduce(
        (sum, t) => sum + t.total_issued,
        0
      ),
      total_damaged: transactionStats.reduce(
        (sum, t) => sum + t.total_damaged,
        0
      ),
      total_returned: transactionStats.reduce(
        (sum, t) => sum + t.total_returned,
        0
      ),
      total_good: assetStats.reduce(
        (sum, a) => sum + a.good_count,
        0
      ),
      total_faulty: assetStats.reduce(
        (sum, a) => sum + a.faulty_count,
        0
      ),
      total_broken: assetStats.reduce(
        (sum, a) => sum + a.broken_count,
        0
      )
    };

    /* ============================
       RESPONSE
    ============================= */

    return res.json({
      success: true,

      page,
      limit,
      total_items: totalItems,
      total_pages: Math.ceil(totalItems / limit),

      summary,

      data
    });

  } catch (err) {
    console.error('Item analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch item analytics'
    });
  }
};

const executeInLabContext = async (req, res, labId, handler) => {
  try {
    const lab = await Lab.findById(labId);

    if (!lab || !lab.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or inactive lab'
      });
    }

    // Inject lab context
    req.user.lab_id = labId;

    return handler(req, res);

  } catch (err) {
    console.error('Lab context error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process lab-scoped request'
    });
  }
};

/* ================= INVENTORY ================= */

exports.getAllItems = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getAllItems);

exports.getItemById = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getItemById);

exports.getItemAssets = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getItemAssets);

exports.getLabAvailableItems = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getLabAvailableItems);

/* ================= TRANSACTIONS ================= */

exports.getTransactionHistory = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getTransactionHistory);

exports.searchTransactions = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.searchTransactions);

exports.getOverdueTransactions = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getOverdueTransactions);

/* ================= LAB SESSIONS ================= */

exports.getLabSessions = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getLabSessions);

exports.getLabSessionDetail = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getLabSessionDetail);

/* ================= LAB TRANSFERS ================= */


exports.getLabTransfers = async (req, res) => {
  try {
    const { labId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(labId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lab id'
      });
    }

    const labObjectId = new mongoose.Types.ObjectId(labId);

    const records = await Transaction.find({
      transaction_type: 'lab_transfer',
      $or: [
        { source_lab_id: labObjectId },
        { target_lab_id: labObjectId }
      ]
    })
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = records.map(t => ({
      _id: t._id,
      transaction_id: t.transaction_id,
      project_name: t.project_name,
      transfer_type: t.transfer_type,
      status: t.status,
      expected_return_date: t.expected_return_date,
      actual_return_date: t.actual_return_date,
      issued_at: t.issued_at,
      createdAt: t.createdAt,

      /* 🔥 NORMALIZED LAB OBJECTS */
      source_lab: t.source_lab_id
        ? {
            _id: t.source_lab_id._id,
            name: t.source_lab_id.name,
            code: t.source_lab_id.code,
            location: t.source_lab_id.location
          }
        : null,

      target_lab: t.target_lab_id
        ? {
            _id: t.target_lab_id._id,
            name: t.target_lab_id.name,
            code: t.target_lab_id.code,
            location: t.target_lab_id.location
          }
        : null,

      /* ITEMS */
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Super Admin get transfers error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lab transfers'
    });
  }
};
exports.getLabTransferDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transfer id'
      });
    }

    const record = await Transaction.findOne({
      _id: id,
      transaction_type: 'lab_transfer'
    })
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found'
      });
    }

    record.source_lab = record.source_lab_id
      ? {
          _id: record.source_lab_id._id,
          name: record.source_lab_id.name,
          code: record.source_lab_id.code,
          location: record.source_lab_id.location
        }
      : null;

    record.target_lab = record.target_lab_id
      ? {
          _id: record.target_lab_id._id,
          name: record.target_lab_id.name,
          code: record.target_lab_id.code,
          location: record.target_lab_id.location
        }
      : null;

    record.items = record.items.map(i => ({
      ...i,
      asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
    }));

    return res.json({
      success: true,
      data: record
    });

  } catch (err) {
    console.error('Super Admin get transfer detail error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer'
    });
  }
};
/* ================= COMPONENT REQUESTS ================= */

exports.getAllComponentRequests = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getAllComponentRequests);

exports.getComponentRequestById = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getComponentRequestById);


/* ================= BILLS ================= */

exports.getBills = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getBills);

exports.downloadBill = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.downloadBill);

/* ================= DAMAGED ASSET HISTORY ================= */

exports.getDamagedAssetHistory = async (req, res) =>
  executeInLabContext(req, res, req.params.labId, adminController.getDamagedAssetHistory);

