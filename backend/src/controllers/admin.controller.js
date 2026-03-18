const mongoose = require("mongoose");
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const Lab = require('../models/Lab');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const ComponentRequest=require('../models/ComponentRequest')
const Bill = require('../models/Bill');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../utils/s3');



exports.getAdminDashboard = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const now = new Date();
    const labObjectId = new mongoose.Types.ObjectId(String(labId));

    /* =============================
       INCHARGE NAME
    ============================= */
    const incharge = await Staff.findById(req.user._id || req.user.id).select('name');

    /* =============================
       TOTAL ITEMS IN LAB
    ============================= */
    const totalItems = await LabInventory.countDocuments({
      lab_id: labObjectId
    });

    /* =============================
       TRANSACTION STATS
    ============================= */
    const transactionStats = await Transaction.aggregate([
      {
        $match: {
          items: {
            $elemMatch: { lab_id: labObjectId }
          }
        }
      },
      {
        $group: {
          _id: null,
          total_transactions: { $sum: 1 },
          active_transactions: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
            }
          },
          overdue_transactions: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'active'] },
                    { $lt: ['$expected_return_date', now] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const stats = transactionStats[0] || {
      total_transactions: 0,
      active_transactions: 0,
      overdue_transactions: 0
    };

    /* =============================
       PENDING INCOMING TRANSFERS
    ============================= */
    const pendingTransfers = await Transaction.countDocuments({
      transaction_type: 'lab_transfer',
      target_lab_id: labObjectId,
      status: 'raised'
    });

    /* =============================
       PENDING COMPONENT REQUESTS
    ============================= */
    const pendingRequests = await ComponentRequest.countDocuments({
      lab_id: labObjectId,
      status: 'pending'
    });

    /* =============================
       DAMAGED ASSETS
    ============================= */
    const damagedAssets = await ItemAsset.countDocuments({
      lab_id: labObjectId,
      status: 'damaged'
    });

    /* =============================
       RESPONSE
    ============================= */
    return res.json({
      success: true,
      data: {
        incharge_name: incharge?.name || 'Incharge',
        inventory: {
          total_items: totalItems,
          active_transactions: stats.active_transactions,
          overdue_transactions: stats.overdue_transactions,
          total_transactions: stats.total_transactions
        },
        attention: {
          pending_incoming_transfers: pendingTransfers,
          pending_component_requests: pendingRequests,
          damaged_assets: damagedAssets
        }
      }
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard'
    });
  }
};


/* =========================
   INVENTORY MANAGEMENT
========================= */

