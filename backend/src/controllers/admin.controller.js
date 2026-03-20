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
const ComponentRequest = require('../models/ComponentRequest');
const Bill = require('../models/Bill');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../utils/s3');

/* ============================
   SHARED HELPER — asset merge stage
   Replaces raw asset_ids ObjectIds with full objects { _id, asset_tag, serial_no, status }
   AND keeps asset_tags as flat string array for convenience
============================ */
const assetMergeStage = {
  $addFields: {
    items: {
      $map: {
        input: '$items',
        as: 'item',
        in: {
          $mergeObjects: [
            '$$item',
            {
              // ✅ Replace raw ObjectIds with full asset objects
              asset_ids: {
                $filter: {
                  input: '$_assetDefs',
                  as: 'asset',
                  cond: {
                    $in: ['$$asset._id', { $ifNull: ['$$item.asset_ids', []] }]
                  }
                }
              },
              // ✅ Flat string array for easy display
              asset_tags: {
                $map: {
                  input: {
                    $filter: {
                      input: '$_assetDefs',
                      as: 'asset',
                      cond: {
                        $in: ['$$asset._id', { $ifNull: ['$$item.asset_ids', []] }]
                      }
                    }
                  },
                  as: 'a',
                  in: '$$a.asset_tag'
                }
              },
              // ✅ Replace raw item_id ObjectId with full item object
              item_id: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$_itemDefs',
                      as: 'def',
                      cond: { $eq: ['$$def._id', '$$item.item_id'] }
                    }
                  },
                  0
                ]
              }
            }
          ]
        }
      }
    }
  }
};

exports.getAdminDashboard = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const now = new Date();
    const labObjectId = new mongoose.Types.ObjectId(String(labId));

    const incharge = await Staff.findById(req.user._id || req.user.id).select('name');

    const totalItems = await LabInventory.countDocuments({ lab_id: labObjectId });

    const transactionStats = await Transaction.aggregate([
      { $match: { items: { $elemMatch: { lab_id: labObjectId } } } },
      {
        $group: {
          _id: null,
          total_transactions: { $sum: 1 },
          active_transactions: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          overdue_transactions: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'active'] }, { $lt: ['$expected_return_date', now] }] },
                1, 0
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

    const pendingTransfers = await Transaction.countDocuments({
      transaction_type: 'lab_transfer',
      target_lab_id: labObjectId,
      status: 'raised'
    });

    const pendingRequests = await ComponentRequest.countDocuments({
      lab_id: labObjectId,
      status: 'pending'
    });

    const damagedAssets = await ItemAsset.countDocuments({
      lab_id: labObjectId,
      status: 'damaged'
    });

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
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
  }
};

