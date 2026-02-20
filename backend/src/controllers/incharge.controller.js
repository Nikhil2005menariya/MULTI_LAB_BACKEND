const Transaction = require('../models/Transaction');
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const DamagedAssetLog = require('../models/DamagedAssetLog'); // ✅ NEW
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');

/* ============================
   ISSUE ITEMS (APPROVED → ACTIVE)
============================ */
exports.issueTransaction = async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { items } = req.body;

    // 1️⃣ Fetch approved transaction
    const transaction = await Transaction.findOne({
      transaction_id,
      status: 'approved',
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found or not approved',
      });
    }

    // 2️⃣ Process each transaction item
    for (const tItem of transaction.items) {
      const item = await Item.findById(tItem.item_id);
      if (!item) {
        return res.status(400).json({
          error: 'Invalid item in transaction',
        });
      }

      /* ================= BULK ITEM ================= */
      if (item.tracking_type === 'bulk') {
        const usableQty =
          item.available_quantity - (item.reserved_quantity || 0);

        if (usableQty < tItem.quantity) {
          return res.status(400).json({
            error: `Insufficient stock for ${item.name}`,
          });
        }

        // Update stock
        item.available_quantity -= tItem.quantity;
        tItem.issued_quantity = tItem.quantity;

        await item.save();
      }

      /* ================= ASSET ITEM ================= */
      if (item.tracking_type === 'asset') {
        const issuedAsset = items?.find(
          (i) => String(i.item_id) === String(item._id)
        );

        if (!issuedAsset || !issuedAsset.asset_tags?.length) {
          return res.status(400).json({
            error: `Asset tags required for ${item.name}`,
          });
        }

        if (issuedAsset.asset_tags.length !== tItem.quantity) {
          return res.status(400).json({
            error: `Asset tag count mismatch for ${item.name}`,
          });
        }

        // Issue each asset tag
        for (const tag of issuedAsset.asset_tags) {
          const asset = await ItemAsset.findOne({
            asset_tag: tag,
            item_id: item._id,
            status: 'available',
          });

          if (!asset) {
            return res.status(400).json({
              error: `Asset ${tag} not available`,
            });
          }

          asset.status = 'issued';
          asset.last_transaction_id = transaction._id;
          await asset.save();
        }

        // 🔴 CRITICAL FIX — update item availability
        item.available_quantity -= issuedAsset.asset_tags.length;
        await item.save();

        // Store issued info in transaction
        tItem.asset_tags = issuedAsset.asset_tags;
        tItem.issued_quantity = issuedAsset.asset_tags.length;
      }
    }

    // 3️⃣ Finalize transaction
    transaction.status = 'active';
    transaction.issued_by_incharge_id = req.user.id;
    transaction.issued_at = new Date();

    await transaction.save();

    return res.json({
      success: true,
      message: 'Items issued successfully',
      transaction_id,
    });

  } catch (err) {
    console.error('Issue transaction error:', err);
    return res.status(500).json({
      error: 'Failed to issue transaction',
    });
  }
};