/* ============================
   ADD ITEM (FINAL ENTERPRISE)
============================ */
exports.addItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    let {
      name,
      sku,
      category,
      description,
      tracking_type,
      initial_quantity,
      reserved_quantity = 0,
      vendor,
      invoice_number,
      is_student_visible = true
    } = req.body;

    if (!labId) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    if (!vendor) {
      return res.status(400).json({ error: 'Vendor is required' });
    }

    if (!/^[a-zA-Z0-9\s-]+$/.test(name)) {
      return res.status(400).json({
        error: 'Name can only contain letters, numbers, spaces or hyphens'
      });
    }

    name = name
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .trim();

    if (!/^[a-zA-Z0-9]+$/.test(sku)) {
      return res.status(400).json({
        error: 'SKU must contain only letters and numbers (no special characters)'
      });
    }

    sku = sku.toUpperCase().trim();

    const qty = Number(initial_quantity);
    const reservedQty = Number(reserved_quantity);

    if (!qty || qty <= 0) {
      return res.status(400).json({
        error: 'Initial quantity must be greater than 0'
      });
    }

    if (reservedQty < 0 || reservedQty > qty) {
      return res.status(400).json({
        error: 'Reserved quantity must be between 0 and initial quantity'
      });
    }

    let item = await Item.findOne({ sku });

    if (!item) {
      item = await Item.create({
        name,
        sku,
        category,
        description,
        tracking_type,
        total_quantity: 0,
        available_quantity: 0
      });
    }

    let inventory = await LabInventory.findOne({
      lab_id: labId,
      item_id: item._id
    });

    if (inventory) {

      inventory.total_quantity += qty;
      inventory.reserved_quantity += reservedQty;

      // 🔥 FIXED BULK LOGIC (no recompute)
      if (tracking_type === 'bulk') {
        inventory.available_quantity += (qty - reservedQty);
      }

      if (typeof is_student_visible === 'boolean') {
        inventory.is_student_visible = is_student_visible;
      }

      await inventory.save();

    } else {

      inventory = await LabInventory.create({
        lab_id: labId,
        item_id: item._id,
        total_quantity: qty,
        reserved_quantity: reservedQty,
        available_quantity: qty, // correct initial value
        is_student_visible
      });
    }

    /* ============================
       ASSET GENERATION (UNCHANGED)
    ============================ */

    const createdAssets = [];

    if (tracking_type === 'asset') {

      const lab = await Lab.findById(labId).lean();
      const labCode = lab.code;

      const lastAsset = await ItemAsset.findOne({
        item_id: item._id,
        lab_id: labId
      })
        .sort({ asset_tag: -1 })
        .lean();

      let lastSeq = 0;

      if (lastAsset?.asset_tag) {
        const match = lastAsset.asset_tag.match(/(\d+)$/);
        lastSeq = match ? parseInt(match[1]) : 0;
      }

      for (let i = 1; i <= qty; i++) {

        const newSeq = lastSeq + i;

        const assetTag =
          `${labCode}-${sku}-${String(newSeq).padStart(4, '0')}`;

        const asset = await ItemAsset.create({
          lab_id: labId,
          item_id: item._id,
          asset_tag: assetTag,
          vendor,
          invoice_number,
          status: 'available',
          condition: 'good'
        });

        createdAssets.push(asset.asset_tag);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Item added successfully',
      data: inventory,
      created_assets: createdAssets
    });

  } catch (err) {
    console.error('ADD ITEM ERROR:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


/* ============================
   UPDATE ITEM (FINAL ENTERPRISE)
============================ */
exports.updateItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (
      req.body.tracking_type &&
      req.body.tracking_type !== item.tracking_type
    ) {
      return res.status(400).json({
        error: 'Tracking type cannot be changed after item creation'
      });
    }

    const addQty = Number(req.body.add_quantity || 0);
    const newReserved =
      req.body.reserved_quantity !== undefined
        ? Number(req.body.reserved_quantity)
        : undefined;

    const createdAssets = [];

    const inventory = await LabInventory.findOne({
      lab_id: labId,
      item_id: item._id
    });

    if (!inventory) {
      return res.status(404).json({
        error: 'Item not found in this lab'
      });
    }

    /* ================= ADD STOCK ================= */

    if (addQty > 0) {

      if (item.tracking_type === 'bulk') {

        inventory.total_quantity += addQty;
        inventory.available_quantity += addQty;
      }

      if (item.tracking_type === 'asset') {

        if (!req.body.vendor) {
          return res.status(400).json({
            error: 'Vendor is required when adding new stock'
          });
        }

        const lab = await Lab.findById(labId).lean();
        const labCode = lab.code;

        const lastAsset = await ItemAsset.findOne({
          item_id: item._id,
          lab_id: labId
        })
          .sort({ asset_tag: -1 })
          .lean();

        let lastSeq = 0;

        if (lastAsset?.asset_tag) {
          const match = lastAsset.asset_tag.match(/(\d+)$/);
          lastSeq = match ? parseInt(match[1]) : 0;
        }

        for (let i = 1; i <= addQty; i++) {

          const newSeq = lastSeq + i;

          const assetTag =
            `${labCode}-${item.sku}-${String(newSeq).padStart(4, '0')}`;

          const asset = await ItemAsset.create({
            lab_id: labId,
            item_id: item._id,
            asset_tag: assetTag,
            vendor: req.body.vendor,
            invoice_number: req.body.invoice_number,
            status: 'available',
            condition: 'good'
          });

          createdAssets.push(asset.asset_tag);
        }

        inventory.total_quantity += addQty;
      }
    }

    /* ================= REMOVE STOCK (BULK ONLY) ================= */

    if (addQty < 0 && item.tracking_type === 'bulk') {

      const removeQty = Math.abs(addQty);

      if (removeQty > inventory.available_quantity) {
        return res.status(400).json({
          error: 'Cannot remove reserved or issued stock'
        });
      }

      inventory.total_quantity -= removeQty;
      inventory.available_quantity -= removeQty;
    }

    /* ================= UPDATE RESERVED ================= */

    if (newReserved !== undefined) {

      if (newReserved < 0 || newReserved > inventory.total_quantity) {
        return res.status(400).json({
          error: 'Reserved quantity must be between 0 and total quantity'
        });
      }

      const diff = newReserved - inventory.reserved_quantity;

      if (item.tracking_type === 'bulk') {

        if (diff > 0) {
          if (diff > inventory.available_quantity) {
            return res.status(400).json({
              error: 'Not enough available stock to reserve'
            });
          }
          inventory.available_quantity -= diff;
        }

        if (diff < 0) {
          inventory.available_quantity += Math.abs(diff);
        }
      }

      inventory.reserved_quantity = newReserved;
    }

    /* ================= 🔥 ASSET RE-CALCULATION ================= */

    if (item.tracking_type === 'asset') {

      const actualAvailable = await ItemAsset.countDocuments({
        lab_id: labId,
        item_id: item._id,
        status: 'available',
        condition: 'good'
      });

      inventory.available_quantity = actualAvailable;
    }

    if (typeof req.body.is_student_visible === 'boolean') {
      inventory.is_student_visible = req.body.is_student_visible;
    }

    await inventory.save();

    return res.json({
      success: true,
      inventory,
      created_assets: createdAssets
    });

  } catch (err) {
    console.error('UPDATE ITEM ERROR:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

/* ============================
   GET ITEM ASSETS (LAB SAFE)
============================ */
exports.getItemAssets = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const { id } = req.params;
    const { status } = req.query;

    const item = await Item.findById(id);
    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    if (item.tracking_type !== 'asset') {
      return res.status(400).json({
        error: 'This item does not support asset tracking'
      });
    }

    /* 🔒 LAB ISOLATION */
    const filter = {
      lab_id: labId,
      item_id: item._id
    };

    if (status) {
      filter.status = status;
    }

    const assets = await ItemAsset.find(filter)
      .select('asset_tag serial_no vendor invoice_number status condition createdAt')
      .sort({ asset_tag: 1 })
      .lean();

    return res.json({
      success: true,
      count: assets.length,
      data: assets
    });

  } catch (err) {
    console.error('GET ITEM ASSETS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch item assets'
    });
  }
};
/* ============================
   REMOVE ITEM FROM LAB (SAFE)
============================ */
exports.removeItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    /* ===============================
       CHECK LAB INVENTORY
    =============================== */
    const inventory = await require('../models/LabInventory').findOne({
      lab_id: labId,
      item_id: item._id
    });

    if (!inventory) {
      return res.status(404).json({
        error: 'Item not found in this lab'
      });
    }

    /* ===============================
       BLOCK IF ACTIVE TRANSACTIONS
    =============================== */
    const activeTxn = await Transaction.findOne({
      'items.item_id': item._id,
      'items.lab_id': labId,
      status: { $in: ['approved', 'active', 'overdue'] }
    });

    if (activeTxn) {
      return res.status(400).json({
        error: 'Cannot remove item with active transactions'
      });
    }

    /* ===============================
       BLOCK IF ISSUED ASSETS EXIST
    =============================== */
    if (item.tracking_type === 'asset') {
      const issuedAsset = await ItemAsset.findOne({
        lab_id: labId,
        item_id: item._id,
        status: 'issued'
      });

      if (issuedAsset) {
        return res.status(400).json({
          error: 'Cannot remove item with issued assets'
        });
      }
    }

    /* ===============================
       SOFT DELETE LAB INVENTORY
    =============================== */
    await require('../models/LabInventory').deleteOne({
      _id: inventory._id
    });

    /* ===============================
       RETIRE ALL LAB ASSETS
    =============================== */
    await ItemAsset.updateMany(
      {
        lab_id: labId,
        item_id: item._id
      },
      {
        $set: { status: 'retired', condition: 'broken' }
      }
    );

    /* ===============================
       OPTIONAL: DEACTIVATE GLOBAL ITEM
       ONLY IF NO LABS LEFT
    =============================== */
    const remainingLabs = await require('../models/LabInventory').countDocuments({
      item_id: item._id
    });

    if (remainingLabs === 0) {
      item.is_active = false;
      await item.save();
    }

    return res.json({
      success: true,
      message: 'Item removed from this lab successfully'
    });

  } catch (err) {
    console.error('REMOVE ITEM ERROR:', err);
    return res.status(500).json({
      error: err.message
    });
  }
};