/* ============================
   ADD ITEM
============================ */
exports.addItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    let {
      name, sku, category, description, tracking_type,
      initial_quantity, reserved_quantity = 0, vendor,
      invoice_number, is_student_visible = true
    } = req.body;

    if (!labId) return res.status(403).json({ error: 'Lab access denied' });
    if (!vendor) return res.status(400).json({ error: 'Vendor is required' });

    if (!/^[a-zA-Z0-9\s-]+$/.test(name)) {
      return res.status(400).json({ error: 'Name can only contain letters, numbers, spaces or hyphens' });
    }

    name = name.toLowerCase().replace(/[\s-]+/g, '_').trim();

    if (!/^[a-zA-Z0-9]+$/.test(sku)) {
      return res.status(400).json({ error: 'SKU must contain only letters and numbers' });
    }

    sku = sku.toUpperCase().trim();

    const qty = Number(initial_quantity);
    const reservedQty = Number(reserved_quantity);

    if (!qty || qty <= 0) return res.status(400).json({ error: 'Initial quantity must be greater than 0' });
    if (reservedQty < 0 || reservedQty > qty) return res.status(400).json({ error: 'Reserved quantity must be between 0 and initial quantity' });

    let item = await Item.findOne({ sku });

    if (!item) {
      item = await Item.create({
        name, sku, category, description, tracking_type,
        total_quantity: 0, available_quantity: 0
      });
    }

    let inventory = await LabInventory.findOne({ lab_id: labId, item_id: item._id });

    if (inventory) {
      inventory.total_quantity += qty;
      inventory.reserved_quantity += reservedQty;
      if (tracking_type === 'bulk') {
        inventory.available_quantity += (qty - reservedQty);
      }
      if (typeof is_student_visible === 'boolean') {
        inventory.is_student_visible = is_student_visible;
      }
      await inventory.save();
    } else {
      inventory = await LabInventory.create({
        lab_id: labId, item_id: item._id,
        total_quantity: qty, reserved_quantity: reservedQty,
        available_quantity: qty, is_student_visible
      });
    }

    const createdAssets = [];

    if (tracking_type === 'asset') {
      const lab = await Lab.findById(labId).lean();
      const labCode = lab.code;

      const lastAsset = await ItemAsset.findOne({ item_id: item._id, lab_id: labId })
        .sort({ asset_tag: -1 }).lean();

      let lastSeq = 0;
      if (lastAsset?.asset_tag) {
        const match = lastAsset.asset_tag.match(/(\d+)$/);
        lastSeq = match ? parseInt(match[1]) : 0;
      }

      for (let i = 1; i <= qty; i++) {
        const assetTag = `${labCode}-${sku}-${String(lastSeq + i).padStart(4, '0')}`;
        const asset = await ItemAsset.create({
          lab_id: labId, item_id: item._id, asset_tag: assetTag,
          vendor, invoice_number, status: 'available', condition: 'good'
        });
        createdAssets.push(asset.asset_tag);
      }
    }

    return res.status(201).json({
      success: true, message: 'Item added successfully',
      data: inventory, created_assets: createdAssets
    });

  } catch (err) {
    console.error('ADD ITEM ERROR:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ============================
   UPDATE ITEM
============================ */
exports.updateItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (req.body.tracking_type && req.body.tracking_type !== item.tracking_type) {
      return res.status(400).json({ error: 'Tracking type cannot be changed after item creation' });
    }

    const addQty = Number(req.body.add_quantity || 0);
    const newReserved = req.body.reserved_quantity !== undefined
      ? Number(req.body.reserved_quantity) : undefined;

    const createdAssets = [];

    const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item._id });
    if (!inventory) return res.status(404).json({ error: 'Item not found in this lab' });

    if (addQty > 0) {
      if (item.tracking_type === 'bulk') {
        inventory.total_quantity += addQty;
        inventory.available_quantity += addQty;
      }

      if (item.tracking_type === 'asset') {
        if (!req.body.vendor) return res.status(400).json({ error: 'Vendor is required when adding new stock' });

        const lab = await Lab.findById(labId).lean();
        const lastAsset = await ItemAsset.findOne({ item_id: item._id, lab_id: labId })
          .sort({ asset_tag: -1 }).lean();

        let lastSeq = 0;
        if (lastAsset?.asset_tag) {
          const match = lastAsset.asset_tag.match(/(\d+)$/);
          lastSeq = match ? parseInt(match[1]) : 0;
        }

        for (let i = 1; i <= addQty; i++) {
          const assetTag = `${lab.code}-${item.sku}-${String(lastSeq + i).padStart(4, '0')}`;
          const asset = await ItemAsset.create({
            lab_id: labId, item_id: item._id, asset_tag: assetTag,
            vendor: req.body.vendor, invoice_number: req.body.invoice_number,
            status: 'available', condition: 'good'
          });
          createdAssets.push(asset.asset_tag);
        }
        inventory.total_quantity += addQty;
      }
    }

    if (addQty < 0 && item.tracking_type === 'bulk') {
      const removeQty = Math.abs(addQty);
      if (removeQty > inventory.available_quantity) {
        return res.status(400).json({ error: 'Cannot remove reserved or issued stock' });
      }
      inventory.total_quantity -= removeQty;
      inventory.available_quantity -= removeQty;
    }

    if (newReserved !== undefined) {
      if (newReserved < 0 || newReserved > inventory.total_quantity) {
        return res.status(400).json({ error: 'Reserved quantity must be between 0 and total quantity' });
      }
      const diff = newReserved - inventory.reserved_quantity;
      if (item.tracking_type === 'bulk') {
        if (diff > 0) {
          if (diff > inventory.available_quantity) {
            return res.status(400).json({ error: 'Not enough available stock to reserve' });
          }
          inventory.available_quantity -= diff;
        }
        if (diff < 0) inventory.available_quantity += Math.abs(diff);
      }
      inventory.reserved_quantity = newReserved;
    }

    if (item.tracking_type === 'asset') {
      const actualAvailable = await ItemAsset.countDocuments({
        lab_id: labId, item_id: item._id, status: 'available', condition: 'good'
      });
      inventory.available_quantity = actualAvailable;
    }

    if (typeof req.body.is_student_visible === 'boolean') {
      inventory.is_student_visible = req.body.is_student_visible;
    }

    await inventory.save();

    return res.json({ success: true, inventory, created_assets: createdAssets });

  } catch (err) {
    console.error('UPDATE ITEM ERROR:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* ============================
   GET ITEM ASSETS
============================ */
exports.getItemAssets = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const { id } = req.params;
    const { status } = req.query;

    const item = await Item.findById(id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.tracking_type !== 'asset') return res.status(400).json({ error: 'This item does not support asset tracking' });

    const filter = { lab_id: labId, item_id: item._id };
    if (status) filter.status = status;

    const assets = await ItemAsset.find(filter)
      .select('asset_tag serial_no vendor invoice_number status condition createdAt')
      .sort({ asset_tag: 1 }).lean();

    return res.json({ success: true, count: assets.length, data: assets });

  } catch (err) {
    console.error('GET ITEM ASSETS ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch item assets' });
  }
};