/* ============================
   RETURN TRANSACTION (ACTIVE → COMPLETED)
============================ */
exports.returnTransaction = async (req, res) => {
  try {
    const { returned_items } = req.body;

    if (!Array.isArray(returned_items) || returned_items.length === 0) {
      return res.status(400).json({ error: 'No returned items provided' });
    }

    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id,
      status: 'active'
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Active transaction not found' });
    }

    /* ❌ BLOCK PERMANENT LAB TRANSFER RETURNS */
    if (transaction.damage_notes === 'permanent-transfer') {
      return res.status(400).json({
        error: 'Permanent lab transfer cannot be returned'
      });
    }

    for (const rItem of returned_items) {
      const item = await Item.findById(rItem.item_id);
      if (!item) {
        return res.status(400).json({ error: 'Invalid item' });
      }

      const txnItem = transaction.items.find(
        t => String(t.item_id) === String(item._id)
      );

      if (!txnItem) {
        return res.status(400).json({
          error: `Item ${item.name} not part of transaction`
        });
      }

      /* =====================================================
         BULK ITEM RETURN
      ===================================================== */
      if (item.tracking_type === 'bulk') {
        const qty = Number(rItem.quantity);

        if (!Number.isFinite(qty) || qty <= 0) {
          return res.status(400).json({ error: 'Invalid quantity' });
        }

        item.available_quantity += qty;
        txnItem.returned_quantity += qty;

        if (rItem.damaged === true) {
          item.damaged_quantity += qty;
          txnItem.damaged_quantity += qty;
        }

        await item.save();
      }

      /* =====================================================
         ASSET ITEM RETURN (PARTIAL DAMAGE SUPPORTED)
      ===================================================== */
      if (item.tracking_type === 'asset') {
        if (!Array.isArray(rItem.asset_tags) || rItem.asset_tags.length === 0) {
          return res.status(400).json({
            error: `Asset tags required for ${item.name}`
          });
        }

        const returnedTags = rItem.asset_tags.map(t =>
          t.trim().toUpperCase()
        );

        const damagedTags = Array.isArray(rItem.damaged_asset_tags)
          ? rItem.damaged_asset_tags.map(t => t.trim().toUpperCase())
          : [];

        // 🔒 Damaged ⊆ Returned
        for (const tag of damagedTags) {
          if (!returnedTags.includes(tag)) {
            return res.status(400).json({
              error: `Damaged asset ${tag} was not returned`
            });
          }
        }

        for (const tag of returnedTags) {
          if (!txnItem.asset_tags.includes(tag)) {
            return res.status(400).json({
              error: `Asset ${tag} not issued in this transaction`
            });
          }

          const asset = await ItemAsset.findOne({
            asset_tag: tag,
            item_id: item._id
          });

          if (!asset) {
            return res.status(400).json({
              error: `Asset ${tag} record missing`
            });
          }

          /* ---------- DAMAGED ---------- */
          if (damagedTags.includes(tag)) {
            asset.status = 'damaged';
            asset.condition = 'broken';

            item.damaged_quantity += 1;
            txnItem.damaged_quantity += 1;

            await DamagedAssetLog.create({
              asset_id: asset._id,
              transaction_id: transaction._id,

              student_id: transaction.student_id || null,
              faculty_id: transaction.faculty_id || null,
              faculty_email: transaction.faculty_email || null,

              status: 'damaged',
              reported_at: new Date(),

              damage_reason:
                rItem.damage_reason || 'Reported damaged during return',
              remarks: rItem.remarks || ''
            });
          }
          /* ---------- NORMAL ---------- */
          else {
            asset.status = 'available';
            asset.condition = 'good';

            item.available_quantity += 1;
            txnItem.returned_quantity += 1;
          }

          asset.last_transaction_id = transaction._id;
          await asset.save();
        }

        await item.save();
      }
    }

    /* =====================================================
       FINALIZE TRANSACTION
    ===================================================== */
    transaction.status = 'completed';
    transaction.actual_return_date = new Date();
    await transaction.save();

    return res.json({
      success: true,
      message: 'Transaction completed successfully',
      transaction_id: transaction.transaction_id
    });

  } catch (err) {
    console.error('Return transaction error:', err);
    return res.status(500).json({ error: err.message });
  }
};


/* ============================
   GET ACTIVE TRANSACTIONS
============================ */
exports.getActiveTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ status: 'active' })
      .populate('student_id', 'name reg_no')
      .populate('items.item_id', 'name tracking_type')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to load active transactions'
    });
  }
};

/* ============================
   GET PENDING TRANSACTIONS
============================ */
exports.getPendingTransactions = async (req, res) => {
  const transactions = await Transaction.find({ status: 'approved' })
    .populate('student_id', 'name reg_no')
    .populate('items.item_id', 'name tracking_type')
    .sort({ createdAt: -1 });

  res.json({ success: true, data: transactions });
};

/* ============================
   GET AVAILABLE ASSETS FOR ITEM
============================ */
exports.getAvailableAssetsByItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const assets = await ItemAsset.find({
      item_id: itemId,
      status: 'available'
    }).select('asset_tag status');

    res.json({
      success: true,
      data: assets
    });
  } catch (err) {
    console.error('Get available assets error:', err);
    res.status(500).json({
      error: 'Failed to load available assets'
    });
  }
};


//in lab borrow 