/* ============================
   VIEW ALL ITEMS (LAB SAFE)
============================ */
exports.getAllItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const LabInventory = require('../models/LabInventory');

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const search = req.query.search?.trim();

    // Build match condition for populate
    let itemMatch = { is_active: true };

    if (search) {
      const regex = new RegExp(search, 'i'); // NOT prefix, full contains search
      itemMatch.$or = [
        { name: regex },
        { sku: regex },
        { category: regex }
      ];
    }

    const [totalItems, inventories] = await Promise.all([
      LabInventory.countDocuments({ lab_id: labId }), // unchanged
      LabInventory.find({ lab_id: labId })
        .populate({
          path: 'item_id',
          match: itemMatch,
          select: 'name sku category description tracking_type is_student_visible'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const data = inventories
      .filter(inv => inv.item_id)
      .map(inv => ({
        item_id: inv.item_id._id,
        name: inv.item_id.name,
        sku: inv.item_id.sku,
        category: inv.item_id.category,
        description: inv.item_id.description,
        tracking_type: inv.item_id.tracking_type,
        is_student_visible: inv.item_id.is_student_visible,

        total_quantity: inv.total_quantity,
        available_quantity: inv.available_quantity,
        reserved_quantity: inv.reserved_quantity,
        damaged_quantity: inv.damaged_quantity
      }));

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
    console.error('GET ALL ITEMS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch items'
    });
  }
};

/* ============================
   SEARCH ITEMS BY PREFIX
============================ */
exports.searchItemsByPrefix = async (req, res) => {
  try {
    let { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const normalizedName = q
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .trim();

    const normalizedSku = q
      .toUpperCase()
      .trim();

    const items = await Item.find({
      $or: [
        { name: { $regex: new RegExp(`^${normalizedName}`) } },
        { sku: { $regex: new RegExp(`^${normalizedSku}`) } }
      ],
      is_active: true
    })
      .select('name sku category description tracking_type')
      .limit(10)
      .lean();

    return res.json({
      success: true,
      count: items.length,
      data: items
    });

  } catch (err) {
    console.error('SEARCH ITEMS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch item'
    });
  }
};

exports.getTransactionHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    // Pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    // Run in parallel
    const [totalItems, transactions] = await Promise.all([
      Transaction.countDocuments({ 'items.lab_id': labId }), // same logic
      Transaction.find({ 'items.lab_id': labId })
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.asset_ids', 'asset_tag')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // Attach asset_tags array (same logic)
    const formatted = transactions.map(tx => ({
      ...tx,
      items: tx.items.map(item => ({
        ...item,
        asset_tags: item.asset_ids
          ? item.asset_ids.map(asset => asset.asset_tag)
          : []
      }))
    }));

    return res.json({
      success: true,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('GET TRANSACTION HISTORY ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch transaction history'
    });
  }
};

exports.searchTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const {
      transaction_id,
      reg_no,
      faculty_email,
      faculty_id,
      status,
      item_name,
      asset_tag,
      page = 1,
      limit = 25
    } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const Transaction = require('../models/Transaction');
    const Item = require('../models/Item');
    const ItemAsset = require('../models/ItemAsset');

    const filter = {
      'items.lab_id': labId
    };

    // Basic filters
    if (transaction_id) filter.transaction_id = transaction_id;
    if (reg_no) filter.student_reg_no = reg_no;
    if (faculty_email) filter.faculty_email = faculty_email;
    if (faculty_id) filter.faculty_id = faculty_id;
    if (status) filter.status = status;

    // 🔍 Search by item name
    if (item_name) {
      const items = await Item.find({
        name: new RegExp(item_name, 'i')
      }).select('_id');

      const itemIds = items.map(i => i._id);

      if (itemIds.length === 0) {
        return res.json({
          success: true,
          page: pageNum,
          limit: limitNum,
          totalItems: 0,
          totalPages: 0,
          count: 0,
          data: []
        });
      }

      filter['items.item_id'] = { $in: itemIds };
    }

    // 🔍 Search by asset tag
    if (asset_tag) {
      const assets = await ItemAsset.find({
        asset_tag: new RegExp(asset_tag, 'i')
      }).select('_id');

      const assetIds = assets.map(a => a._id);

      if (assetIds.length === 0) {
        return res.json({
          success: true,
          page: pageNum,
          limit: limitNum,
          totalItems: 0,
          totalPages: 0,
          count: 0,
          data: []
        });
      }

      filter['items.asset_ids'] = { $in: assetIds };
    }

    // Run queries in parallel
    const [totalItems, transactions] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.asset_ids', 'asset_tag')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    const formatted = transactions.map(tx => ({
      ...tx,
      items: tx.items.map(item => ({
        ...item,
        asset_tags: item.asset_ids
          ? item.asset_ids.map(asset => asset.asset_tag)
          : []
      }))
    }));

    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('SEARCH TRANSACTIONS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to search transactions'
    });
  }
};