/* ============================
   REMOVE ITEM
============================ */
exports.removeItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item._id });
    if (!inventory) return res.status(404).json({ error: 'Item not found in this lab' });

    const activeTxn = await Transaction.findOne({
      'items.item_id': item._id, 'items.lab_id': labId,
      status: { $in: ['approved', 'active', 'overdue'] }
    });
    if (activeTxn) return res.status(400).json({ error: 'Cannot remove item with active transactions' });

    if (item.tracking_type === 'asset') {
      const issuedAsset = await ItemAsset.findOne({ lab_id: labId, item_id: item._id, status: 'issued' });
      if (issuedAsset) return res.status(400).json({ error: 'Cannot remove item with issued assets' });
    }

    await LabInventory.deleteOne({ _id: inventory._id });
    await ItemAsset.updateMany(
      { lab_id: labId, item_id: item._id },
      { $set: { status: 'retired', condition: 'broken' } }
    );

    const remainingLabs = await LabInventory.countDocuments({ item_id: item._id });
    if (remainingLabs === 0) {
      item.is_active = false;
      await item.save();
    }

    return res.json({ success: true, message: 'Item removed from this lab successfully' });

  } catch (err) {
    console.error('REMOVE ITEM ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
};

/* ============================
   GET ALL ITEMS
============================ */
exports.getAllItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    let itemMatch = { is_active: true };
    if (search) {
      const regex = new RegExp(search, 'i');
      itemMatch.$or = [{ name: regex }, { sku: regex }, { category: regex }];
    }

    const [totalItems, inventories] = await Promise.all([
      LabInventory.countDocuments({ lab_id: labId }),
      LabInventory.find({ lab_id: labId })
        .populate({ path: 'item_id', match: itemMatch, select: 'name sku category description tracking_type is_student_visible' })
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
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
      success: true, page, limit, totalItems,
      totalPages: Math.ceil(totalItems / limit), count: data.length, data
    });

  } catch (err) {
    console.error('GET ALL ITEMS ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch items' });
  }
};

/* ============================
   SEARCH ITEMS BY PREFIX
============================ */
exports.searchItemsByPrefix = async (req, res) => {
  try {
    let { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, count: 0, data: [] });

    const normalizedName = q.toLowerCase().replace(/[\s-]+/g, '_').trim();
    const normalizedSku = q.toUpperCase().trim();

    const items = await Item.find({
      $or: [
        { name: { $regex: new RegExp(`^${normalizedName}`) } },
        { sku: { $regex: new RegExp(`^${normalizedSku}`) } }
      ],
      is_active: true
    }).select('name sku category description tracking_type').limit(10).lean();

    return res.json({ success: true, count: items.length, data: items });

  } catch (err) {
    console.error('SEARCH ITEMS ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch item' });
  }
};

