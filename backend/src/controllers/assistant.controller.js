const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const ItemAsset = require('../models/ItemAsset');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const Item = require('../models/Item');
const Staff = require('../models/Staff');

/* ============================
   INPUT VALIDATION & SANITIZATION UTILITIES
============================ */

// Email validation (RFC 5322 simplified)
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
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

// Alphanumeric with basic allowed characters
const isValidAlphanumeric = (str, allowSpaces = false, allowHyphens = false) => {
  if (!str || typeof str !== 'string') return false;
  let pattern = '^[a-zA-Z0-9';
  if (allowSpaces) pattern += '\\s';
  if (allowHyphens) pattern += '\\-';
  pattern += ']+$';
  return new RegExp(pattern).test(str);
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

/* ============================
   ISSUE TRANSACTION
============================ */
exports.issueTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transaction_id } = req.params;
    const assistantLabId = req.user.lab_id;

    // Validate lab ID
    if (!assistantLabId || !isValidObjectId(assistantLabId)) {
      throw new Error('Unauthorized lab access');
    }

    // Validate and sanitize transaction_id
    if (!transaction_id || !transaction_id.trim()) {
      throw new Error('Transaction ID is required');
    }
    const sanitizedTxnId = sanitizeText(transaction_id, 100);

    const labObjectId = new mongoose.Types.ObjectId(String(assistantLabId));

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      status: { $in: ['approved', 'partial_issued', 'active'] }
    }).session(session);

    if (!transaction) throw new Error('Transaction not found or not allowed');

    let processedAnyItem = false;

    for (const txnItem of transaction.items) {
      if (txnItem.lab_id.toString() !== labObjectId.toString()) continue;
      if (txnItem.issued_quantity >= txnItem.quantity) continue;

      processedAnyItem = true;

      const inventory = await LabInventory.findOne({
        lab_id: labObjectId, item_id: txnItem.item_id
      }).session(session);

      if (!inventory) throw new Error('Inventory record not found');

      const remainingQty = txnItem.quantity - txnItem.issued_quantity;
      const item = await Item.findById(txnItem.item_id).session(session);
      if (!item) throw new Error('Item not found');

      if (item.tracking_type === 'bulk') {
        if (inventory.temp_reserved_quantity < remainingQty) throw new Error('Invalid reservation state');
        inventory.temp_reserved_quantity -= remainingQty;
        inventory.available_quantity -= remainingQty;
        txnItem.issued_quantity += remainingQty;
        await inventory.save({ session });
      }

      if (item.tracking_type === 'asset') {
        const itemAssets = await ItemAsset.find({
          lab_id: labObjectId, item_id: txnItem.item_id, status: 'available'
        }).limit(remainingQty).session(session);

        if (itemAssets.length !== remainingQty) throw new Error('Not enough available assets');

        txnItem.asset_ids = txnItem.asset_ids || [];
        for (const asset of itemAssets) {
          asset.status = 'issued';
          asset.last_transaction_id = transaction._id;
          await asset.save({ session });
          txnItem.asset_ids.push(asset._id);
        }

        txnItem.issued_quantity += itemAssets.length;
        inventory.temp_reserved_quantity -= itemAssets.length;

        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: labObjectId, item_id: txnItem.item_id, status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;
        await inventory.save({ session });
      }
    }

    if (!processedAnyItem) throw new Error('No items available to issue for this lab');

    const allIssued = transaction.items.every(i => i.issued_quantity >= i.quantity);
    const anyIssued = transaction.items.some(i => i.issued_quantity > 0);

    if (allIssued) {
      transaction.status = 'active';
      transaction.issued_at = new Date();
    } else if (anyIssued) {
      transaction.status = 'partial_issued';
    }

    transaction.issued_by_incharge_id = req.user.id;
    await transaction.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: allIssued ? 'All items issued successfully' : 'Items issued for your lab successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(400).json({ error: err.message });
  }
};

