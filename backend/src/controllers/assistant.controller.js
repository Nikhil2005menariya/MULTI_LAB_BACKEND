const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const ItemAsset = require('../models/ItemAsset');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const Item =require('../models/Item');

exports.issueTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transaction_id } = req.params;
    const assistantLabId = req.user.lab_id;

    if (!assistantLabId) {
      throw new Error('Unauthorized lab access');
    }

    const transaction = await Transaction.findOne({
      transaction_id,
      status: { $in: ['approved', 'partial_issued', 'active'] }
    }).session(session);

    if (!transaction) {
      throw new Error('Transaction not found or not allowed');
    }

    let processedAnyItem = false;

    for (const txnItem of transaction.items) {

      if (txnItem.lab_id.toString() !== assistantLabId.toString()) {
        continue;
      }

      if (txnItem.issued_quantity >= txnItem.quantity) {
        continue;
      }

      processedAnyItem = true;

      const inventory = await LabInventory.findOne({
        lab_id: assistantLabId,
        item_id: txnItem.item_id
      }).session(session);

      if (!inventory) {
        throw new Error('Inventory record not found');
      }

      const remainingQty =
        txnItem.quantity - txnItem.issued_quantity;

      const item = await Item.findById(txnItem.item_id).session(session);

      /* ================= BULK ================= */
      if (item.tracking_type === 'bulk') {

        if (inventory.temp_reserved_quantity < remainingQty) {
          throw new Error('Invalid reservation state');
        }

        inventory.temp_reserved_quantity -= remainingQty;
        inventory.available_quantity -= remainingQty;

        txnItem.issued_quantity += remainingQty;

        await inventory.save({ session });
      }

      /* ================= ASSET ================= */
      if (item.tracking_type === 'asset') {

        const itemAssets = await ItemAsset.find({
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        })
          .limit(remainingQty)
          .session(session);

        if (itemAssets.length !== remainingQty) {
          throw new Error('Not enough available assets');
        }

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
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;

        await inventory.save({ session });
      }
    }

    if (!processedAnyItem) {
      throw new Error('No items available to issue for this lab');
    }

    /* ================= STATUS MANAGEMENT ================= */

    const allIssued = transaction.items.every(
      item => item.issued_quantity === item.quantity
    );

    const anyIssued = transaction.items.some(
      item => item.issued_quantity > 0
    );

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
      message: allIssued
        ? 'All items issued successfully'
        : 'Items issued for your lab successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      error: err.message
    });
  }
};