/* ============================
   GET TRANSACTION HISTORY
============================ */
exports.getTransactionHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { 'items.lab_id': labObjectId } },

      // Filter items to this lab only
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: { $eq: ['$$item.lab_id', labObjectId] }
            }
          }
        }
      },

      // Lookup student
      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },

      // Lookup incharge
      {
        $lookup: {
          from: 'staff', localField: 'issued_by_incharge_id', foreignField: '_id', as: 'issued_by_incharge_id',
          pipeline: [{ $project: { name: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$issued_by_incharge_id', preserveNullAndEmptyArrays: true } },

      // Lookup item definitions
      {
        $lookup: {
          from: 'items', localField: 'items.item_id', foreignField: '_id', as: '_itemDefs',
          pipeline: [{ $project: { name: 1, sku: 1, tracking_type: 1 } }]
        }
      },

      // Lookup asset details — include _id, asset_tag, serial_no, status
      {
        $lookup: {
          from: 'itemassets', localField: 'items.asset_ids', foreignField: '_id', as: '_assetDefs',
          pipeline: [{ $project: { asset_tag: 1, serial_no: 1, status: 1 } }]
        }
      },

      // ✅ Merge item defs + full asset objects + flat asset_tags
      assetMergeStage,

      { $project: { _itemDefs: 0, _assetDefs: 0 } },
      { $sort: { createdAt: -1 } },

      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const result = await Transaction.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return res.json({
      success: true, page, limit,
      totalItems: total, totalPages: Math.ceil(total / limit),
      count: data.length, data
    });

  } catch (err) {
    console.error('GET TRANSACTION HISTORY ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
};

/* ============================
   SEARCH TRANSACTIONS
============================ */
exports.searchTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));

    const {
      transaction_id, reg_no, faculty_email, faculty_id,
      status, item_name, asset_tag, page = 1, limit = 25
    } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    // Pre-resolve item_name
    let itemIdFilter = null;
    if (item_name) {
      const matchedItems = await Item.find({ name: new RegExp(item_name, 'i') }).select('_id').lean();
      if (matchedItems.length === 0) return res.json({ success: true, page: pageNum, limit: limitNum, totalItems: 0, totalPages: 0, count: 0, data: [] });
      itemIdFilter = matchedItems.map(i => i._id);
    }

    // Pre-resolve asset_tag
    let assetIdFilter = null;
    if (asset_tag) {
      const matchedAssets = await ItemAsset.find({ lab_id: labObjectId, asset_tag: new RegExp(asset_tag, 'i') }).select('_id').lean();
      if (matchedAssets.length === 0) return res.json({ success: true, page: pageNum, limit: limitNum, totalItems: 0, totalPages: 0, count: 0, data: [] });
      assetIdFilter = matchedAssets.map(a => a._id);
    }

    const matchStage = { 'items.lab_id': labObjectId };
    if (transaction_id) matchStage.transaction_id = transaction_id;
    if (reg_no)         matchStage.student_reg_no = reg_no;
    if (faculty_email)  matchStage.faculty_email = faculty_email;
    if (faculty_id)     matchStage.faculty_id = faculty_id;
    if (status)         matchStage.status = status;

    const itemFilterConditions = [{ $eq: ['$$item.lab_id', labObjectId] }];

    if (itemIdFilter) {
      itemFilterConditions.push({ $in: ['$$item.item_id', itemIdFilter] });
    }

    if (assetIdFilter) {
      itemFilterConditions.push({
        $gt: [
          {
            $size: {
              $ifNull: [
                { $filter: { input: { $ifNull: ['$$item.asset_ids', []] }, as: 'aid', cond: { $in: ['$$aid', assetIdFilter] } } },
                []
              ]
            }
          },
          0
        ]
      });
    }

    const pipeline = [
      { $match: matchStage },

      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: { $and: itemFilterConditions }
            }
          }
        }
      },

      { $match: { 'items.0': { $exists: true } } },

      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'staff', localField: 'issued_by_incharge_id', foreignField: '_id', as: 'issued_by_incharge_id',
          pipeline: [{ $project: { name: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$issued_by_incharge_id', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'items', localField: 'items.item_id', foreignField: '_id', as: '_itemDefs',
          pipeline: [{ $project: { name: 1, sku: 1, tracking_type: 1 } }]
        }
      },

      {
        $lookup: {
          from: 'itemassets', localField: 'items.asset_ids', foreignField: '_id', as: '_assetDefs',
          pipeline: [{ $project: { asset_tag: 1, serial_no: 1, status: 1 } }]
        }
      },

      // ✅ Full asset objects + flat tags
      assetMergeStage,

      { $project: { _itemDefs: 0, _assetDefs: 0 } },
      { $sort: { createdAt: -1 } },

      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limitNum }]
        }
      }
    ];

    const result = await Transaction.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return res.json({
      success: true, page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: data.length, data
    });

  } catch (err) {
    console.error('SEARCH TRANSACTIONS ERROR:', err);
    return res.status(500).json({ error: 'Failed to search transactions' });
  }
};

/* ============================
   GET OVERDUE TRANSACTIONS
============================ */
exports.getOverdueTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const now = new Date();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const pipeline = [
      {
        $match: {
          status: { $in: ['overdue', 'active', 'partial_returned'] },
          expected_return_date: { $lt: now },
          'items.lab_id': labObjectId
        }
      },

      // Filter items: this lab only + unreturned only
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: {
                $and: [
                  { $eq: ['$$item.lab_id', labObjectId] },
                  {
                    $gt: [
                      { $subtract: [{ $ifNull: ['$$item.issued_quantity', 0] }, { $ifNull: ['$$item.returned_quantity', 0] }] },
                      0
                    ]
                  }
                ]
              }
            }
          }
        }
      },

      { $match: { 'items.0': { $exists: true } } },

      // Add pending_return_quantity per item
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    pending_return_quantity: {
                      $subtract: [
                        { $ifNull: ['$$item.issued_quantity', 0] },
                        { $ifNull: ['$$item.returned_quantity', 0] }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },

      // Lookup student
      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },

      // ✅ Fixed: was accidentally unwinding student_id again instead of incharge
      {
        $lookup: {
          from: 'staff', localField: 'issued_by_incharge_id', foreignField: '_id', as: 'issued_by_incharge_id',
          pipeline: [{ $project: { name: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$issued_by_incharge_id', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'items', localField: 'items.item_id', foreignField: '_id', as: '_itemDefs',
          pipeline: [{ $project: { name: 1, sku: 1, tracking_type: 1 } }]
        }
      },

      {
        $lookup: {
          from: 'itemassets', localField: 'items.asset_ids', foreignField: '_id', as: '_assetDefs',
          pipeline: [{ $project: { asset_tag: 1, serial_no: 1, status: 1 } }]
        }
      },

      // ✅ Full asset objects + flat tags
      assetMergeStage,

      { $project: { _itemDefs: 0, _assetDefs: 0 } },
      { $sort: { expected_return_date: 1 } },

      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    ];

    const result = await Transaction.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return res.json({
      success: true, page, limit,
      totalItems: total, totalPages: Math.ceil(total / limit),
      count: data.length, data
    });

  } catch (err) {
    console.error('GET OVERDUE TRANSACTIONS ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch overdue transactions' });
  }
};