/* ============================
   RETURN TRANSACTION
============================ */
exports.returnTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assistantLabId = req.user.lab_id;
    const { items } = req.body;

    // Validate lab ID
    if (!assistantLabId || !isValidObjectId(assistantLabId)) {
      throw new Error('Unauthorized lab access');
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No return items provided');
    }

    // Validate and sanitize transaction_id
    if (!req.params.transaction_id || !req.params.transaction_id.trim()) {
      throw new Error('Transaction ID is required');
    }
    const sanitizedTxnId = sanitizeText(req.params.transaction_id, 100);

    const labObjectId = new mongoose.Types.ObjectId(String(assistantLabId));

    const transaction = await Transaction.findOne({
      transaction_id: sanitizedTxnId,
      status: { $in: ['active', 'partial_returned'] }
    }).session(session);

    if (!transaction) throw new Error('Active transaction not found');

    let processedAnyItem = false;

    for (const returnItem of items) {
      // Validate required fields
      if (!returnItem.item_id || !returnItem.lab_id) {
        throw new Error('item_id and lab_id are required');
      }

      // Validate ObjectIds
      if (!isValidObjectId(returnItem.item_id) || !isValidObjectId(returnItem.lab_id)) {
        throw new Error('Invalid item_id or lab_id format');
      }

      if (returnItem.lab_id.toString() !== labObjectId.toString()) {
        throw new Error('Unauthorized lab access');
      }

      const txnItem = transaction.items.find(
        t => String(t.item_id) === String(returnItem.item_id) && String(t.lab_id) === String(returnItem.lab_id)
      );
      if (!txnItem) continue;

      const inventory = await LabInventory.findOne({ lab_id: labObjectId, item_id: txnItem.item_id }).session(session);
      if (!inventory) throw new Error('Inventory record missing');

      const item = await Item.findById(txnItem.item_id).session(session);
      if (!item) throw new Error('Item not found');

      if (item.tracking_type === 'bulk') {
        // Validate quantity
        const qty = Number(returnItem.returned_quantity);
        if (!isValidPositiveInteger(returnItem.returned_quantity)) {
          throw new Error('Invalid return quantity');
        }
        const remainingReturnable = txnItem.issued_quantity - txnItem.returned_quantity;
        if (qty > remainingReturnable) {
          throw new Error('Invalid bulk return quantity');
        }
        inventory.available_quantity += qty;
        txnItem.returned_quantity += qty;
        await inventory.save({ session });
      }

      if (item.tracking_type === 'asset') {
        const returnedIds = returnItem.returned_asset_ids || [];
        const damagedIds = returnItem.damaged_asset_ids || [];
        const allIds = [...returnedIds, ...damagedIds];

        if (allIds.length === 0) throw new Error('No asset IDs provided for return');

        // Validate all asset IDs are valid ObjectIds
        for (const id of allIds) {
          if (!isValidObjectId(id)) {
            throw new Error('Invalid asset ID format');
          }
        }

        const validIssuedIds = txnItem.asset_ids.map(a => a.toString());
        for (const id of allIds) {
          if (!validIssuedIds.includes(id.toString())) throw new Error('Asset not part of issued assets');
        }

        const remainingReturnable = txnItem.issued_quantity - txnItem.returned_quantity;
        if (allIds.length > remainingReturnable) throw new Error('Returning more assets than issued');

        for (const assetId of returnedIds) {
          const asset = await ItemAsset.findOne({ _id: assetId, lab_id: labObjectId, status: 'issued' }).session(session);
          if (!asset) throw new Error('Asset already returned or invalid');
          asset.status = 'available';
          asset.condition = 'good';
          asset.last_transaction_id = transaction._id;
          await asset.save({ session });
          txnItem.returned_quantity += 1;
        }

        for (const assetId of damagedIds) {
          const asset = await ItemAsset.findOne({ _id: assetId, lab_id: labObjectId, status: 'issued' }).session(session);
          if (!asset) throw new Error('Asset already returned or invalid');
          asset.status = 'damaged';
          asset.condition = 'broken';
          asset.last_transaction_id = transaction._id;
          await asset.save({ session });
          inventory.damaged_quantity += 1;

          // Sanitize damage reason and remarks
          const perAssetReason = Array.isArray(returnItem.per_asset_reasons)
            ? returnItem.per_asset_reasons.find(r => r.asset_id === assetId.toString())?.reason
            : null;

          const damageReason = sanitizeText(
            perAssetReason || returnItem.damage_reason || 'Reported damaged',
            500
          );
          const remarks = sanitizeText(returnItem.remarks || '', 1000);

          await DamagedAssetLog.create([{
            asset_id: asset._id,
            transaction_id: transaction._id,
            student_id: transaction.student_id || null,
            faculty_id: transaction.faculty_id || null,
            faculty_email: transaction.faculty_email || null,
            damage_reason: damageReason,
            remarks: remarks
          }], { session });

          txnItem.returned_quantity += 1;
        }

        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: labObjectId, item_id: txnItem.item_id, status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;
        await inventory.save({ session });
      }

      processedAnyItem = true;
    }

    if (!processedAnyItem) throw new Error('No returnable items for this lab');

    const allReturned = transaction.items.every(i => i.returned_quantity >= i.issued_quantity);
    const anyReturned = transaction.items.some(i => i.returned_quantity > 0);

    if (allReturned) {
      transaction.status = 'completed';
      transaction.actual_return_date = new Date();
    } else if (anyReturned) {
      transaction.status = 'partial_returned';
    }

    await transaction.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: allReturned ? 'Transaction completed successfully' : 'Items returned for your lab successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Return transaction error:', err);
    return res.status(400).json({ error: err.message });
  }
};