exports.returnTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assistantLabId = req.user.lab_id;
    const { items } = req.body;

    if (!assistantLabId) {
      throw new Error('Unauthorized lab access');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No return items provided');
    }

    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      status: { $in: ['active', 'partial_returned'] }
    }).session(session);

    if (!transaction) {
      throw new Error('Active transaction not found');
    }

    let processedAnyItem = false;

    for (const returnItem of items) {

      if (!returnItem.item_id || !returnItem.lab_id) {
        throw new Error('item_id and lab_id are required');
      }

      const txnItem = transaction.items.find(
        t =>
          String(t.item_id) === String(returnItem.item_id) &&
          String(t.lab_id) === String(returnItem.lab_id)
      );

      if (!txnItem) continue;

      if (String(txnItem.lab_id) !== String(assistantLabId)) {
        throw new Error('Unauthorized lab access');
      }

      const inventory = await LabInventory.findOne({
        lab_id: assistantLabId,
        item_id: txnItem.item_id
      }).session(session);

      if (!inventory) {
        throw new Error('Inventory record missing');
      }

      const item = await Item.findById(txnItem.item_id).session(session);

      /* ================= BULK ================= */
      if (item.tracking_type === 'bulk') {

        const qty = Number(returnItem.returned_quantity);

        const remainingReturnable =
          txnItem.issued_quantity - txnItem.returned_quantity;

        if (!qty || qty <= 0 || qty > remainingReturnable) {
          throw new Error('Invalid bulk return quantity');
        }

        inventory.available_quantity += qty;
        txnItem.returned_quantity += qty;

        await inventory.save({ session });
      }

      /* ================= ASSET ================= */
      if (item.tracking_type === 'asset') {

        const returnedIds = returnItem.returned_asset_ids || [];
        const damagedIds = returnItem.damaged_asset_ids || [];

        const allIds = [...returnedIds, ...damagedIds];

        if (allIds.length === 0) {
          throw new Error('No asset IDs provided for return');
        }

        const validIssuedIds = txnItem.asset_ids.map(a => a.toString());

        for (const id of allIds) {
          if (!validIssuedIds.includes(id)) {
            throw new Error('Asset not part of issued assets');
          }
        }

        const remainingReturnable =
          txnItem.issued_quantity - txnItem.returned_quantity;

        if (allIds.length > remainingReturnable) {
          throw new Error('Returning more assets than issued');
        }

        for (const assetId of returnedIds) {

          const asset = await ItemAsset.findOne({
            _id: assetId,
            lab_id: assistantLabId,
            status: 'issued'
          }).session(session);

          if (!asset) {
            throw new Error('Asset already returned or invalid');
          }

          asset.status = 'available';
          asset.condition = 'good';
          asset.last_transaction_id = transaction._id;

          await asset.save({ session });

          txnItem.returned_quantity += 1;
        }

        for (const assetId of damagedIds) {

          const asset = await ItemAsset.findOne({
            _id: assetId,
            lab_id: assistantLabId,
            status: 'issued'
          }).session(session);

          if (!asset) {
            throw new Error('Asset already returned or invalid');
          }

          asset.status = 'damaged';
          asset.condition = 'broken';
          asset.last_transaction_id = transaction._id;

          await asset.save({ session });

          inventory.damaged_quantity += 1;

          await DamagedAssetLog.create([{
            asset_id: asset._id,
            transaction_id: transaction._id,
            student_id: transaction.student_id || null,
            faculty_id: transaction.faculty_id || null,
            faculty_email: transaction.faculty_email || null,
            damage_reason: returnItem.damage_reason || 'Reported damaged',
            remarks: returnItem.remarks || ''
          }], { session });

          txnItem.returned_quantity += 1;
        }

        // 🔥 ALWAYS RECALCULATE AVAILABLE FROM DB
        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;

        await inventory.save({ session });
      }

      processedAnyItem = true;
    }

    if (!processedAnyItem) {
      throw new Error('No returnable items for this lab');
    }

    /* ================= STATUS MANAGEMENT ================= */

    const allReturned = transaction.items.every(
      i => i.returned_quantity === i.issued_quantity
    );

    const anyReturned = transaction.items.some(
      i => i.returned_quantity > 0
    );

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
      message: allReturned
        ? 'Transaction completed successfully'
        : 'Items returned for your lab successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Return transaction error:', err);

    return res.status(400).json({
      error: err.message
    });
  }
};

/* ============================
   GET ACTIVE TRANSACTIONS
============================ */

