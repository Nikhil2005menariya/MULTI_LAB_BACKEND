const mongoose = require("mongoose");
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const Lab = require('../models/Lab');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const Student = require('../models/Student');
const { sendMail } = require('../services/mail.service');
const ComponentRequest = require('../models/ComponentRequest');
const Bill = require('../models/Bill');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../utils/s3');

/* ============================
   INPUT VALIDATION & SANITIZATION UTILITIES
============================ */

// Email validation (RFC 5322 simplified)
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
};

// Name validation - only letters, numbers, spaces, hyphens, and common punctuation
const isValidName = (name) => {
  if (!name || typeof name !== 'string') return false;
  // Allow letters (any language), numbers, spaces, hyphens, apostrophes, periods
  const nameRegex = /^[\p{L}\p{N}\s\-'.]+$/u;
  return nameRegex.test(name.trim()) && name.trim().length >= 1 && name.trim().length <= 200;
};

// Alphanumeric with basic allowed characters
const isValidAlphanumeric = (str, allowSpaces = false, allowHyphens = false) => {
  if (!str || typeof str !== 'string') return false;
  let pattern = '^[a-zA-Z0-9';
  if (allowSpaces) pattern += '\\s';
  if (allowHyphens) pattern += '\\-';
  pattern += ']+$';
  return new RegExp(pattern).test(str);
};

// Text field validation (description, category, etc.) - prevent XSS
const sanitizeText = (text, maxLength = 1000) => {
  if (!text || typeof text !== 'string') return '';
  // Remove any HTML tags and limit length
  return text.replace(/<[^>]*>/g, '').trim().substring(0, maxLength);
};

// Escape special regex characters to prevent ReDoS
const escapeRegex = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Validate positive integer
const isValidPositiveInteger = (num) => {
  const parsed = Number(num);
  return !isNaN(parsed) && parsed > 0 && Number.isInteger(parsed);
};

// Validate non-negative integer
const isValidNonNegativeInteger = (num) => {
  const parsed = Number(num);
  return !isNaN(parsed) && parsed >= 0 && Number.isInteger(parsed);
};

// Sanitize filename
const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return 'file';
  // Remove path traversal attempts and special characters
  return filename
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
};