/* ============================
   OVERDUE TRANSACTIONS (LAB SAFE)
============================ */
exports.getOverdueTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const overdue = await Transaction.find({
      status: 'overdue',
      'items.lab_id': labId
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('issued_by_incharge_id', 'name email')
      .sort({ expected_return_date: 1 })
      .lean();

    return res.json({
      success: true,
      count: overdue.length,
      data: overdue
    });

  } catch (err) {
    console.error('GET OVERDUE TRANSACTIONS ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch overdue transactions'
    });
  }
};

/* ============================
   GET SINGLE ITEM (LAB SAFE)
============================ */
exports.getItemById = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      is_active: true
    }).lean();

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    const LabInventory = require('../models/LabInventory');

    const inventory = await LabInventory.findOne({
      lab_id: labId,
      item_id: item._id
    }).lean();

    if (!inventory) {
      return res.status(404).json({
        error: 'Item not found in this lab'
      });
    }

    return res.json({
      success: true,
      data: {
        _id: item._id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        description: item.description,
        tracking_type: item.tracking_type,

        // 🔥 CORRECT SOURCE
        is_student_visible: inventory.is_student_visible,

        total_quantity: inventory.total_quantity,
        available_quantity: inventory.available_quantity,
        reserved_quantity: inventory.reserved_quantity,
        damaged_quantity: inventory.damaged_quantity
      }
    });

  } catch (err) {
    console.error('GET ITEM BY ID ERROR:', err);
    return res.status(500).json({
      error: 'Failed to fetch item'
    });
  }
};


exports.getLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    // Pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const baseFilter = {
      transaction_type: 'lab_session',
      'items.lab_id': labId
    };

    // Parallel execution
    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(baseFilter),
      Transaction.find(baseFilter)
        .populate('student_id', 'name reg_no email')
        .populate('issued_by_incharge_id', 'name email')
        .populate('items.item_id', 'name sku tracking_type')
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
      count: records.length,
      data: records
    });

  } catch (err) {
    console.error('Get lab sessions error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lab sessions'
    });
  }
};