exports.getActiveTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const transactions = await Transaction.find({
      status: { $in: ['active', 'partial_issued', 'partial_returned'] },
      'items.lab_id': labId
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate({
        path: 'items.asset_ids',
        select: 'asset_tag serial_no status'
      })
      .sort({ issued_at: -1, createdAt: -1 })
      .lean();

    const formatted = transactions
      .map(txn => {

        // 🔥 Only items belonging to this lab
        const labItems = txn.items.filter(
          i => i.lab_id.toString() === labId.toString()
        );

        // 🔥 Only items where return is still pending
        const activeItems = labItems
          .filter(i => i.issued_quantity > i.returned_quantity)
          .map(i => ({
            ...i,
            asset_tags: i.asset_ids?.map(a => a.asset_tag) || [],
            remaining_return:
              i.issued_quantity - i.returned_quantity
          }));

        if (activeItems.length === 0) return null;

        return {
          ...txn,
          items: activeItems
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get active transactions error:', err);
    return res.status(500).json({
      error: 'Failed to load active transactions'
    });
  }
};
/* ============================
   GET PENDING TRANSACTIONS 
============================ */
exports.getPendingTransactions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const transactions = await Transaction.find({
      status: { $in: ['approved', 'partial_issued'] }, // 🔥 fixed
      'items.lab_id': labId
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate({
        path: 'items.asset_ids',
        select: 'asset_tag serial_no status'
      })
      .sort({ createdAt: -1 })
      .lean();

    const formatted = transactions
      .map(txn => {

        const filteredItems = txn.items
          .filter(i =>
            i.lab_id.toString() === labId.toString() &&
            i.issued_quantity < i.quantity // 🔥 issue remaining
          )
          .map(i => ({
            ...i,
            asset_tags: i.asset_ids?.map(a => a.asset_tag) || [],
            remaining_quantity: i.quantity - i.issued_quantity
          }));

        if (filteredItems.length === 0) return null;

        return {
          ...txn,
          items: filteredItems
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get pending transactions error:', err);
    return res.status(500).json({
      error: 'Failed to load pending transactions'
    });
  }
};

/* ============================
   GET AVAILABLE ASSETS FOR ITEM
============================ */
exports.getAvailableAssetsByItem = async (req, res) => {
  try {
    const labId = req.user.lab_id;
    const { itemId } = req.params;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const assets = await ItemAsset.find({
      lab_id: labId,          // 🔒 LAB ISOLATION
      item_id: itemId,
      status: 'available'
    })
      .select('asset_tag serial_no condition status')
      .sort({ asset_tag: 1 })
      .lean();

    return res.json({
      success: true,
      count: assets.length,
      data: assets
    });

  } catch (err) {
    console.error('Get available assets error:', err);
    return res.status(500).json({
      error: 'Failed to load available assets'
    });
  }
};


exports.issueLabSession = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assistantLabId = req.user.lab_id;

    const {
      student_reg_no,
      faculty_email,
      faculty_id,
      lab_slot,
      items
    } = req.body;

    if (
      !assistantLabId ||
      !faculty_email ||
      !faculty_id ||
      !lab_slot ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      throw new Error('Missing required fields');
    }

    const issuedAt = new Date();
    const expectedReturnDate = new Date(
      issuedAt.getTime() + 2 * 60 * 60 * 1000
    );

    const transaction = await Transaction.create([{
      transaction_id: `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      project_name: 'LAB_SESSION',
      transaction_type: 'lab_session',
      issued_directly: true,
      status: 'active',

      student_id: null,
      student_reg_no: student_reg_no || 'LAB-SESSION',

      faculty_email,
      faculty_id,
      lab_slot,

      items: [],

      issued_by_incharge_id: req.user.id,
      issued_at: issuedAt,
      expected_return_date: expectedReturnDate
    }], { session });

    const txn = transaction[0];

    /* ================= PROCESS ITEMS ================= */
    for (const it of items) {

      const item = await Item.findById(it.item_id).session(session);
      if (!item || !item.is_active) {
        throw new Error('Invalid item selected');
      }

      const inventory = await LabInventory.findOne({
        lab_id: assistantLabId,
        item_id: it.item_id
      }).session(session);

      if (!inventory) {
        throw new Error('Item not found in this lab');
      }

      /* ================= BULK ================= */
      if (item.tracking_type === 'bulk') {

        if (!it.quantity || it.quantity <= 0) {
          throw new Error(`Invalid quantity for ${item.name}`);
        }

        if (inventory.available_quantity < it.quantity) {
          throw new Error(`Insufficient stock for ${item.name}`);
        }

        inventory.available_quantity -= it.quantity;

        await inventory.save({ session });

        txn.items.push({
          lab_id: assistantLabId,
          item_id: item._id,
          quantity: it.quantity,
          issued_quantity: it.quantity
        });
      }

      /* ================= ASSET ================= */
      if (item.tracking_type === 'asset') {

        if (!it.quantity || it.quantity <= 0) {
          throw new Error(`Quantity required for ${item.name}`);
        }

        const assets = await ItemAsset.find({
          lab_id: assistantLabId,
          item_id: item._id,
          status: 'available'
        })
          .limit(it.quantity)
          .session(session);

        if (assets.length < it.quantity) {
          throw new Error(`Not enough assets for ${item.name}`);
        }

        const assetIds = [];

        for (const asset of assets) {
          asset.status = 'issued';
          asset.last_transaction_id = txn._id;
          await asset.save({ session });
          assetIds.push(asset._id);
        }

        /* 🔥 RE-CALCULATE AVAILABLE (Single Source of Truth) */
        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: assistantLabId,
          item_id: item._id,
          status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;

        await inventory.save({ session });

        txn.items.push({
          lab_id: assistantLabId,
          item_id: item._id,
          asset_ids: assetIds,
          issued_quantity: assetIds.length
        });
      }
    }

    await txn.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: 'Lab session items issued successfully',
      transaction_id: txn.transaction_id,
      issued_at: issuedAt,
      expected_return_date: expectedReturnDate
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Lab session issue error:', err);

    return res.status(400).json({
      error: err.message
    });
  }
};



/* ============================
   GET AVAILABLE ITEMS 
============================ */
exports.getAvailableLabItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const inventories = await LabInventory.find({
      lab_id: labId,
      reserved_quantity: { $gt: 0 }   // 🔥 ONLY RESERVED
    })
      .populate('item_id', 'name sku category tracking_type')
      .sort({ 'item_id.name': 1 })
      .lean();

    const formatted = inventories.map(inv => ({
      item_id: inv.item_id._id,
      name: inv.item_id.name,
      sku: inv.item_id.sku,
      category: inv.item_id.category,
      tracking_type: inv.item_id.tracking_type,
      reserved_quantity: inv.reserved_quantity
    }));

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get lab items error:', err);
    return res.status(500).json({
      error: 'Failed to fetch lab items'
    });
  }
};


/* ============================
   SEARCH LAB ITEMS
============================ */
exports.searchLabItems = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const { q } = req.query;

    // 🔥 Build item search filter
    const itemFilter = {};

    if (q) {
      itemFilter.$or = [
        { name: new RegExp(q, 'i') },
        { sku: new RegExp(q, 'i') },
        { category: new RegExp(q, 'i') }
      ];
    }

    // 🔥 Find matching items first
    const matchingItems = await Item.find({
      is_active: true,
      ...itemFilter
    })
      .select('_id name sku category tracking_type')
      .lean();

    const itemIds = matchingItems.map(i => i._id);

    if (itemIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    // 🔥 Now filter lab inventory for this lab only
    const inventories = await LabInventory.find({
      lab_id: labId,
      item_id: { $in: itemIds },
      reserved_quantity: { $gt: 0 } // 🔥 ONLY RESERVED
    })
      .populate('item_id', 'name sku category tracking_type')
      .sort({ 'item_id.name': 1 })
      .lean();

    const formatted = inventories.map(inv => ({
      item_id: inv.item_id._id,
      name: inv.item_id.name,
      sku: inv.item_id.sku,
      category: inv.item_id.category,
      tracking_type: inv.item_id.tracking_type,
      reserved_quantity: inv.reserved_quantity
    }));

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Search lab items error:', err);
    return res.status(500).json({
      error: 'Search failed'
    });
  }
};


/* ============================
   GET ACTIVE LAB SESSION BORROWS
============================ */
exports.getActiveLabSessions = async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        error: 'Lab access denied'
      });
    }

    const transactions = await Transaction.find({
      status: 'active',
      transaction_type: 'lab_session',
      'items.lab_id': labId   // 🔥 LAB ISOLATION
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag serial_no status')
      .sort({ issued_at: -1 })
      .lean();

    return res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (err) {
    console.error('Get active lab sessions error:', err);
    return res.status(500).json({
      error: 'Failed to fetch active lab sessions'
    });
  }
};