/* ============================
   GET SINGLE ITEM
============================ */
exports.getItemById = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const item = await Item.findOne({ _id: req.params.id, is_active: true }).lean();
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item._id }).lean();
    if (!inventory) return res.status(404).json({ error: 'Item not found in this lab' });

    return res.json({
      success: true,
      data: {
        _id: item._id, name: item.name, sku: item.sku,
        category: item.category, description: item.description,
        tracking_type: item.tracking_type,
        is_student_visible: inventory.is_student_visible,
        total_quantity: inventory.total_quantity,
        available_quantity: inventory.available_quantity,
        reserved_quantity: inventory.reserved_quantity,
        damaged_quantity: inventory.damaged_quantity
      }
    });

  } catch (err) {
    console.error('GET ITEM BY ID ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch item' });
  }
};

/* ============================
   GET LAB SESSIONS
============================ */
exports.getLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const baseFilter = { transaction_type: 'lab_session', 'items.lab_id': labId };

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(baseFilter),
      Transaction.find(baseFilter)
        .populate('student_id', 'name reg_no email')
        .populate('issued_by_incharge_id', 'name email')
        .populate('items.item_id', 'name sku tracking_type')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    return res.json({
      success: true, page, limit, totalItems,
      totalPages: Math.ceil(totalItems / limit), count: records.length, data: records
    });

  } catch (err) {
    console.error('Get lab sessions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab sessions' });
  }
};

/* ============================
   SEARCH LAB SESSIONS
============================ */
exports.searchLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { search, faculty_email, faculty_id, status, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { transaction_type: 'lab_session', 'items.lab_id': labId };

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ transaction_id: regex }, { lab_slot: regex }, { faculty_email: regex }, { faculty_id: regex }];
    }
    if (faculty_email) filter.faculty_email = faculty_email;
    if (faculty_id)    filter.faculty_id = faculty_id;
    if (status)        filter.status = status;

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .populate('student_id', 'name reg_no email')
        .populate('issued_by_incharge_id', 'name email')
        .populate('items.item_id', 'name sku tracking_type')
        .sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean()
    ]);

    return res.json({
      success: true, page: pageNum, limit: limitNum, totalItems,
      totalPages: Math.ceil(totalItems / limitNum), count: records.length, data: records
    });

  } catch (err) {
    console.error('SEARCH LAB SESSIONS ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to search lab sessions' });
  }
};

/* ============================
   GET SINGLE LAB SESSION
============================ */
exports.getLabSessionDetail = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const record = await Transaction.findOne({
      _id: req.params.id, transaction_type: 'lab_session', 'items.lab_id': labId
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) return res.status(404).json({ success: false, message: 'Lab session not found or unauthorized' });

    return res.json({ success: true, data: record });

  } catch (err) {
    console.error('Get lab session detail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab session' });
  }
};

/* ============================
   GET ALL LAB TRANSFERS
============================ */
exports.getLabTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const baseFilter = {
      transaction_type: 'lab_transfer',
      $or: [{ 'items.lab_id': labId }, { target_lab_id: labId }]
    };

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(baseFilter),
      Transaction.find(baseFilter)
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.lab_id', 'name code')
        .populate('items.asset_ids', 'asset_tag')
        .populate('target_lab_id', 'name code')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    const formatted = records.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    return res.json({
      success: true, page, limit, totalItems,
      totalPages: Math.ceil(totalItems / limit), count: formatted.length, data: formatted
    });

  } catch (err) {
    console.error('Get lab transfers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab transfers' });
  }
};