exports.searchLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const {
      search,
      faculty_email,
      faculty_id,
      status,
      page = 1,
      limit = 25
    } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      transaction_type: 'lab_session',
      'items.lab_id': labId
    };

    // 🔍 Generic search (ID, slot, faculty)
    if (search) {
      const regex = new RegExp(search, 'i');

      filter.$or = [
        { transaction_id: regex },
        { lab_slot: regex },
        { faculty_email: regex },
        { faculty_id: regex }
      ];
    }

    // Specific filters
    if (faculty_email) filter.faculty_email = faculty_email;
    if (faculty_id) filter.faculty_id = faculty_id;
    if (status) filter.status = status;

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .populate('student_id', 'name reg_no email')
        .populate('issued_by_incharge_id', 'name email')
        .populate('items.item_id', 'name sku tracking_type')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
      count: records.length,
      data: records
    });

  } catch (err) {
    console.error('SEARCH LAB SESSIONS ERROR:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to search lab sessions'
    });
  }
};
/* ======================================
   LAB INCHARGE — GET SINGLE LAB SESSION (LAB SAFE)
====================================== */
exports.getLabSessionDetail = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const record = await Transaction.findOne({
      _id: req.params.id,
      transaction_type: 'lab_session',
      'items.lab_id': labId
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Lab session not found or unauthorized'
      });
    }

    return res.json({
      success: true,
      data: record
    });

  } catch (err) {
    console.error('Get lab session detail error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lab session'
    });
  }
};

/* ======================================
   LAB INCHARGE — GET ALL LAB TRANSFERS (LAB SAFE)
====================================== */
exports.getLabTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    // Pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const baseFilter = {
      transaction_type: 'lab_transfer',
      $or: [
        { 'items.lab_id': labId },
        { target_lab_id: labId }
      ]
    };

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(baseFilter),
      Transaction.find(baseFilter)
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.lab_id', 'name code')
        .populate('items.asset_ids', 'asset_tag') // ✅ ADD THIS
        .populate('target_lab_id', 'name code')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // ✅ Attach asset_tags (CONSISTENT FORMAT)
    const formatted = records.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    return res.json({
      success: true,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get lab transfers error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lab transfers'
    });
  }
};

exports.searchLabTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const {
      search,
      transfer_type,
      status,
      faculty_name,
      page = 1,
      limit = 25
    } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      transaction_type: 'lab_transfer',
      $or: [
        { 'items.lab_id': labId },
        { target_lab_id: labId }
      ]
    };

    // 🔍 Generic search
    if (search) {
      const regex = new RegExp(search, 'i');

      filter.$and = [
        {
          $or: [
            { transaction_id: regex },
            { target_lab_name_snapshot: regex },
            { handover_faculty_name: regex },
            { faculty_email: regex }
          ]
        }
      ];
    }

    // Filters
    if (transfer_type) filter.transfer_type = transfer_type;
    if (status) filter.status = status;

    if (faculty_name) {
      filter.handover_faculty_name = new RegExp(faculty_name, 'i');
    }

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.lab_id', 'name code')
        .populate('target_lab_id', 'name code')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
      count: records.length,
      data: records
    });

  } catch (err) {
    console.error('SEARCH LAB TRANSFERS ERROR:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to search lab transfers'
    });
  }
};

/* ======================================
   LAB INCHARGE — GET SINGLE LAB TRANSFER (LAB SAFE)
====================================== */
exports.getLabTransferDetail = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const record = await Transaction.findOne({
      _id: req.params.id,
      transaction_type: 'lab_transfer',
      $or: [
        { 'items.lab_id': labId },   // source lab
        { target_lab_id: labId }     // target lab
      ]
    })
      .populate('student_id', 'name reg_no email')
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('items.asset_ids', 'asset_tag') // 🔥 SAME AS OUTGOING
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Lab transfer not found or unauthorized'
      });
    }

    // ✅ SAME FORMAT AS OUTGOING TRANSFERS
    const formatted = {
      ...record,
      items: record.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    };

    return res.json({
      success: true,
      data: formatted
    });

  } catch (err) {
    console.error('GET LAB TRANSFER DETAIL ERROR:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lab transfer'
    });
  }
};


//feed back requests
exports.getAllComponentRequests = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const {
      status,
      urgency,
      category,
      student_reg_no,
      component_name
    } = req.query;

    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    /* ===============================
       BASE FILTER (LAB ISOLATION)
    =============================== */
    const filter = {
      lab_id: labId
    };

    /* ===============================
       OPTIONAL FILTERS
    =============================== */
    if (status) filter.status = status;
    if (urgency) filter.urgency = urgency;
    if (category) filter.category = category;
    if (student_reg_no) filter.student_reg_no = student_reg_no;
    if (component_name) {
      filter.component_name = new RegExp(component_name, 'i');
    }

    // Parallel execution
    const [totalItems, requests] = await Promise.all([
      ComponentRequest.countDocuments(filter),
      ComponentRequest.find(filter)
        .populate('student_id', 'name reg_no email')
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
      count: requests.length,
      data: requests
    });

  } catch (err) {
    console.error('Get component requests error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch component requests'
    });
  }
};