exports.issueLabSession = async (req, res) => {
  try {
    const {
      student_reg_no,
      student_email,
      faculty_name,      // optional (for UI)
      faculty_email,
      faculty_id,
      lab_slot,
      items
    } = req.body;

    if (
      !faculty_email ||
      !faculty_id ||
      !lab_slot ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message: 'Missing required fields'
      });
    }

    const issuedAt = new Date();

    // ✅ expected return = +2 hours (same day)
    const expectedReturnDate = new Date(
      issuedAt.getTime() + 2 * 60 * 60 * 1000
    );

    /* ================= CREATE TRANSACTION ================= */
    const transaction = await Transaction.create({
      transaction_id: `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      transaction_type: 'lab_session',
      issued_directly: true,
      status: 'active',

      // student optional in lab session
      student_id: null,
      student_reg_no: student_reg_no || 'LAB-SESSION',

      faculty_email,
      faculty_id,

      lab_slot,
      items: [],

      issued_by_incharge_id: req.user.id,
      issued_at: issuedAt,
      expected_return_date: expectedReturnDate
    });

    /* ================= PROCESS ITEMS ================= */
    for (const it of items) {
      const item = await Item.findById(it.item_id);

      if (!item || !item.is_active) {
        return res.status(400).json({
          message: 'Invalid item selected'
        });
      }

      /* ===== BULK ITEM ===== */
      if (item.tracking_type === 'bulk') {
        if (!it.quantity || it.quantity <= 0) {
          return res.status(400).json({
            message: `Invalid quantity for ${item.name}`
          });
        }

        if (item.available_quantity < it.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for ${item.name}`
          });
        }

        item.available_quantity -= it.quantity;
        await item.save();

        transaction.items.push({
          item_id: item._id,
          quantity: it.quantity,
          issued_quantity: it.quantity
        });
      }

      /* ===== ASSET ITEM ===== */
      if (item.tracking_type === 'asset') {
        if (!it.quantity || it.quantity <= 0) {
          return res.status(400).json({
            message: `Quantity required for ${item.name}`
          });
        }

        const assets = await ItemAsset.find({
          item_id: item._id,
          status: 'available'
        }).limit(it.quantity);

        if (assets.length < it.quantity) {
          return res.status(400).json({
            message: `Not enough assets for ${item.name}`
          });
        }

        for (const asset of assets) {
          asset.status = 'issued';
          asset.last_transaction_id = transaction._id;
          await asset.save();
        }

        item.available_quantity -= assets.length;
        await item.save();

        transaction.items.push({
          item_id: item._id,
          asset_tags: assets.map(a => a.asset_tag),
          issued_quantity: assets.length
        });
      }
    }

    await transaction.save();

    return res.status(201).json({
      success: true,
      message: 'Lab session items issued successfully',
      transaction_id: transaction.transaction_id,
      issued_at: issuedAt,
      expected_return_date: expectedReturnDate
    });

  } catch (err) {
    console.error('Lab session issue error:', err);
    return res.status(500).json({
      message: 'Failed to issue lab session items'
    });
  }
};



/* ============================
   GET AVAILABLE ITEMS (LAB)
============================ */
exports.getAvailableLabItems = async (req, res) => {
  try {
    const items = await Item.find({
      is_active: true,
      $or: [
        { tracking_type: 'bulk', available_quantity: { $gt: 0 } },
        { tracking_type: 'asset', available_quantity: { $gt: 0 } }
      ]
    })
      .select('name sku category tracking_type available_quantity location')
      .sort({ name: 1 })
      .lean();

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Get lab items error:', err);
    res.status(500).json({ message: 'Failed to fetch items' });
  }
};


/* ============================
   SEARCH LAB ITEMS
============================ */
exports.searchLabItems = async (req, res) => {
  try {
    const { q } = req.query;

    const filter = {
      is_active: true,
      $or: [
        { tracking_type: 'bulk', available_quantity: { $gt: 0 } },
        { tracking_type: 'asset', available_quantity: { $gt: 0 } }
      ]
    };

    if (q) {
      filter.$and = [
        {
          $or: [
            { name: new RegExp(q, 'i') },
            { sku: new RegExp(q, 'i') },
            { category: new RegExp(q, 'i') }
          ]
        }
      ];
    }

    const items = await Item.find(filter)
      .select('name sku category tracking_type available_quantity')
      .sort({ name: 1 })
      .lean();

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Search lab items error:', err);
    res.status(500).json({ message: 'Search failed' });
  }
};


/* ============================
   GET ACTIVE LAB SESSION BORROWS
============================ */
exports.getActiveLabSessions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      status: 'active',
      transaction_type: 'lab_session',
      issued_by_incharge_id: req.user.id
    })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ issued_at: -1 })
      .lean();

    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });
  } catch (err) {
    console.error('Get active lab sessions error:', err);
    res.status(500).json({
      message: 'Failed to fetch active lab sessions'
    });
  }
};