/* ============================
   SEARCH LAB TRANSFERS
============================ */
exports.searchLabTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { search, transfer_type, status, faculty_name, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      transaction_type: 'lab_transfer',
      $or: [{ 'items.lab_id': labId }, { target_lab_id: labId }]
    };

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$and = [{ $or: [{ transaction_id: regex }, { target_lab_name_snapshot: regex }, { handover_faculty_name: regex }, { faculty_email: regex }] }];
    }
    if (transfer_type)  filter.transfer_type = transfer_type;
    if (status)         filter.status = status;
    if (faculty_name)   filter.handover_faculty_name = new RegExp(faculty_name, 'i');

    const [totalItems, records] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter)
        .populate('student_id', 'name reg_no email')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.lab_id', 'name code')
        .populate('target_lab_id', 'name code')
        .populate('issued_by_incharge_id', 'name email')
        .sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean()
    ]);

    return res.json({
      success: true, page: pageNum, limit: limitNum, totalItems,
      totalPages: Math.ceil(totalItems / limitNum), count: records.length, data: records
    });

  } catch (err) {
    console.error('SEARCH LAB TRANSFERS ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to search lab transfers' });
  }
};

/* ============================
   GET SINGLE LAB TRANSFER
============================ */
exports.getLabTransferDetail = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const record = await Transaction.findOne({
      _id: req.params.id, transaction_type: 'lab_transfer',
      $or: [{ 'items.lab_id': labId }, { target_lab_id: labId }]
    })
      .populate('student_id', 'name reg_no email')
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.lab_id', 'name code')
      .populate('items.asset_ids', 'asset_tag')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) return res.status(404).json({ success: false, message: 'Lab transfer not found or unauthorized' });

    const formatted = {
      ...record,
      items: record.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    };

    return res.json({ success: true, data: formatted });

  } catch (err) {
    console.error('GET LAB TRANSFER DETAIL ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab transfer' });
  }
};

/* ============================
   COMPONENT REQUESTS
============================ */
exports.getAllComponentRequests = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { status, urgency, category, student_reg_no, component_name } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const filter = { lab_id: labId };
    if (status)         filter.status = status;
    if (urgency)        filter.urgency = urgency;
    if (category)       filter.category = category;
    if (student_reg_no) filter.student_reg_no = student_reg_no;
    if (component_name) filter.component_name = new RegExp(component_name, 'i');

    const [totalItems, requests] = await Promise.all([
      ComponentRequest.countDocuments(filter),
      ComponentRequest.find(filter)
        .populate('student_id', 'name reg_no email')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    return res.json({
      success: true, page, limit, totalItems,
      totalPages: Math.ceil(totalItems / limit), count: requests.length, data: requests
    });

  } catch (err) {
    console.error('Get component requests error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch component requests' });
  }
};

exports.getComponentRequestById = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const request = await ComponentRequest.findOne({ _id: req.params.id, lab_id: labId })
      .populate('student_id', 'name reg_no email').lean();

    if (!request) return res.status(404).json({ success: false, message: 'Component request not found or unauthorized' });

    return res.json({ success: true, data: request });

  } catch (err) {
    console.error('Get component request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch component request' });
  }
};

exports.updateComponentRequestStatus = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { status, admin_remarks } = req.body;
    if (!['approved', 'rejected', 'reviewed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const request = await ComponentRequest.findOne({ _id: req.params.id, lab_id: labId });
    if (!request) return res.status(404).json({ success: false, message: 'Component request not found or unauthorized' });

    if (['approved', 'rejected'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Request already finalized' });
    }

    request.status = status;
    request.admin_remarks = admin_remarks || null;
    await request.save();

    return res.json({ success: true, message: `Request ${status} successfully`, data: request });

  } catch (err) {
    console.error('Update component request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update request' });
  }
};

/* ============================
   BILLS
============================ */
exports.uploadBill = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const { title, bill_type, bill_date, invoice_number } = req.body;

    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });
    if (!title || !bill_date || !invoice_number || !req.file) {
      return res.status(400).json({ success: false, message: 'Title, bill date, invoice number and PDF file are required' });
    }

    const s3Key = `bills/${labId}/${Date.now()}-${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET, Key: s3Key,
      Body: req.file.buffer, ContentType: 'application/pdf'
    }));

    const bill = await Bill.create({
      lab_id: labId, title, bill_type, invoice_number,
      bill_date: new Date(bill_date), s3_key: s3Key,
      s3_url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      uploaded_by: req.user.id
    });

    return res.status(201).json({ success: true, message: 'Bill uploaded successfully', data: bill });

  } catch (err) {
    console.error('Upload bill error:', err);
    return res.status(500).json({ success: false, message: 'Failed to upload bill' });
  }
};

exports.getBills = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { month, from, to, date, invoice_number, bill_type } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const filter = { lab_id: labId };
    if (invoice_number) filter.invoice_number = invoice_number;
    if (bill_type)      filter.bill_type = bill_type;

    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      filter.bill_date = { $gte: start, $lt: end };
    }
    if (month) {
      const [y, m] = month.split('-');
      const start = new Date(`${y}-${m}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      filter.bill_date = { $gte: start, $lt: end };
    }
    if (from && to) {
      filter.bill_date = { $gte: new Date(from), $lte: new Date(to) };
    }

    const [totalItems, bills] = await Promise.all([
      Bill.countDocuments(filter),
      Bill.find(filter)
        .populate('uploaded_by', 'name email')
        .sort({ bill_date: -1, createdAt: -1 }).skip(skip).limit(limit).lean()
    ]);

    return res.json({
      success: true, page, limit, totalItems,
      totalPages: Math.ceil(totalItems / limit), count: bills.length, data: bills
    });

  } catch (err) {
    console.error('Get bills error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch bills' });
  }
};