/* ============================
   GET SINGLE COMPONENT REQUEST (LAB SAFE)
============================ */
exports.getComponentRequestById = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const request = await ComponentRequest.findOne({
      _id: req.params.id,
      lab_id: labId
    })
      .populate('student_id', 'name reg_no email')
      .lean();

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Component request not found or unauthorized'
      });
    }

    return res.json({
      success: true,
      data: request
    });

  } catch (err) {
    console.error('Get component request error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch component request'
    });
  }
};
/* ============================
   UPDATE COMPONENT REQUEST STATUS (LAB SAFE)
============================ */
exports.updateComponentRequestStatus = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const { status, admin_remarks } = req.body;

    if (!['approved', 'rejected', 'reviewed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const request = await ComponentRequest.findOne({
      _id: req.params.id,
      lab_id: labId
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Component request not found or unauthorized'
      });
    }

    /* ===============================
       PREVENT RE-UPDATING FINAL STATES
    =============================== */
    if (['approved', 'rejected'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: 'Request already finalized'
      });
    }

    request.status = status;
    request.admin_remarks = admin_remarks || null;

    await request.save();

    return res.json({
      success: true,
      message: `Request ${status} successfully`,
      data: request
    });

  } catch (err) {
    console.error('Update component request error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update request'
    });
  }
};



/* ============================
   UPLOAD BILL (S3 + INVOICE)
============================ */
exports.uploadBill = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const { title, bill_type, bill_date, invoice_number } = req.body;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    if (!title || !bill_date || !invoice_number || !req.file) {
      return res.status(400).json({
        success: false,
        message: 'Title, bill date, invoice number and PDF file are required'
      });
    }

    const s3Key = `bills/${labId}/${Date.now()}-${req.file.originalname}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: 'application/pdf'
      })
    );

    const bill = await Bill.create({
      lab_id: labId,
      title,
      bill_type,
      invoice_number,
      bill_date: new Date(bill_date),
      s3_key: s3Key,
      s3_url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      uploaded_by: req.user.id
    });

    return res.status(201).json({
      success: true,
      message: 'Bill uploaded successfully',
      data: bill
    });

  } catch (err) {
    console.error('Upload bill error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload bill'
    });
  }
};

/* ============================
   GET BILLS (ADVANCED FILTERING)
============================ */
exports.getBills = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const {
      month,
      from,
      to,
      date,
      invoice_number,
      bill_type
    } = req.query;

    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const filter = {
      lab_id: labId
    };

    /* ===============================
       FILTER BY INVOICE NUMBER
    =============================== */
    if (invoice_number) {
      filter.invoice_number = invoice_number;
    }

    /* ===============================
       FILTER BY BILL TYPE
    =============================== */
    if (bill_type) {
      filter.bill_type = bill_type;
    }

    /* ===============================
       FILTER BY PARTICULAR DATE
    =============================== */
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);

      filter.bill_date = {
        $gte: start,
        $lt: end
      };
    }

    /* ===============================
       MONTH FILTER (YYYY-MM)
    =============================== */
    if (month) {
      const [y, m] = month.split('-');

      const start = new Date(`${y}-${m}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      filter.bill_date = {
        $gte: start,
        $lt: end
      };
    }

    /* ===============================
       DATE RANGE FILTER
    =============================== */
    if (from && to) {
      filter.bill_date = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }

    // Parallel execution
    const [totalItems, bills] = await Promise.all([
      Bill.countDocuments(filter),
      Bill.find(filter)
        .populate('uploaded_by', 'name email')
        .sort({ bill_date: -1, createdAt: -1 })
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
      count: bills.length,
      data: bills
    });

  } catch (err) {
    console.error('Get bills error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bills'
    });
  }
};
/* ============================
   DOWNLOAD / VIEW BILL (LAB SAFE)
============================ */
exports.downloadBill = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const bill = await Bill.findOne({
      _id: req.params.id,
      lab_id: labId
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found or unauthorized'
      });
    }

    const stream = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: bill.s3_key
      })
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${bill.title}.pdf"`
    );

    stream.Body.pipe(res);

  } catch (err) {
    console.error('Download bill error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to download bill'
    });
  }
};