/* ============================
   GET PENDING TRANSACTIONS
============================ */
exports.getPendingTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: { $in: ['approved', 'partial_issued'] }, 'items.lab_id': labObjectId } },

      // Keep only this lab's items that still need issuing
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: {
                $and: [
                  { $eq: ['$$item.lab_id', labObjectId] },
                  { $lt: [{ $ifNull: ['$$item.issued_quantity', 0] }, '$$item.quantity'] }
                ]
              }
            }
          }
        }
      },

      { $match: { 'items.0': { $exists: true } } },

      // Add remaining_quantity per item
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  { remaining_quantity: { $subtract: ['$$item.quantity', { $ifNull: ['$$item.issued_quantity', 0] }] } }
                ]
              }
            }
          }
        }
      },

      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },

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
      { $facet: { metadata: [{ $count: 'total' }], data: [{ $skip: skip }, { $limit: limit }] } }
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
    console.error('Get pending transactions error:', err);
    return res.status(500).json({ error: 'Failed to load pending transactions' });
  }
};

/* ============================
   GET ACTIVE TRANSACTIONS
============================ */
exports.getActiveTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: { $in: ['active', 'partial_issued', 'partial_returned'] }, 'items.lab_id': labObjectId } },

      // Keep only this lab's items that still need returning
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: {
                $and: [
                  { $eq: ['$$item.lab_id', labObjectId] },
                  { $gt: [{ $ifNull: ['$$item.issued_quantity', 0] }, { $ifNull: ['$$item.returned_quantity', 0] }] }
                ]
              }
            }
          }
        }
      },

      { $match: { 'items.0': { $exists: true } } },

      // Add remaining_return per item
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    remaining_return: {
                      $subtract: [{ $ifNull: ['$$item.issued_quantity', 0] }, { $ifNull: ['$$item.returned_quantity', 0] }]
                    }
                  }
                ]
              }
            }
          }
        }
      },

      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },

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
      { $sort: { issued_at: -1, createdAt: -1 } },
      { $facet: { metadata: [{ $count: 'total' }], data: [{ $skip: skip }, { $limit: limit }] } }
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
    console.error('Get active transactions error:', err);
    return res.status(500).json({ error: 'Failed to load active transactions' });
  }
};

/* ============================
   GET AVAILABLE ASSETS FOR ITEM
============================ */
exports.getAvailableAssetsByItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const { itemId } = req.params;

    // Validate lab ID
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    // Validate item ID
    if (!itemId || !isValidObjectId(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    const assets = await ItemAsset.find({ lab_id: labId, item_id: itemId, status: 'available' })
      .select('asset_tag serial_no condition status')
      .sort({ asset_tag: 1 }).lean();

    return res.json({ success: true, count: assets.length, data: assets });

  } catch (err) {
    console.error('Get available assets error:', err);
    return res.status(500).json({ error: 'Failed to load available assets' });
  }
};