// Validate date string
const isValidDateString = (dateStr) => {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
};

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

    // Validate labId
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate required fields
    if (!name || !sku || !vendor) {
      return res.status(400).json({ error: 'Name, SKU, and vendor are required' });
    }

    // Validate name
    if (!isValidAlphanumeric(name, true, true)) {
      return res.status(400).json({ error: 'Name can only contain letters, numbers, spaces, and hyphens' });
    }
    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }
    name = name.toLowerCase().replace(/[\s-]+/g, '_').trim();

    // Validate SKU
    if (!isValidAlphanumeric(sku, false, false)) {
      return res.status(400).json({ error: 'SKU must contain only letters and numbers' });
    }
    if (sku.trim().length < 2 || sku.trim().length > 50) {
      return res.status(400).json({ error: 'SKU must be between 2 and 50 characters' });
    }
    sku = sku.toUpperCase().trim();

    // Validate vendor name
    if (!isValidName(vendor)) {
      return res.status(400).json({ error: 'Invalid vendor name format' });
    }
    vendor = sanitizeText(vendor, 200);

    // Validate category
    if (category) {
      category = sanitizeText(category, 100);
    }

    // Validate description
    if (description) {
      description = sanitizeText(description, 1000);
    }

    // Validate invoice number
    if (invoice_number) {
      if (!isValidAlphanumeric(invoice_number, false, true)) {
        return res.status(400).json({ error: 'Invoice number can only contain letters, numbers, and hyphens' });
      }
      invoice_number = invoice_number.trim().substring(0, 50);
    }

    // Validate quantities
    if (!isValidPositiveInteger(initial_quantity)) {
      return res.status(400).json({ error: 'Initial quantity must be a positive integer' });
    }
    if (!isValidNonNegativeInteger(reserved_quantity)) {
      return res.status(400).json({ error: 'Reserved quantity must be a non-negative integer' });
    }

    const qty = Number(initial_quantity);
    const reservedQty = Number(reserved_quantity);

    if (reservedQty > qty) {
      return res.status(400).json({ error: 'Reserved quantity cannot exceed initial quantity' });
    }

    // Validate tracking type
    if (tracking_type && !['asset', 'bulk'].includes(tracking_type)) {
      return res.status(400).json({ error: 'Invalid tracking type' });
    }

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

    // Validate labId and item ID
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Validate tracking type if provided
    if (req.body.tracking_type) {
      if (req.body.tracking_type !== item.tracking_type) {
        return res.status(400).json({ error: 'Tracking type cannot be changed after item creation' });
      }
    }

    // Validate quantities
    const addQty = req.body.add_quantity !== undefined ? Number(req.body.add_quantity) : 0;
    if (isNaN(addQty)) {
      return res.status(400).json({ error: 'Invalid add_quantity value' });
    }

    const newReserved = req.body.reserved_quantity !== undefined
      ? Number(req.body.reserved_quantity) : undefined;
    if (newReserved !== undefined && (isNaN(newReserved) || newReserved < 0)) {
      return res.status(400).json({ error: 'Invalid reserved_quantity value' });
    }

    const createdAssets = [];

    const inventory = await LabInventory.findOne({ lab_id: labId, item_id: item._id });
    if (!inventory) return res.status(404).json({ error: 'Item not found in this lab' });

    // Handle asset removal
    if (Array.isArray(req.body.remove_asset_tags) && req.body.remove_asset_tags.length > 0) {
      if (item.tracking_type !== 'asset') {
        return res.status(400).json({ error: 'Asset removal only applies to asset-tracked items' });
      }

      const assetsToRemove = req.body.remove_asset_tags;

      // Verify all assets exist and belong to this lab/item
      const assetsToRetire = await ItemAsset.find({
        lab_id: labId,
        item_id: item._id,
        asset_tag: { $in: assetsToRemove }
      });

      if (assetsToRetire.length !== assetsToRemove.length) {
        return res.status(400).json({ error: 'Some asset tags were not found or do not belong to this item' });
      }

      // Mark assets as retired
      await ItemAsset.updateMany(
        {
          lab_id: labId,
          item_id: item._id,
          asset_tag: { $in: assetsToRemove }
        },
        {
          status: 'retired',
          condition: 'retired'
        }
      );

      // Update inventory
      inventory.total_quantity = Math.max(0, inventory.total_quantity - assetsToRemove.length);

      // Recalculate available quantity from database
      const actualAvailable = await ItemAsset.countDocuments({
        lab_id: labId,
        item_id: item._id,
        status: 'available',
        condition: 'good'
      });
      inventory.available_quantity = actualAvailable;
    }

    if (addQty > 0) {
      if (item.tracking_type === 'bulk') {
        inventory.total_quantity += addQty;
        inventory.available_quantity += addQty;
      }

      if (item.tracking_type === 'asset') {
        // Validate vendor for asset tracking
        if (!req.body.vendor) {
          return res.status(400).json({ error: 'Vendor is required when adding new stock' });
        }
        if (!isValidName(req.body.vendor)) {
          return res.status(400).json({ error: 'Invalid vendor name format' });
        }

        const vendor = sanitizeText(req.body.vendor, 200);
        let invoice_number = '';

        if (req.body.invoice_number) {
          if (!isValidAlphanumeric(req.body.invoice_number, false, true)) {
            return res.status(400).json({ error: 'Invoice number can only contain letters, numbers, and hyphens' });
          }
          invoice_number = req.body.invoice_number.trim().substring(0, 50);
        }

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
            vendor, invoice_number,
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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate item ID
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate item ID
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate and sanitize pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip = (page - 1) * limit;

    // Sanitize search input
    const search = req.query.search?.trim();

    let itemMatch = { is_active: true };
    if (search) {
      const sanitizedSearch = escapeRegex(sanitizeText(search, 100));
      const regex = new RegExp(sanitizedSearch, 'i');
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
    if (!q || q.length < 2) {
      return res.json({ success: true, count: 0, data: [] });
    }

    // Sanitize and limit input length
    q = sanitizeText(q, 50);
    if (q.length < 2) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const normalizedName = escapeRegex(q.toLowerCase().replace(/[\s-]+/g, '_').trim());
    const normalizedSku = escapeRegex(q.toUpperCase().trim());

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const labObjectId = new mongoose.Types.ObjectId(String(labId));

    const {
      transaction_id, reg_no, faculty_email, faculty_id,
      status, item_name, asset_tag, page = 1, limit = 25
    } = req.query;

    // Validate email if provided
    if (faculty_email && !isValidEmail(faculty_email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate and sanitize pagination
    const pageNum  = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    // Pre-resolve item_name → item _ids
    let itemIdFilter = null;
    if (item_name) {
      const sanitizedItemName = escapeRegex(sanitizeText(item_name, 100));
      const matchedItems = await Item.find({
        name: new RegExp(sanitizedItemName, 'i')
      }).select('_id').lean();
      if (matchedItems.length === 0) {
        return res.json({ success: true, page: pageNum, limit: limitNum, totalItems: 0, totalPages: 0, count: 0, data: [] });
      }
      itemIdFilter = matchedItems.map(i => i._id);
    }

    // Pre-resolve asset_tag → asset _ids
    let assetIdFilter = null;
    if (asset_tag) {
      const sanitizedAssetTag = escapeRegex(sanitizeText(asset_tag, 50));
      const matchedAssets = await ItemAsset.find({
        lab_id: labObjectId,
        asset_tag: new RegExp(sanitizedAssetTag, 'i')
      }).select('_id').lean();
      if (matchedAssets.length === 0) {
        return res.json({ success: true, page: pageNum, limit: limitNum, totalItems: 0, totalPages: 0, count: 0, data: [] });
      }
      assetIdFilter = matchedAssets.map(a => a._id);
    }

    /* ── Build match stage ── */
    const matchStage = { 'items.lab_id': labObjectId };

    // ✅ Sanitize and escape regex inputs to prevent ReDoS
    if (transaction_id) {
      const sanitized = escapeRegex(sanitizeText(transaction_id.trim(), 50));
      matchStage.transaction_id = new RegExp(`^${sanitized}`, 'i');
    }
    if (reg_no) {
      const sanitized = escapeRegex(sanitizeText(reg_no.trim(), 50));
      matchStage.student_reg_no = new RegExp(sanitized, 'i');
    }
    if (faculty_email) {
      const sanitized = escapeRegex(faculty_email.trim());
      matchStage.faculty_email = new RegExp(sanitized, 'i');
    }
    if (faculty_id) {
      const sanitized = escapeRegex(sanitizeText(faculty_id.trim(), 50));
      matchStage.faculty_id = new RegExp(sanitized, 'i');
    }
    if (status) {
      // Prefix match for debounce queries (e.g., "partial" matches "partial_issued", "partial_returned")
      const sanitized = escapeRegex(sanitizeText(status.trim(), 50));
      matchStage.status = new RegExp(`^${sanitized}`, 'i');
    }

    /* ── Item filter conditions ── */
    const itemFilterConditions = [{ $eq: ['$$item.lab_id', labObjectId] }];

    if (itemIdFilter) {
      itemFilterConditions.push({ $in: ['$$item.item_id', itemIdFilter] });
    }

    if (assetIdFilter) {
      itemFilterConditions.push({
        $gt: [{
          $size: {
            $ifNull: [{
              $filter: {
                input: { $ifNull: ['$$item.asset_ids', []] },
                as: 'aid',
                cond: { $in: ['$$aid', assetIdFilter] }
              }
            }, []]
          }
        }, 0]
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

      assetMergeStage,

      { $project: { _itemDefs: 0, _assetDefs: 0 } },
      { $sort: { createdAt: -1 } },

      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data:     [{ $skip: skip }, { $limit: limitNum }]
        }
      }
    ];

    const result = await Transaction.aggregate(pipeline);
    const total  = result[0]?.metadata[0]?.total || 0;
    const data   = result[0]?.data || [];

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate item ID
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

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
        .populate('items.asset_ids', 'asset_tag serial_no')
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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { search, faculty_email, faculty_id, status, page = 1, limit = 25 } = req.query;

    // Validate email if provided
    if (faculty_email && !isValidEmail(faculty_email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { transaction_type: 'lab_session', 'items.lab_id': labId };

    if (search) {
      const sanitizedSearch = escapeRegex(sanitizeText(search, 100));
      const regex = new RegExp(sanitizedSearch, 'i');
      filter.$or = [
        { transaction_id: regex },
        { lab_slot: regex },
        { faculty_email: regex },
        { faculty_id: regex }
      ];
    }
    if (faculty_email) {
      filter.faculty_email = escapeRegex(faculty_email.trim());
    }
    if (faculty_id) {
      filter.faculty_id = escapeRegex(sanitizeText(faculty_id, 50));
    }
    if (status) {
      // Prefix match for debounce queries
      const sanitized = escapeRegex(sanitizeText(status.trim(), 50));
      filter.status = new RegExp(`^${sanitized}`, 'i');
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    // Validate ID parameter
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { search, transfer_type, status, faculty_name, page = 1, limit = 25 } = req.query;

    // Validate pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      transaction_type: 'lab_transfer',
      $or: [{ 'items.lab_id': labId }, { target_lab_id: labId }]
    };

    if (search) {
      const sanitizedSearch = escapeRegex(sanitizeText(search, 100));
      const regex = new RegExp(sanitizedSearch, 'i');
      filter.$and = [{
        $or: [
          { transaction_id: regex },
          { target_lab_name_snapshot: regex },
          { handover_faculty_name: regex },
          { faculty_email: regex }
        ]
      }];
    }

    // Validate transfer_type
    if (transfer_type) {
      const validTypes = ['temporary', 'permanent'];
      if (validTypes.includes(transfer_type)) {
        filter.transfer_type = transfer_type;
      }
    }

    // Validate status
    if (status) {
      // Prefix match for debounce queries
      const sanitized = escapeRegex(sanitizeText(status.trim(), 50));
      filter.status = new RegExp(`^${sanitized}`, 'i');
    }

    // Sanitize faculty_name
    if (faculty_name) {
      if (isValidName(faculty_name)) {
        const sanitized = escapeRegex(sanitizeText(faculty_name, 100));
        filter.handover_faculty_name = new RegExp(sanitized, 'i');
      }
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    // Validate ID parameter
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid transfer ID' });
    }

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
   COMPONENT REQUESTS — GET ALL (paginated + search)
   GET /api/admin/component-requests
   ?search=&status=&urgency=&category=&page=&limit=
============================ */
exports.getAllComponentRequests = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { search, status, urgency, category } = req.query;

    // Validate pagination
    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip  = (page - 1) * limit;

    const filter = { lab_id: labId };

    /* Exact filters with validation */
    if (status) {
      const validStatuses = ['pending', 'in_progress', 'approved', 'rejected', 'completed'];
      if (validStatuses.includes(status)) {
        filter.status = status;
      }
    }

    if (urgency) {
      const validUrgency = ['low', 'medium', 'high', 'urgent'];
      if (validUrgency.includes(urgency)) {
        filter.urgency = urgency;
      }
    }

    if (category) {
      const sanitizedCategory = escapeRegex(sanitizeText(category, 100));
      filter.category = new RegExp(sanitizedCategory, 'i');
    }

    /* Unified search — prefix match across component name, category, student reg no */
    if (search && search.trim()) {
      const sanitizedSearch = escapeRegex(sanitizeText(search.trim(), 100));
      const regex = new RegExp(sanitizedSearch, 'i');
      filter.$or = [
        { component_name:   regex },
        { category:         regex },
        { student_reg_no:   regex },
        { student_email:    regex }
      ];
    }

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
      success: true, page, limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: requests.length,
      data: requests
    });

  } catch (err) {
    console.error('Get component requests error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch component requests' });
  }
};

exports.getComponentRequestById = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    // Validate ID parameter
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID' });
    }

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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    // Validate ID parameter
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID' });
    }

    const { status, admin_remarks } = req.body;

    // Validate status
    const validStatuses = ['pending', 'in_progress', 'approved', 'rejected', 'completed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    // Sanitize admin_remarks if provided
    const sanitizedRemarks = admin_remarks ? sanitizeText(admin_remarks, 1000) : null;
    if (!['approved', 'rejected', 'reviewed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const request = await ComponentRequest.findOne({ _id: req.params.id, lab_id: labId });
    if (!request) return res.status(404).json({ success: false, message: 'Component request not found or unauthorized' });

    if (['approved', 'rejected'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Request already finalized' });
    }

    request.status = status;
    request.admin_remarks = sanitizedRemarks;
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

    // Validate labId
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    // Validate required fields
    if (!title || !bill_date || !invoice_number || !req.file) {
      return res.status(400).json({ success: false, message: 'Title, bill date, invoice number and PDF file are required' });
    }

    // Validate title
    if (!isValidName(title)) {
      return res.status(400).json({ success: false, message: 'Invalid title format' });
    }
    const sanitizedTitle = sanitizeText(title, 200);

    // Validate bill_type
    const validBillTypes = ['purchase', 'maintenance', 'service', 'other'];
    if (bill_type && !validBillTypes.includes(bill_type)) {
      return res.status(400).json({ success: false, message: 'Invalid bill type' });
    }

    // Validate invoice_number
    if (!isValidAlphanumeric(invoice_number, false, true)) {
      return res.status(400).json({ success: false, message: 'Invoice number can only contain letters, numbers, and hyphens' });
    }
    const sanitizedInvoice = invoice_number.trim().substring(0, 50);

    // Validate date
    if (!isValidDateString(bill_date)) {
      return res.status(400).json({ success: false, message: 'Invalid bill date format' });
    }

    // Validate file
    if (!req.file.originalname || req.file.size > 10 * 1024 * 1024) { // 10MB limit
      return res.status(400).json({ success: false, message: 'File must be less than 10MB' });
    }

    // Sanitize filename for S3
    const sanitizedFilename = sanitizeFilename(req.file.originalname);
    const s3Key = `bills/${labId}/${Date.now()}-${sanitizedFilename}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET, Key: s3Key,
      Body: req.file.buffer, ContentType: 'application/pdf'
    }));

    const bill = await Bill.create({
      lab_id: labId,
      title: sanitizedTitle,
      bill_type,
      invoice_number: sanitizedInvoice,
      bill_date: new Date(bill_date),
      s3_key: s3Key,
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
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { month, from, to, date, invoice_number, bill_type } = req.query;

    // Validate pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { lab_id: labId };

    // Validate and sanitize invoice_number
    if (invoice_number) {
      const sanitized = escapeRegex(sanitizeText(invoice_number, 50));
      filter.invoice_number = sanitized;
    }

    // Validate bill_type
    if (bill_type) {
      const validBillTypes = [
        'electricity',
        'internet',
        'maintenance',
        'equipment',
        'other'
      ];
      if (validBillTypes.includes(bill_type)) {
        filter.bill_type = bill_type;
      }
    }

    // Validate dates
    if (date) {
      if (!isValidDateString(date)) {
        return res.status(400).json({ success: false, message: 'Invalid date format' });
      }
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      filter.bill_date = { $gte: start, $lt: end };
    }

    if (month) {
      // Validate month format (YYYY-MM)
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, message: 'Invalid month format. Use YYYY-MM' });
      }
      const [y, m] = month.split('-');
      const start = new Date(`${y}-${m}-01`);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid month value' });
      }
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

    // Validate labId and request ID
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid bill ID' });
    }

    const bill = await Bill.findOne({ _id: req.params.id, lab_id: labId });
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found or unauthorized' });
    }

    const stream = await s3.send(new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET, Key: bill.s3_key
    }));

    // Sanitize filename to prevent header injection
    const safeFilename = sanitizeFilename(bill.title || 'bill');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.pdf"`);
    stream.Body.pipe(res);

  } catch (err) {
    console.error('Download bill error:', err);
    return res.status(500).json({ success: false, message: 'Failed to download bill' });
  }
};

/* ============================
   DAMAGED ASSET HISTORY
============================ */
/* =====================================================
   DAMAGED ASSETS CONTROLLERS
   Add these to admin.controller.js
===================================================== */

/* ============================
   1. DAMAGED ASSET HISTORY (FILTERABLE + PAGINATED)
============================ */
exports.getDamagedAssetHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { item, vendor, status, from, to } = req.query;

    // Validate pagination
    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip  = (page - 1) * limit;

    // Validate status
    let validatedStatus = null;
    if (status) {
      const validStatuses = ['damaged', 'under_repair', 'repaired', 'resolved', 'retired'];
      if (validStatuses.includes(status)) {
        validatedStatus = status;
      }
    }

    // Validate and sanitize date ranges
    let fromDate = null;
    let toDate = null;
    if (from) {
      if (!isValidDateString(from)) {
        return res.status(400).json({ success: false, message: 'Invalid from date format' });
      }
      fromDate = new Date(from);
    }
    if (to) {
      if (!isValidDateString(to)) {
        return res.status(400).json({ success: false, message: 'Invalid to date format' });
      }
      toDate = new Date(to);
    }

    /* ── Build pipeline ── */
    const pipeline = [

      /* Join asset — must belong to this lab */
      {
        $lookup: {
          from: 'itemassets',
          localField: 'asset_id',
          foreignField: '_id',
          as: 'asset'
        }
      },
      { $unwind: '$asset' },
      { $match: { 'asset.lab_id': new mongoose.Types.ObjectId(labId) } },

      /* Join item */
      {
        $lookup: {
          from: 'items',
          localField: 'asset.item_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' },

      /* Filters */
      ...(validatedStatus ? [{ $match: { status: validatedStatus } }] : []),
      ...(fromDate || toDate
        ? [{
            $match: {
              reported_at: {
                ...(fromDate ? { $gte: fromDate } : {}),
                ...(toDate   ? { $lte: toDate   } : {})
              }
            }
          }]
        : []),
      ...(vendor ? [{ $match: { 'asset.vendor': new RegExp(escapeRegex(sanitizeText(vendor, 100)), 'i') } }] : []),
      ...(item   ? [{ $match: { 'item.name':    new RegExp(escapeRegex(sanitizeText(item, 100)),   'i') } }] : []),

      { $sort: { reported_at: -1 } },

      /* Paginate + count in one pass */
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                log_id:          '$_id',
                asset_tag:       '$asset.asset_tag',
                serial_no:       '$asset.serial_no',
                asset_status:    '$asset.status',
                asset_condition: '$asset.condition',
                vendor:          '$asset.vendor',
                item_name:       '$item.name',
                sku:             '$item.sku',
                category:        '$item.category',
                damage_status:   '$status',
                damage_reason:   1,
                remarks:         1,
                faculty_email:   1,
                faculty_id:      1,
                student_id:      1,
                reported_at:     1
              }
            }
          ]
        }
      }
    ];

    const result = await DamagedAssetLog.aggregate(pipeline);
    const totalItems = result[0]?.metadata[0]?.total || 0;
    const data       = result[0]?.data || [];

    return res.json({
      success: true,
      page, limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      count: data.length,
      data
    });

  } catch (error) {
    console.error('Error fetching damaged asset history:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch damaged asset history' });
  }
};