exports.getDamagedAssetHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const { item, vendor, status, from, to } = req.query;

    const matchStage = {};

    /* =====================
       STATUS FILTER
    ===================== */
    if (status) {
      matchStage.status = status;
    }

    /* =====================
       DATE RANGE FILTER
    ===================== */
    if (from || to) {
      matchStage.reported_at = {};
      if (from) matchStage.reported_at.$gte = new Date(from);
      if (to) matchStage.reported_at.$lte = new Date(to);
    }

    /* =====================
       AGGREGATION PIPELINE
    ===================== */
    const pipeline = [
      { $match: matchStage },

      /* ===== JOIN ITEM ASSET ===== */
      {
        $lookup: {
          from: 'itemassets',
          localField: 'asset_id',
          foreignField: '_id',
          as: 'asset'
        }
      },
      { $unwind: '$asset' },

      /* 🔒 LAB ISOLATION */
      {
        $match: {
          'asset.lab_id': labId
        }
      },

      /* ===== JOIN ITEM ===== */
      {
        $lookup: {
          from: 'items',
          localField: 'asset.item_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' }
    ];

    /* =====================
       ITEM NAME FILTER
    ===================== */
    if (item) {
      pipeline.push({
        $match: {
          'item.name': { $regex: item, $options: 'i' }
        }
      });
    }

    /* =====================
       VENDOR FILTER (FIXED)
    ===================== */
    if (vendor) {
      pipeline.push({
        $match: {
          'asset.vendor': { $regex: vendor, $options: 'i' }
        }
      });
    }

    /* =====================
       FINAL PROJECTION
    ===================== */
    pipeline.push(
      {
        $project: {
          _id: 1,

          asset_tag: '$asset.asset_tag',
          serial_no: '$asset.serial_no',
          asset_status: '$asset.status',
          asset_condition: '$asset.condition',
          vendor: '$asset.vendor',

          item_name: '$item.name',
          sku: '$item.sku',
          category: '$item.category',

          damage_status: '$status',
          damage_reason: '$damage_reason',
          remarks: '$remarks',
          reported_at: 1,

          faculty_email: 1,
          faculty_id: 1,
          student_id: 1
        }
      },
      { $sort: { reported_at: -1 } }
    );

    const records = await DamagedAssetLog.aggregate(pipeline);

    return res.json({
      success: true,
      count: records.length,
      data: records
    });

  } catch (error) {
    console.error('Damaged asset history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch damaged asset history'
    });
  }
};


// lab transfer routes
exports.getAllLabs = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    const labs = await Lab.find({
      _id: { $ne: labId },
      is_active: true
    }).select('name code location');

    res.json({ success: true, data: labs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch labs' });
  }
};

/* =========================
   GET LAB AVAILABLE ITEMS
   (RESERVED SAFE)
========================= */
exports.getLabAvailableItems = async (req, res) => {
  try {
    const { labId } = req.params;

    const inventory = await LabInventory.find({
      lab_id: labId
    })
      .populate('item_id', 'name sku tracking_type is_student_visible')
      .lean();

    // Recalculate effective availability
    const filtered = inventory
      .map(inv => {
        const effectiveAvailable =
          inv.total_quantity - (inv.reserved_quantity || 0);

        return {
          ...inv,
          available_quantity: effectiveAvailable
        };
      })
      .filter(inv => inv.available_quantity > 0);

    res.json({
      success: true,
      count: filtered.length,
      data: filtered
    });

  } catch (err) {
    console.error('GET LAB AVAILABLE ITEMS ERROR:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch items'
    });
  }
};

exports.createTransferRequest = async (req, res) => {
  try {
    const sourceLabId = req.user.lab_id;

    const {
      target_lab_id,
      items,
      transfer_type,
      expected_return_date
    } = req.body;

    if (
      !sourceLabId ||
      sourceLabId.toString() === target_lab_id.toString()
    ) {
      return res.status(400).json({ message: 'Invalid target lab' });
    }

    const transaction = await Transaction.create({
      transaction_id: `TR-${Date.now()}`,
      project_name: 'Lab Transfer',
      transaction_type: 'lab_transfer',
      transfer_type,
      source_lab_id: sourceLabId,
      target_lab_id,
      student_reg_no: 'LAB-TRANSFER',
      status: 'raised',
      expected_return_date:
        transfer_type === 'temporary'
          ? new Date(expected_return_date)
          : null,
      items: items.map(i => ({
        lab_id: target_lab_id,
        item_id: i.item_id,
        quantity: i.quantity
      }))
    });

    res.status(201).json({ success: true, data: transaction });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getIncomingTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    const transfers = await Transaction.find({
      transaction_type: 'lab_transfer',
      target_lab_id: labId,
      status: { $in: ['raised', 'active', 'return_requested', 'completed'] }
    })
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag') // 🔥 IMPORTANT
      .sort({ createdAt: -1 })
      .lean();

    // Attach asset_tags
    const formatted = transfers.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    res.json({
      success: true,
      data: formatted
    });

  } catch (err) {
    console.error('GET INCOMING TRANSFERS ERROR:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incoming transfers'
    });
  }
};

exports.getOutgoingTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    const transfers = await Transaction.find({
      transaction_type: 'lab_transfer',
      source_lab_id: labId
    })
      .populate('target_lab_id', 'name code location')
      .populate('source_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag') // 🔥 IMPORTANT
      .sort({ createdAt: -1 })
      .lean();

    const formatted = transfers.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('GET OUTGOING TRANSFERS ERROR:', err);
    res.status(500).json({ success: false });
  }
};