/* ============================
   ISSUE LAB SESSION
============================ */
exports.issueLabSession = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assistantLabId = req.user.lab_id;
    const { student_reg_no, faculty_email, faculty_id, lab_slot, items } = req.body;

    // Validate lab ID
    if (!assistantLabId || !isValidObjectId(assistantLabId)) {
      throw new Error('Unauthorized lab access');
    }

    // Validate required fields
    if (!faculty_email || !faculty_id || !lab_slot) {
      throw new Error('Missing required fields: faculty_email, faculty_id, or lab_slot');
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Items array is required and must not be empty');
    }

    // Validate email
    if (!isValidEmail(faculty_email)) {
      throw new Error('Invalid email format');
    }

    // Sanitize text inputs
    const sanitizedFacultyId = sanitizeText(faculty_id, 100);
    const sanitizedLabSlot = sanitizeText(lab_slot, 100);
    const sanitizedStudentRegNo = student_reg_no ? sanitizeText(student_reg_no, 50) : 'LAB-SESSION';

    const labObjectId = new mongoose.Types.ObjectId(String(assistantLabId));
    const issuedAt = new Date();
    const expectedReturnDate = new Date(issuedAt.getTime() + 2 * 60 * 60 * 1000);

    const transaction = await Transaction.create([{
      transaction_id: `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      project_name: 'LAB_SESSION',
      transaction_type: 'lab_session',
      issued_directly: true,
      status: 'active',
      student_id: null,
      student_reg_no: sanitizedStudentRegNo,
      faculty_email,
      faculty_id: sanitizedFacultyId,
      lab_slot: sanitizedLabSlot,
      items: [],
      issued_by_incharge_id: req.user.id,
      issued_at: issuedAt,
      expected_return_date: expectedReturnDate
    }], { session });

    const txn = transaction[0];

    for (const it of items) {
      // Validate item_id
      if (!it.item_id || !isValidObjectId(it.item_id)) {
        throw new Error('Invalid item ID format');
      }

      // Validate quantity
      if (!it.quantity || !isValidPositiveInteger(it.quantity)) {
        throw new Error('Invalid quantity value');
      }

      const item = await Item.findById(it.item_id).session(session);
      if (!item || !item.is_active) throw new Error('Invalid item selected');

      const inventory = await LabInventory.findOne({ lab_id: labObjectId, item_id: it.item_id }).session(session);
      if (!inventory) throw new Error('Item not found in this lab');

      if (item.tracking_type === 'bulk') {
        if (inventory.available_quantity < it.quantity) throw new Error(`Insufficient stock for ${item.name}`);
        inventory.available_quantity -= it.quantity;
        await inventory.save({ session });
        txn.items.push({ lab_id: labObjectId, item_id: item._id, quantity: it.quantity, issued_quantity: it.quantity, returned_quantity: 0 });
      }

      if (item.tracking_type === 'asset') {
        const assets = await ItemAsset.find({ lab_id: labObjectId, item_id: item._id, status: 'available' }).limit(it.quantity).session(session);
        if (assets.length < it.quantity) throw new Error(`Not enough assets for ${item.name}`);

        const assetIds = [];
        for (const asset of assets) {
          asset.status = 'issued';
          asset.last_transaction_id = txn._id;
          await asset.save({ session });
          assetIds.push(asset._id);
        }

        const actualAvailable = await ItemAsset.countDocuments({ lab_id: labObjectId, item_id: item._id, status: 'available' }).session(session);
        inventory.available_quantity = actualAvailable;
        await inventory.save({ session });

        txn.items.push({ lab_id: labObjectId, item_id: item._id, quantity: it.quantity, asset_ids: assetIds, issued_quantity: assetIds.length, returned_quantity: 0 });
      }
    }

    await txn.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true, message: 'Lab session items issued successfully',
      transaction_id: txn.transaction_id, issued_at: issuedAt, expected_return_date: expectedReturnDate
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Lab session issue error:', err);
    return res.status(400).json({ error: err.message });
  }
};

/* ============================
   GET AVAILABLE LAB ITEMS
   Paginated + debounce search on name / sku / tracking_type
============================ */
exports.getAvailableLabItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const { q, page = 1, limit = 25 } = req.query;

    // Validate pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Build item-level filter
    const itemMatch = { is_active: true };
    if (q && q.trim().length > 0) {
      // Sanitize and escape regex input to prevent ReDoS
      const sanitizedQ = escapeRegex(sanitizeText(q.trim(), 100));
      const regex = new RegExp(sanitizedQ, 'i');
      itemMatch.$or = [
        { name: regex },
        { sku: regex },
        { tracking_type: regex },
        { category: regex },
      ];
    }

    // Find matching items first
    const matchingItems = await Item.find(itemMatch)
      .select('_id name sku category tracking_type')
      .lean();

    const matchingItemIds = matchingItems.map(i => i._id);

    if (q && q.trim().length > 0 && matchingItemIds.length === 0) {
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

    // Build inventory filter
    const inventoryFilter = {
      lab_id: labId,
      available_quantity: { $gt: 0 }
    };

    if (q && q.trim().length > 0) {
      inventoryFilter.item_id = { $in: matchingItemIds };
    }

    const [total, inventories] = await Promise.all([
      LabInventory.countDocuments(inventoryFilter),
      LabInventory.find(inventoryFilter)
        .populate('item_id', 'name sku category tracking_type is_active')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    const formatted = inventories
      .filter(inv => inv.item_id?.is_active)
      .map(inv => ({
        item_id: inv.item_id._id,
        name: inv.item_id.name,
        sku: inv.item_id.sku,
        category: inv.item_id.category,
        tracking_type: inv.item_id.tracking_type,
        available_quantity: inv.available_quantity,
        reserved_quantity: inv.reserved_quantity
      }));

    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems: total,
      totalPages: Math.ceil(total / limitNum),
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get lab items error:', err);
    return res.status(500).json({ error: 'Failed to fetch lab items' });
  }
};

/* ============================
   SEARCH LAB ITEMS
============================ */
exports.searchLabItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const { q } = req.query;
    const itemFilter = { is_active: true };

    if (q) {
      // Sanitize and escape regex input to prevent ReDoS
      const sanitizedQ = escapeRegex(sanitizeText(q, 100));
      const regex = new RegExp(sanitizedQ, 'i');
      itemFilter.$or = [
        { name: regex },
        { sku: regex },
        { category: regex }
      ];
    }

    const matchingItems = await Item.find(itemFilter).select('_id name sku category tracking_type').lean();
    const itemIds = matchingItems.map(i => i._id);
    if (itemIds.length === 0) return res.json({ success: true, count: 0, data: [] });

    const inventories = await LabInventory.find({ lab_id: labId, item_id: { $in: itemIds }, available_quantity: { $gt: 0 } })
      .populate('item_id', 'name sku category tracking_type').lean();

    const formatted = inventories.map(inv => ({
      item_id: inv.item_id._id, name: inv.item_id.name, sku: inv.item_id.sku,
      category: inv.item_id.category, tracking_type: inv.item_id.tracking_type,
      available_quantity: inv.available_quantity, reserved_quantity: inv.reserved_quantity
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });

  } catch (err) {
    console.error('Search lab items error:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
};

/* ============================
   GET ACTIVE LAB SESSIONS
============================ */
exports.getActiveLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) return res.status(403).json({ error: 'Lab access denied' });

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: 'active', transaction_type: 'lab_session', 'items.lab_id': labObjectId } },

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

      { $match: { 'items.0': { $exists: true } } },

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
      { $sort: { issued_at: -1 } },
      { $facet: { metadata: [{ $count: 'total' }], data: [{ $skip: skip }, { $limit: limit }] } }
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
    console.error('Get active lab sessions error:', err);
    return res.status(500).json({ error: 'Failed to fetch active lab sessions' });
  }
};


exports.searchPendingTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const { q, page = 1, limit = 25 } = req.query;

    // Validate pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Build prefix match filter at transaction level
    const matchStage = {
      status: { $in: ['approved', 'partial_issued'] },
      'items.lab_id': labObjectId
    };

    if (q && q.trim().length > 0) {
      // Sanitize and escape regex input to prevent ReDoS
      const sanitizedPrefix = escapeRegex(sanitizeText(q.trim(), 100));
      matchStage.$or = [
        { transaction_id: { $regex: new RegExp(`^${sanitizedPrefix}`, 'i') } },
        { student_reg_no: { $regex: new RegExp(`^${sanitizedPrefix}`, 'i') } }
      ];
    }
 
    const pipeline = [
      { $match: matchStage },
 
      // Keep only this lab's items that still need issuing
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: {
                $and: [
                  { $eq: ['$$item.lab_id', labObjectId] },
                  { $lt: [{ $ifNull: ['$$item.issued_quantity', 0] }, '$$item.quantity'] }
                ]
              }
            }
          }
        }
      },
 
      { $match: { 'items.0': { $exists: true } } },
 
      // Add remaining_quantity per item
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    remaining_quantity: {
                      $subtract: ['$$item.quantity', { $ifNull: ['$$item.issued_quantity', 0] }]
                    }
                  }
                ]
              }
            }
          }
        }
      },
 
      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },
 
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
          data: [{ $skip: skip }, { $limit: limitNum }]
        }
      }
    ];
 
    const result = await Transaction.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];
 
    return res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems: total,
      totalPages: Math.ceil(total / limitNum),
      count: data.length,
      data
    });
 
  } catch (err) {
    console.error('Search pending transactions error:', err);
    return res.status(500).json({ error: 'Failed to search pending transactions' });
  }
};
 
/* ============================
   SEARCH ACTIVE TRANSACTIONS
   Prefix match on transaction_id + student_reg_no
============================ */
exports.searchActiveTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId || !isValidObjectId(labId)) {
      return res.status(403).json({ error: 'Lab access denied' });
    }

    const labObjectId = new mongoose.Types.ObjectId(String(labId));
    const { q, page = 1, limit = 25 } = req.query;

    // Validate pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const matchStage = {
      status: { $in: ['active', 'partial_issued', 'partial_returned'] },
      'items.lab_id': labObjectId
    };

    if (q && q.trim().length > 0) {
      // Sanitize and escape regex input to prevent ReDoS
      const sanitizedPrefix = escapeRegex(sanitizeText(q.trim(), 100));
      matchStage.$or = [
        { transaction_id: { $regex: new RegExp(`^${sanitizedPrefix}`, 'i') } },
        { student_reg_no: { $regex: new RegExp(`^${sanitizedPrefix}`, 'i') } }
      ];
    }
 
    const pipeline = [
      { $match: matchStage },
 
      // Keep only this lab's items that still need returning
      {
        $addFields: {
          items: {
            $filter: {
              input: '$items', as: 'item',
              cond: {
                $and: [
                  { $eq: ['$$item.lab_id', labObjectId] },
                  { $gt: [{ $ifNull: ['$$item.issued_quantity', 0] }, { $ifNull: ['$$item.returned_quantity', 0] }] }
                ]
              }
            }
          }
        }
      },
 
      { $match: { 'items.0': { $exists: true } } },
 
      // Add remaining_return per item
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    remaining_return: {
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
 
      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student_id',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student_id', preserveNullAndEmptyArrays: true } },
 
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
      { $sort: { issued_at: -1, createdAt: -1 } },
 
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
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems: total,
      totalPages: Math.ceil(total / limitNum),
      count: data.length,
      data
    });
 
  } catch (err) {
    console.error('Search active transactions error:', err);
    return res.status(500).json({ error: 'Failed to search active transactions' });
  }
};

/* ============================
   GET ASSISTANT PROFILE
============================ */
exports.getAssistantProfile = async (req, res) => {
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
    console.error('GET ASSISTANT PROFILE ERROR:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};