/* ============================
   2. CURRENT DAMAGED / UNDER-REPAIR (SUMMARY)
============================ */
exports.getCurrentDamagedAssets = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const records = await DamagedAssetLog.find({ status: { $in: ['damaged', 'under_repair'] } })
      .populate({
        path: 'asset_id',
        match: { lab_id: labId },
        populate: { path: 'item_id' }
      })
      .populate('student_id', 'name reg_no email')
      .sort({ reported_at: -1 })
      .lean();

    const data = records.filter(r => r.asset_id);

    return res.json({ success: true, count: data.length, data });

  } catch (error) {
    console.error('Error fetching damaged assets:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch damaged assets' });
  }
};

/* ============================
   3. UNDER-REPAIR LIST
============================ */
exports.getUnderRepairAssets = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ success: false, message: 'Lab access denied' });

    const assets = await ItemAsset.find({ lab_id: labId, status: 'damaged', condition: 'faulty' })
      .populate('item_id')
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ success: true, count: assets.length, data: assets });

  } catch (error) {
    console.error('Error fetching under-repair assets:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch under-repair assets' });
  }
};

/* ============================
   4. UPDATE DAMAGE STATUS
============================ */
exports.updateDamageStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const labId = req.user.lab_id;
    const { action } = req.body;

    if (!labId) throw new Error('Lab access denied');
    if (!['repair', 'resolve', 'retire'].includes(action)) throw new Error('Invalid action');

    const record = await DamagedAssetLog.findById(req.params.id).session(session);
    if (!record) throw new Error('Damage record not found');

    const asset = await ItemAsset.findById(record.asset_id).session(session);
    if (!asset) throw new Error('Asset not found');

    if (String(asset.lab_id) !== String(labId)) throw new Error('Unauthorized lab access');

    const inventory = await LabInventory.findOne({
      lab_id: asset.lab_id,
      item_id: asset.item_id
    }).session(session);

    if (!inventory) throw new Error('Lab inventory not found');

    switch (action) {
      case 'repair':
        asset.status    = 'damaged';
        asset.condition = 'faulty';
        record.status   = 'under_repair';
        break;

      case 'resolve':
        asset.status    = 'available';
        asset.condition = 'good';
        record.status   = 'resolved';
        break;

      case 'retire':
        asset.status    = 'retired';
        asset.condition = 'broken';
        record.status   = 'retired';
        inventory.total_quantity = Math.max(0, inventory.total_quantity - 1);
        break;
    }

    await asset.save({ session });
    await record.save({ session });

    const [availableCount, damagedCount] = await Promise.all([
      ItemAsset.countDocuments({ lab_id: asset.lab_id, item_id: asset.item_id, status: 'available' }).session(session),
      ItemAsset.countDocuments({ lab_id: asset.lab_id, item_id: asset.item_id, status: 'damaged'   }).session(session)
    ]);

    inventory.available_quantity = availableCount;
    inventory.damaged_quantity   = damagedCount;
    await inventory.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, message: `Asset status updated via action: ${action}` });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error updating damaged asset status:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

