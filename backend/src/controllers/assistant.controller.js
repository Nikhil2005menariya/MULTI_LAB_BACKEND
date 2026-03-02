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

    const transaction = await Transaction.findOne({
      transaction_id,
      status: 'approved'
    }).session(session);

    if (!transaction) {
      throw new Error('Transaction not found or not approved');
    }

    for (const txnItem of transaction.items) {

      if (txnItem.lab_id.toString() !== assistantLabId.toString()) {
        throw new Error('Unauthorized lab access');
      }

      const inventory = await LabInventory.findOne({
        lab_id: assistantLabId,
        item_id: txnItem.item_id
      }).session(session);

      if (!inventory) {
        throw new Error('Inventory record not found');
      }

      /* ================= BULK ================= */
      if (txnItem.quantity > 0) {

        if (inventory.temp_reserved_quantity < txnItem.quantity) {
          throw new Error('Invalid reservation state');
        }

        inventory.temp_reserved_quantity -= txnItem.quantity;
        inventory.available_quantity -= txnItem.quantity;

        txnItem.issued_quantity = txnItem.quantity;

        await inventory.save({ session });
      }

      /* ================= ASSET ================= */
      if (txnItem.quantity > 0) {

        const itemAssets = await ItemAsset.find({
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        })
          .limit(txnItem.quantity)
          .session(session);

        if (itemAssets.length !== txnItem.quantity) {
          throw new Error('Not enough available assets');
        }

        txnItem.asset_ids = itemAssets.map(a => a._id);
        txnItem.issued_quantity = itemAssets.length;

        for (const asset of itemAssets) {
          asset.status = 'issued';
          asset.last_transaction_id = transaction._id;
          await asset.save({ session });
        }

        // 🔥 Clear temp reservation
        inventory.temp_reserved_quantity -= itemAssets.length;

        // 🔥 RE-CALCULATE AVAILABLE FROM SOURCE OF TRUTH
        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;

        await inventory.save({ session });
      }
    }

    transaction.status = 'active';
    transaction.issued_by_incharge_id = req.user.id;
    transaction.issued_at = new Date();

    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: 'Items issued successfully'
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(400).json({ error: err.message });
  }
};


exports.returnTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assistantLabId = req.user.lab_id;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No return items provided');
    }

    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      status: 'active'
    }).session(session);

    if (!transaction) {
      throw new Error('Active transaction not found');
    }

    for (const returnItem of items) {

      const txnItem = transaction.items.find(
        t => String(t.item_id) === String(returnItem.item_id)
      );

      if (!txnItem) {
        throw new Error('Item not part of transaction');
      }

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

      /* ================= BULK ================= */
      if (txnItem.quantity > 0) {

        const qty = Number(returnItem.returned_quantity);

        if (!qty || qty <= 0 || qty > txnItem.issued_quantity) {
          throw new Error('Invalid bulk return quantity');
        }

        inventory.available_quantity += qty;
        txnItem.returned_quantity = qty;

        await inventory.save({ session });
      }

      /* ================= ASSET ================= */
      if (txnItem.asset_ids && txnItem.asset_ids.length > 0) {

        const damagedIds = returnItem.damaged_asset_ids || [];

        // Validate damaged ⊆ issued
        for (const id of damagedIds) {
          if (!txnItem.asset_ids.map(a => a.toString()).includes(id)) {
            throw new Error('Damaged asset not part of issued assets');
          }
        }

        for (const assetId of txnItem.asset_ids) {

          const asset = await ItemAsset.findById(assetId).session(session);
          if (!asset) continue;

          if (damagedIds.includes(assetId.toString())) {

            asset.status = 'damaged';
            asset.condition = 'broken';

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

          } else {

            asset.status = 'available';
            asset.condition = 'good';
          }

          asset.last_transaction_id = transaction._id;
          await asset.save({ session });
        }

        txnItem.returned_quantity = txnItem.asset_ids.length;

        /* 🔥 RE-CALCULATE AVAILABLE FROM SOURCE OF TRUTH */
        const actualAvailable = await ItemAsset.countDocuments({
          lab_id: assistantLabId,
          item_id: txnItem.item_id,
          status: 'available'
        }).session(session);

        inventory.available_quantity = actualAvailable;

        await inventory.save({ session });
      }
    }

    transaction.status = 'completed';
    transaction.actual_return_date = new Date();

    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: 'Transaction completed successfully'
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
      status: 'active',
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

    /* ===============================
       FORMAT ASSET TAGS FOR FRONTEND
    =============================== */
    const formatted = transactions.map(txn => ({
      ...txn,
      items: txn.items
        .filter(i => i.lab_id.toString() === labId.toString()) // 🔒 strict lab isolation
        .map(i => ({
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
      status: 'approved',
      'items.lab_id': labId // 🔒 LAB ISOLATION
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .populate({
        path: 'items.asset_ids',
        select: 'asset_tag serial_no status'
      })
      .sort({ createdAt: -1 })
      .lean();

    /* ===============================
       STRICT LAB FILTER + FORMAT
    =============================== */
    const formatted = transactions.map(txn => ({
      ...txn,
      items: txn.items
        .filter(i => i.lab_id.toString() === labId.toString())
        .map(i => ({
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
   GET AVAILABLE ITEMS (LAB)
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