exports.decideTransferRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const labId = new mongoose.Types.ObjectId(req.user.lab_id);
    const { decision, reason } = req.body;

    const transaction = await Transaction.findById(req.params.id).session(session);

    if (
      !transaction ||
      !transaction.target_lab_id ||
      transaction.target_lab_id.toString() !== labId.toString()
    ) {
      throw new Error('Unauthorized');
    }

    /* =========================
       REJECT FLOW
    ========================= */
    if (decision === 'rejected') {
      transaction.status = 'rejected';
      transaction.faculty_approval = {
        ...transaction.faculty_approval,
        rejected_reason: reason || ''
      };

      await transaction.save({ session });
      await session.commitTransaction();

      return res.json({ success: true });
    }

    if (decision !== 'approved') {
      throw new Error('Invalid decision');
    }

    /* =========================
       APPROVAL FLOW
    ========================= */

    const allocatedTagsMap = {}; // store tags for response only

    for (const item of transaction.items) {

      const inventory = await LabInventory.findOne({
        lab_id: labId,
        item_id: item.item_id
      }).session(session);

      if (!inventory || inventory.available_quantity < item.quantity) {
        throw new Error('Insufficient stock');
      }

      const itemDef = await Item.findById(item.item_id).session(session);

      if (!itemDef) {
        throw new Error('Item not found');
      }

      /* ================= BULK ================= */
      if (itemDef.tracking_type === 'bulk') {

        inventory.available_quantity -= item.quantity;

        if (transaction.transfer_type === 'permanent') {
          inventory.total_quantity -= item.quantity;

          await LabInventory.findOneAndUpdate(
            {
              lab_id: transaction.source_lab_id,
              item_id: item.item_id
            },
            {
              $inc: {
                total_quantity: item.quantity,
                available_quantity: item.quantity
              }
            },
            { upsert: true, session }
          );
        }

        await inventory.save({ session });
      }

      /* ================= ASSET ================= */
      if (itemDef.tracking_type === 'asset') {

        const assets = await ItemAsset.find({
          lab_id: labId,
          item_id: item.item_id,
          status: 'available'
        })
          .limit(item.quantity)
          .session(session);

        if (assets.length < item.quantity) {
          throw new Error('Not enough assets available');
        }

        // Store asset IDs in DB
        item.asset_ids = assets.map(a => a._id);

        // Store tags only for response
        allocatedTagsMap[item.item_id.toString()] =
          assets.map(a => a.asset_tag);

        for (const asset of assets) {

          if (transaction.transfer_type === 'permanent') {
            asset.lab_id = transaction.source_lab_id;
            asset.status = 'available';
          } else {
            asset.status = 'issued';
          }

          await asset.save({ session });
        }

        inventory.available_quantity -= item.quantity;

        if (transaction.transfer_type === 'permanent') {
          inventory.total_quantity -= item.quantity;
        }

        await inventory.save({ session });
      }
    }

    transaction.status = 'active';
    transaction.issued_at = new Date();

    await transaction.save({ session });
    await session.commitTransaction();

    /* =========================
       POPULATE FOR RESPONSE
    ========================= */

  /* =========================
    POPULATE FOR RESPONSE
  ========================= */

  const populated = await Transaction.findById(transaction._id)
    .populate('items.item_id', 'name sku tracking_type')
    .populate('items.asset_ids', 'asset_tag')
    .lean();

  // Attach asset tags from populated asset_ids
  populated.items = populated.items.map(i => ({
    ...i,
    asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
  }));

  return res.json({
    success: true,
    data: populated
  });
  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({
      success: false,
      message: err.message
    });
  } finally {
    session.endSession();
  }
};
exports.initiateReturn = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    const transaction = await Transaction.findById(req.params.id);

    if (!transaction ||
        !transaction.source_lab_id.equals(labId) ||
        transaction.transfer_type !== 'temporary' ||
        transaction.status !== 'active') {
      return res.status(400).json({ message: 'Invalid request' });
    }

    transaction.status = 'return_requested';
    await transaction.save();

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
};

exports.completeReturn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const labId = req.user.lab_id;

    const transaction = await Transaction.findById(req.params.id).session(session);

    if (!transaction ||
        !transaction.target_lab_id.equals(labId) ||
        transaction.status !== 'return_requested') {
      throw new Error('Invalid request');
    }

    for (const item of transaction.items) {

      const inventory = await LabInventory.findOne({
        lab_id: labId,
        item_id: item.item_id
      }).session(session);

      const itemDef = await Item.findById(item.item_id);

      if (itemDef.tracking_type === 'bulk') {
        inventory.available_quantity += item.quantity;
      }

      if (itemDef.tracking_type === 'asset') {
        await ItemAsset.updateMany(
          { _id: { $in: item.asset_ids } },
          { $set: { status: 'available' } },
          { session }
        );

        inventory.available_quantity += item.asset_ids.length;
      }

      await inventory.save({ session });
    }

    transaction.status = 'completed';
    transaction.actual_return_date = new Date();
    await transaction.save({ session });

    await session.commitTransaction();

    res.json({ success: true });

  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};