/* ============================
   5. SINGLE DAMAGE RECORD DETAIL
============================ */
exports.getDamagedAssetDetail = async (req, res) => {
  try {
    // Validate ID parameter
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid damage record ID' });
    }

    const record = await DamagedAssetLog.findById(req.params.id)
      .populate({
        path: 'asset_id',
        populate: { path: 'item_id', select: 'name category sku vendor' }
      })
      .populate('transaction_id', 'transaction_id faculty_email faculty_id issued_at actual_return_date status')
      .populate('student_id', 'name reg_no email')
      .lean();

    if (!record) return res.status(404).json({ success: false, message: 'Damaged asset record not found' });

    return res.json({ success: true, data: record });

  } catch (error) {
    console.error('Error fetching damaged asset details:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch damaged asset details' });
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

    // Validate labId
    if (!labId || !isValidObjectId(labId)) {
      return res.status(400).json({ success: false, message: 'Invalid lab ID' });
    }

    // Validate pagination
    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip  = (page - 1) * limit;

    // Sanitize search input
    const search = req.query.search ? sanitizeText(req.query.search.trim(), 100) : '';

    const searchMatch = search
      ? {
          $or: [
            { 'item.name':     new RegExp(`^${escapeRegex(search)}`, 'i') },
            { 'item.sku':      new RegExp(`^${escapeRegex(search)}`, 'i') },
            { 'item.category': new RegExp(`^${escapeRegex(search)}`, 'i') },
            { 'item.tracking_type': new RegExp(`^${escapeRegex(search)}`, 'i') }
          ]
        }
      : null;

    const result = await LabInventory.aggregate([

      /* Match this lab's inventory */
      { $match: { lab_id: new mongoose.Types.ObjectId(labId) } },

      /* Join item */
      {
        $lookup: {
          from: 'items',
          localField: 'item_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' },

      /* Only active items */
      { $match: { 'item.is_active': true } },

      /* Optional search */
      ...(searchMatch ? [{ $match: searchMatch }] : []),

      /* Compute available quantity */
      {
        $addFields: {
          available_quantity: {
            $subtract: [
              '$total_quantity',
              { $ifNull: ['$reserved_quantity', 0] }
            ]
          }
        }
      },

      /* Only items with stock */
      { $match: { available_quantity: { $gt: 0 } } },

      /* Shape output */
      {
        $project: {
          _id: 1,
          lab_id: 1,
          item_id: '$item._id',
          name:          '$item.name',
          sku:           '$item.sku',
          category:      '$item.category',
          tracking_type: '$item.tracking_type',
          is_student_visible: '$item.is_student_visible',
          total_quantity:    1,
          available_quantity: 1,
          reserved_quantity:  { $ifNull: ['$reserved_quantity', 0] },
          temp_reserved_quantity: { $ifNull: ['$temp_reserved_quantity', 0] }
        }
      },

      { $sort: { name: 1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }]
        }
      }
    ]);

    const data       = result[0]?.data || [];
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
    console.error('GET LAB AVAILABLE ITEMS ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch items' });
  }
};