// LAB TRANSFER CONTROLLERS

exports.issueLabTransfer = async (req, res) => {
  try {
    const {
      lab_name,
      faculty_name,
      faculty_email,
      faculty_id,
      transfer_type, // "temporary" | "permanent"
      expected_return_date,
      items
    } = req.body;

    /* ================= VALIDATION ================= */
    if (
      !lab_name ||
      !faculty_email ||
      !faculty_id ||
      !transfer_type ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (
      transfer_type === 'temporary' &&
      !expected_return_date
    ) {
      return res.status(400).json({
        message: 'Expected return date required for temporary transfer'
      });
    }

    if (!['temporary', 'permanent'].includes(transfer_type)) {
      return res.status(400).json({
        message: 'Invalid transfer type'
      });
    }

    /* ================= CREATE TRANSACTION ================= */
    const transaction = await Transaction.create({
      transaction_id: `LAB-TRF-${Date.now()}-${crypto.randomInt(100, 999)}`,
      transaction_type: 'regular',
      issued_directly: true,
      status: 'active',

      // No student involved
      student_reg_no: 'LAB-TRANSFER',
      student_id: null,

      // 🔥 Transfer metadata (CORRECT PLACE)
      transfer_type,
      target_lab_name: lab_name,
      handover_faculty_name: faculty_name || null,
      handover_faculty_email: faculty_email,
      handover_faculty_id: faculty_id,

      faculty_email,
      faculty_id,

      lab_slot: lab_name,
      items: [],

      issued_by_incharge_id: req.user.id,
      issued_at: new Date(),

      expected_return_date:
        transfer_type === 'temporary'
          ? new Date(expected_return_date)
          : new Date('2099-12-31')
    });

    /* ================= PROCESS ITEMS ================= */
    for (const it of items) {
      const item = await Item.findById(it.item_id);

      if (!item || !item.is_active) {
        return res.status(400).json({ message: 'Invalid item selected' });
      }

      /* ===== BULK ITEMS ===== */
      if (item.tracking_type === 'bulk') {
        if (item.available_quantity < it.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for ${item.name}`
          });
        }

        item.available_quantity -= it.quantity;
        await item.save();

        transaction.items.push({
          item_id: item._id,
          quantity: it.quantity,
          issued_quantity: it.quantity
        });
      }

      /* ===== ASSET ITEMS ===== */
      if (item.tracking_type === 'asset') {
        const assets = await ItemAsset.find({
          item_id: item._id,
          status: 'available'
        }).limit(it.quantity);

        if (assets.length < it.quantity) {
          return res.status(400).json({
            message: `Not enough assets for ${item.name}`
          });
        }

        for (const asset of assets) {
          if (transfer_type === 'permanent') {
            asset.status = 'retired';
            asset.condition = 'transferred';
          } else {
            asset.status = 'issued';
          }

          asset.last_transaction_id = transaction._id;
          await asset.save();
        }

        if (transfer_type === 'permanent') {
          item.total_quantity = Math.max(
            0,
            item.total_quantity - assets.length
          );
        } else {
          item.available_quantity -= assets.length;
        }

        await item.save();

        transaction.items.push({
          item_id: item._id,
          asset_tags: assets.map(a => a.asset_tag),
          issued_quantity: assets.length
        });
      }
    }

    await transaction.save();

    /* ================= RESPONSE ================= */
    res.status(201).json({
      success: true,
      message: 'Lab transfer completed successfully',
      transaction_id: transaction.transaction_id,
      transfer_type
    });

  } catch (err) {
    console.error('Lab transfer error:', err);
    res.status(500).json({
      message: 'Failed to complete lab transfer'
    });
  }
};

/* ============================
   GET ACTIVE LAB TRANSFERS
============================ */
exports.getActiveLabTransfers = async (req, res) => {
  try {
    const transfers = await Transaction.find({
      status: 'active',
      transaction_id: { $regex: '^LAB-TRF-' }
    })
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ issued_at: -1 })
      .lean();

    res.json({
      success: true,
      count: transfers.length,
      data: transfers
    });
  } catch (err) {
    console.error('Get active lab transfers error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active lab transfers'
    });
  }
};