exports.downloadBill = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const bill = await Bill.findOne({ _id: req.params.id, lab_id: labId });
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found or unauthorized' });

    const stream = await s3.send(new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET, Key: bill.s3_key
    }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${bill.title}.pdf"`);
    stream.Body.pipe(res);

  } catch (err) {
    console.error('Download bill error:', err);
    return res.status(500).json({ success: false, message: 'Failed to download bill' });
  }
};

/* ============================
   DAMAGED ASSET HISTORY
============================ */
exports.getDamagedAssetHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const { item, vendor, status, from, to } = req.query;
    const matchStage = {};

    if (status) matchStage.status = status;
    if (from || to) {
      matchStage.reported_at = {};
      if (from) matchStage.reported_at.$gte = new Date(from);
      if (to)   matchStage.reported_at.$lte = new Date(to);
    }

    const pipeline = [
      { $match: matchStage },
      { $lookup: { from: 'itemassets', localField: 'asset_id', foreignField: '_id', as: 'asset' } },
      { $unwind: '$asset' },
      { $match: { 'asset.lab_id': labId } },
      { $lookup: { from: 'items', localField: 'asset.item_id', foreignField: '_id', as: 'item' } },
      { $unwind: '$item' }
    ];

    if (item) pipeline.push({ $match: { 'item.name': { $regex: item, $options: 'i' } } });
    if (vendor) pipeline.push({ $match: { 'asset.vendor': { $regex: vendor, $options: 'i' } } });

    pipeline.push(
      {
        $project: {
          _id: 1,
          asset_tag: '$asset.asset_tag', serial_no: '$asset.serial_no',
          asset_status: '$asset.status', asset_condition: '$asset.condition',
          vendor: '$asset.vendor', item_name: '$item.name',
          sku: '$item.sku', category: '$item.category',
          damage_status: '$status', damage_reason: '$damage_reason',
          remarks: '$remarks', reported_at: 1,
          faculty_email: 1, faculty_id: 1, student_id: 1
        }
      },
      { $sort: { reported_at: -1 } }
    );

    const records = await DamagedAssetLog.aggregate(pipeline);

    return res.json({ success: true, count: records.length, data: records });

  } catch (error) {
    console.error('Damaged asset history error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch damaged asset history' });
  }
};

/* ============================
   LAB TRANSFER ROUTES
============================ */
exports.getAllLabs = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const labs = await Lab.find({ _id: { $ne: labId }, is_active: true }).select('name code location');
    res.json({ success: true, data: labs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch labs' });
  }
};

exports.getLabAvailableItems = async (req, res) => {
  try {
    const { labId } = req.params;

    const inventory = await LabInventory.find({ lab_id: labId })
      .populate('item_id', 'name sku tracking_type is_student_visible').lean();

    const filtered = inventory
      .map(inv => ({
        ...inv,
        available_quantity: inv.total_quantity - (inv.reserved_quantity || 0)
      }))
      .filter(inv => inv.available_quantity > 0);

    res.json({ success: true, count: filtered.length, data: filtered });

  } catch (err) {
    console.error('GET LAB AVAILABLE ITEMS ERROR:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch items' });
  }
};

exports.createTransferRequest = async (req, res) => {
  try {
    const sourceLabId = req.user.lab_id;
    const { target_lab_id, items, transfer_type, expected_return_date } = req.body;

    if (!sourceLabId || sourceLabId.toString() === target_lab_id.toString()) {
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
      expected_return_date: transfer_type === 'temporary' ? new Date(expected_return_date) : null,
      items: items.map(i => ({ lab_id: target_lab_id, item_id: i.item_id, quantity: i.quantity }))
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
      .populate('items.asset_ids', 'asset_tag')
      .sort({ createdAt: -1 }).lean();

    const formatted = transfers.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    res.json({ success: true, data: formatted });

  } catch (err) {
    console.error('GET INCOMING TRANSFERS ERROR:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch incoming transfers' });
  }
};