exports.createTransferRequest = async (req, res) => {
  try {
    const sourceLabId = req.user.lab_id;
    const { target_lab_id, items, transfer_type, expected_return_date } = req.body;

    // Validate source lab ID
    if (!sourceLabId || !isValidObjectId(sourceLabId)) {
      return res.status(403).json({ message: 'Lab access denied' });
    }

    // Validate target lab ID
    if (!target_lab_id || !isValidObjectId(target_lab_id)) {
      return res.status(400).json({ message: 'Invalid target lab ID' });
    }

    if (sourceLabId.toString() === target_lab_id.toString()) {
      return res.status(400).json({ message: 'Source and target labs cannot be the same' });
    }

    // Validate transfer_type
    if (!transfer_type || !['temporary', 'permanent'].includes(transfer_type)) {
      return res.status(400).json({ message: 'Invalid transfer type. Must be temporary or permanent' });
    }

    // Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required and must not be empty' });
    }

    // Validate each item
    for (const item of items) {
      if (!item.item_id || !isValidObjectId(item.item_id)) {
        return res.status(400).json({ message: 'Invalid item ID in items array' });
      }
      if (!isValidPositiveInteger(item.quantity)) {
        return res.status(400).json({ message: 'Invalid quantity in items array. Must be a positive integer' });
      }
    }

    // Validate expected_return_date for temporary transfers
    if (transfer_type === 'temporary') {
      if (!expected_return_date || !isValidDateString(expected_return_date)) {
        return res.status(400).json({ message: 'Valid expected return date is required for temporary transfers' });
      }
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
      items: items.map(i => ({
        lab_id: target_lab_id,
        item_id: i.item_id,
        quantity: Number(i.quantity)
      }))
    });

    res.status(201).json({ success: true, data: transaction });

  } catch (err) {
    console.error('CREATE TRANSFER REQUEST ERROR:', err);
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

/* ============================
   GET ASSET TRANSACTION HISTORY
   GET /api/admin/items/:itemId/assets/:assetTag/transactions
   Returns last 3 transactions involving this asset
============================ */
exports.getAssetTransactionHistory = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ success: false, message: 'Lab access denied' });
    }

    const { assetTag } = req.params;

    // Validate and sanitize asset tag
    if (!assetTag || !assetTag.trim()) {
      return res.status(400).json({ success: false, message: 'Asset tag is required' });
    }

    const sanitizedAssetTag = sanitizeText(assetTag, 100).toUpperCase().trim();
    if (!isValidAlphanumeric(sanitizedAssetTag, false, true)) {
      return res.status(400).json({ success: false, message: 'Invalid asset tag format' });
    }

    // Find asset by tag
    const asset = await ItemAsset.findOne({
      asset_tag: sanitizedAssetTag,
      lab_id: labId
    }).lean();

    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    // Find last 3 transactions containing this asset
    const transactions = await Transaction.find({
      'items.asset_ids': asset._id,
      status: { $in: ['active', 'return_requested', 'partial_returned', 'completed', 'overdue'] }
    })
      .populate('student_id', 'name reg_no email')
      .select('transaction_id student_id student_reg_no actual_return_date issued_at status')
      .sort({ actual_return_date: -1, issued_at: -1 })
      .limit(3)
      .lean();

    const formatted = transactions.map(t => ({
      transaction_id: t.transaction_id,
      student_id: t.student_id?._id,
      student_name: t.student_id?.name,
      student_reg_no: t.student_reg_no || t.student_id?.reg_no,
      student_email: t.student_id?.email,
      return_date: t.actual_return_date || t.issued_at,
      issued_at: t.issued_at,
      status: t.status
    }));

    return res.json({ success: true, data: formatted });

  } catch (error) {
    console.error('Get asset transaction history error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch transaction history' });
  }
};

/* ============================
   MARK ASSET AS DAMAGED (with optional transaction_id)
   POST /api/admin/items/:itemId/mark-damaged
   Body: {
     asset_tag: string,
     transaction_id?: string,
     damage_reason: string,
     remarks?: string,
     type: 'transaction' | 'normal'
   }
============================ */
exports.markAssetDamaged = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      throw new Error('Lab access denied');
    }

    const { asset_tag, transaction_id, damage_reason, remarks = '', type } = req.body;

    // Validate required fields
    if (!asset_tag?.trim()) {
      throw new Error('Asset tag is required');
    }
    if (!damage_reason?.trim()) {
      throw new Error('Damage reason is required');
    }
    if (!['transaction', 'normal'].includes(type)) {
      throw new Error('Type must be "transaction" or "normal"');
    }

    // Sanitize inputs
    const sanitizedAssetTag = sanitizeText(asset_tag.trim(), 100).toUpperCase();
    const sanitizedDamageReason = sanitizeText(damage_reason.trim(), 500);
    const sanitizedRemarks = sanitizeText(remarks.trim(), 1000);

    // Validate asset tag format (should be alphanumeric with hyphens)
    if (!isValidAlphanumeric(sanitizedAssetTag, false, true)) {
      throw new Error('Invalid asset tag format');
    }

    // Validate transaction_id if provided
    if (transaction_id && !sanitizeText(transaction_id, 100).trim()) {
      throw new Error('Invalid transaction ID');
    }

    // Find the asset
    const asset = await ItemAsset.findOne({
      asset_tag: sanitizedAssetTag,
      lab_id: labId
    }).session(session);

    if (!asset) throw new Error('Asset not found in this lab');
    if (asset.status === 'damaged') throw new Error('Asset is already marked as damaged');

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const item = await Item.findById(asset.item_id).session(session);
    if (!item) throw new Error('Item not found');

    // Variables for transaction details
    let transaction = null;
    let student = null;
    let studentEmail = '';
    let facultyEmail = '';
    let facultyId = '';

    if (type === 'transaction' && transaction_id) {
      const sanitizedTxnId = sanitizeText(transaction_id.trim(), 100);

      // Verify transaction exists and contains this asset
      transaction = await Transaction.findOne({
        transaction_id: sanitizedTxnId,
        'items.asset_ids': asset._id,
        status: { $in: ['active', 'return_requested', 'partial_returned', 'completed', 'overdue'] }
      }).session(session);

      if (!transaction) throw new Error('Transaction not found or asset not in this transaction');

      // Get student info
      if (transaction.student_id) {
        student = await Student.findById(transaction.student_id)
          .select('name reg_no email')
          .session(session);
        if (student) studentEmail = student.email;
      }
      facultyEmail = transaction.faculty_email || '';
      facultyId = transaction.faculty_id || '';
    }

    // Create damage log
    const damageLog = await DamagedAssetLog.create([{
      asset_id: asset._id,
      transaction_id: transaction?._id || null,
      student_id: student?._id || null,
      faculty_id: facultyId || null,
      faculty_email: facultyEmail || null,
      damage_reason: sanitizedDamageReason,
      remarks: sanitizedRemarks,
      status: 'damaged',
      reported_at: new Date()
    }], { session });

    // Update asset status
    asset.status = 'damaged';
    asset.condition = 'broken';
    asset.last_transaction_id = transaction?._id || null;
    await asset.save({ session });

    // Update inventory (move from available/issued to damaged)
    const inventory = await LabInventory.findOne({
      lab_id: labObjectId,
      item_id: asset.item_id
    }).session(session);

    if (inventory) {
      if (inventory.available_quantity > 0) {
        inventory.available_quantity -= 1;
      }
      inventory.damaged_quantity = (inventory.damaged_quantity || 0) + 1;
      await inventory.save({ session });
    }

    await session.commitTransaction();

    // Send emails if transaction type
    if (type === 'transaction' && transaction) {
      const damageDetails = {
        asset_tag: asset.asset_tag,
        asset_name: sanitizeText(item.name, 100),
        damage_reason: sanitizedDamageReason,
        transaction_id: transaction.transaction_id,
        project_name: sanitizeText(transaction.project_name || '', 100),
        student_reg_no: transaction.student_reg_no,
        student_name: sanitizeText(student?.name || 'Student', 100)
      };

      // Email to student
      if (studentEmail) {
        try {
          const studentHtml = `
            <h2>Asset Damage Notification</h2>
            <p>Dear ${student?.name},</p>
            <p>An asset from your transaction has been marked as damaged.</p>
            <h3>Damage Details:</h3>
            <ul>
              <li><strong>Asset Tag:</strong> ${damageDetails.asset_tag}</li>
              <li><strong>Asset Name:</strong> ${damageDetails.asset_name}</li>
              <li><strong>Damage Reason:</strong> ${damageDetails.damage_reason}</li>
              <li><strong>Transaction ID:</strong> ${damageDetails.transaction_id}</li>
              <li><strong>Project Name:</strong> ${damageDetails.project_name}</li>
            </ul>
            <p>Please contact your faculty for further clarification.</p>
          `;
          await sendMail({
            to: studentEmail,
            subject: `Asset Damage Report - ${damageDetails.asset_tag}`,
            html: studentHtml
          });
        } catch (err) {
          console.error('Failed to send email to student:', err);
        }
      }

      // Email to faculty
      if (facultyEmail) {
        try {
          const facultyHtml = `
            <h2>Asset Damage Notification</h2>
            <p>Dear Faculty,</p>
            <p>An asset from one of your transactions has been marked as damaged.</p>
            <h3>Damage Details:</h3>
            <ul>
              <li><strong>Asset Tag:</strong> ${damageDetails.asset_tag}</li>
              <li><strong>Asset Name:</strong> ${damageDetails.asset_name}</li>
              <li><strong>Damage Reason:</strong> ${damageDetails.damage_reason}</li>
              <li><strong>Transaction ID:</strong> ${damageDetails.transaction_id}</li>
              <li><strong>Project Name:</strong> ${damageDetails.project_name}</li>
              <li><strong>Student Registration No:</strong> ${damageDetails.student_reg_no}</li>
              <li><strong>Student Name:</strong> ${damageDetails.student_name}</li>
            </ul>
            <p>Please review the damage and coordinate with the incharge for further action.</p>
          `;
          await sendMail({
            to: facultyEmail,
            subject: `Asset Damage Report - ${damageDetails.asset_tag}`,
            html: facultyHtml
          });
        } catch (err) {
          console.error('Failed to send email to faculty:', err);
        }
      }
    }

    return res.json({
      success: true,
      message: 'Asset marked as damaged successfully',
      data: {
        asset_tag: asset.asset_tag,
        damage_log_id: damageLog[0]._id,
        transaction_id: transaction?._id || null
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Mark asset damaged error:', error);
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/* ============================
   GET INCHARGE PROFILE
============================ */
exports.getInchargeProfile = async (req, res) => {
  try {
    const staffId = req.user.id;
    if (!staffId || !isValidObjectId(staffId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const staff = await Staff.findById(staffId)
      .select('name email role lab_id is_active last_login createdAt')
      .populate('lab_id', 'name code')
      .lean();

    if (!staff) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.json({
      success: true,
      data: staff
    });

  } catch (err) {
    console.error('GET INCHARGE PROFILE ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};