exports.getOutgoingTransfers = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    const transfers = await Transaction.find({
      transaction_type: 'lab_transfer', source_lab_id: labId
    })
      .populate('target_lab_id', 'name code location')
      .populate('source_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .sort({ createdAt: -1 }).lean();

    const formatted = transfers.map(t => ({
      ...t,
      items: t.items.map(i => ({
        ...i,
        asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
      }))
    }));

    res.json({ success: true, count: formatted.length, data: formatted });

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

    if (!transaction || !transaction.target_lab_id || transaction.target_lab_id.toString() !== labId.toString()) {
      throw new Error('Unauthorized');
    }

    if (transaction.status !== 'raised') {
      throw new Error('Transfer request already processed');
    }

    if (decision === 'rejected') {
      transaction.status = 'rejected';
      transaction.faculty_approval = { ...transaction.faculty_approval, rejected_reason: reason || '' };
      await transaction.save({ session });
      await session.commitTransaction();
      return res.json({ success: true, message: 'Transfer rejected' });
    }

    if (decision !== 'approved') throw new Error('Invalid decision. Must be approved or rejected');

    for (const item of transaction.items) {
      const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item.item_id }).session(session);
      if (!inventory) throw new Error('Item not found in lab inventory');
      if (inventory.available_quantity < item.quantity) throw new Error('Insufficient stock for one or more items');

      const itemDef = await Item.findById(item.item_id).session(session);
      if (!itemDef) throw new Error('Item definition not found');

      if (itemDef.tracking_type === 'bulk') {
        inventory.available_quantity -= item.quantity;
        if (transaction.transfer_type === 'permanent') inventory.total_quantity -= item.quantity;
        await inventory.save({ session });
      }

      if (itemDef.tracking_type === 'asset') {
        const assets = await ItemAsset.find({ lab_id: labId, item_id: item.item_id, status: 'available' })
          .limit(item.quantity).session(session);

        if (assets.length < item.quantity) throw new Error('Not enough available assets');

        item.asset_ids = assets.map(a => a._id);

        for (const asset of assets) {
          if (transaction.transfer_type === 'permanent') {
            asset.status = 'retired';
          } else {
            asset.status = 'issued';
            asset.last_transaction_id = transaction._id;
          }
          await asset.save({ session });
        }

        inventory.available_quantity -= item.quantity;
        if (transaction.transfer_type === 'permanent') inventory.total_quantity -= item.quantity;
        await inventory.save({ session });
      }
    }

    transaction.status = 'active';
    transaction.issued_at = new Date();
    transaction.issued_by_incharge_id = req.user._id || req.user.id;
    await transaction.save({ session });
    await session.commitTransaction();

    const populated = await Transaction.findById(transaction._id)
      .populate('source_lab_id', 'name code')
      .populate('target_lab_id', 'name code')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .lean();

    populated.items = populated.items.map(i => ({
      ...i,
      asset_tags: i.asset_ids?.map(a => a.asset_tag) || []
    }));

    return res.json({
      success: true,
      message: `Transfer ${transaction.transfer_type === 'permanent' ? 'permanently' : 'temporarily'} approved`,
      data: populated
    });

  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

exports.initiateReturn = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction || !transaction.source_lab_id.equals(labId) ||
        transaction.transfer_type !== 'temporary' || transaction.status !== 'active') {
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
    const labId = new mongoose.Types.ObjectId(req.user.lab_id);
    const transaction = await Transaction.findById(req.params.id).session(session);

    if (!transaction) throw new Error('Transaction not found');
    if (!transaction.target_lab_id.equals(labId)) throw new Error('Unauthorized — only the owning lab can complete the return');
    if (transaction.transfer_type !== 'temporary') throw new Error('Only temporary transfers can be returned');
    if (transaction.status !== 'return_requested') throw new Error('Return not yet requested by source lab');

    for (const item of transaction.items) {
      const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item.item_id }).session(session);
      if (!inventory) throw new Error('Inventory record not found for returned item');

      const itemDef = await Item.findById(item.item_id).session(session);
      if (!itemDef) throw new Error('Item definition not found');

      if (itemDef.tracking_type === 'bulk') {
        inventory.available_quantity += item.quantity;
        await inventory.save({ session });
      }

      if (itemDef.tracking_type === 'asset') {
        await ItemAsset.updateMany(
          { _id: { $in: item.asset_ids } },
          { $set: { status: 'available', last_transaction_id: transaction._id } },
          { session }
        );
        inventory.available_quantity += item.asset_ids.length;
        await inventory.save({ session });
      }
    }

    transaction.status = 'completed';
    transaction.actual_return_date = new Date();
    await transaction.save({ session });
    await session.commitTransaction();

    return res.json({ success: true, message: 'Transfer return completed successfully' });

  } catch (err) {
    await session.abortTransaction();
    return res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};