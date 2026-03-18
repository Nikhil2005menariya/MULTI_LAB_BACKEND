const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const DamagedAssetLog = require('../../models/DamagedAssetLog');
const ItemAsset = require('../../models/ItemAsset');
const Item = require('../../models/Item');
const LabInventory = require('../../models/LabInventory');

// Admin only
router.use(auth, role('incharge'));

/* =====================================================
   ✅ 1. DAMAGED ASSET HISTORY (FILTERABLE)
   GET /api/admin/damaged-assets/history
===================================================== */
router.get('/history', async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const { item, vendor, status, from, to } = req.query;

    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const match = {};

    if (status) match.status = status;

    if (from || to) {
      match.reported_at = {};
      if (from) match.reported_at.$gte = new Date(from);
      if (to) match.reported_at.$lte = new Date(to);
    }

    // Parallel execution
    const [totalItems, logs] = await Promise.all([
      DamagedAssetLog.countDocuments(match), // same logic (no lab filter here intentionally)
      DamagedAssetLog.find(match)
        .populate({
          path: 'asset_id',
          match: {
            lab_id: labId,
            ...(vendor && { vendor: new RegExp(vendor, 'i') })
          },
          populate: {
            path: 'item_id',
            match: {
              ...(item && { name: new RegExp(item, 'i') })
            }
          }
        })
        .sort({ reported_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    // Remove null joins (same as before)
    const data = logs
      .filter(l => l.asset_id && l.asset_id.item_id)
      .map(l => ({
        log_id: l._id,

        asset_tag: l.asset_id.asset_tag,
        serial_no: l.asset_id.serial_no,
        asset_status: l.asset_id.status,
        asset_condition: l.asset_id.condition,

        vendor: l.asset_id.vendor,

        item_name: l.asset_id.item_id.name,
        sku: l.asset_id.item_id.sku,
        category: l.asset_id.item_id.category,

        damage_status: l.status,
        damage_reason: l.damage_reason,
        remarks: l.remarks,

        faculty_email: l.faculty_email,
        faculty_id: l.faculty_id,
        student_id: l.student_id,

        reported_at: l.reported_at
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

  } catch (error) {
    console.error('Error fetching damaged asset history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch damaged asset history'
    });
  }
});
/* =====================================================
   2. CURRENT DAMAGED / UNDER-REPAIR (SUMMARY VIEW)
   GET /api/admin/damaged-assets
===================================================== */
router.get('/', async (req, res) => {
  try {
    const labId = req.user.lab_id;
    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const records = await DamagedAssetLog.find({
      status: { $in: ['damaged', 'under_repair'] }
    })
      .populate({
        path: 'asset_id',
        match: { lab_id: labId }, // 🔒 LAB ISOLATION
        populate: { path: 'item_id' }
      })
      .populate('student_id', 'name reg_no email')
      .sort({ reported_at: -1 })
      .lean();

    const filtered = records.filter(r => r.asset_id);

    res.json({
      success: true,
      count: filtered.length,
      data: filtered
    });

  } catch (error) {
    console.error('Error fetching damaged assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch damaged assets'
    });
  }
});

/* =====================================================
   3. UNDER-REPAIR LIST (LAB SPECIFIC)
   GET /api/admin/damaged-assets/under-repair/list
===================================================== */
router.get('/under-repair/list', async (req, res) => {
  try {
    const labId = req.user.lab_id;

    if (!labId) {
      return res.status(403).json({
        success: false,
        message: 'Lab access denied'
      });
    }

    const assets = await ItemAsset.find({
      lab_id: labId,              // 🔒 LAB ISOLATION
      status: 'damaged',
      condition: 'faulty'
    })
      .populate('item_id')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      success: true,
      count: assets.length,
      data: assets
    });

  } catch (error) {
    console.error('Error fetching under-repair assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch under-repair assets'
    });
  }
});

/* =====================================================
   4. UPDATE DAMAGE STATUS
   PATCH /api/admin/damaged-assets/:id/status
===================================================== */
router.patch('/:id/status', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const labId = req.user.lab_id;
    const { action } = req.body;

    if (!labId) {
      throw new Error('Lab access denied');
    }

    if (!['repair', 'resolve', 'retire'].includes(action)) {
      throw new Error('Invalid action');
    }

    const record = await DamagedAssetLog.findById(req.params.id).session(session);
    if (!record) {
      throw new Error('Damage record not found');
    }

    const asset = await ItemAsset.findById(record.asset_id).session(session);
    if (!asset) {
      throw new Error('Asset not found');
    }

    // 🔒 LAB ISOLATION
    if (String(asset.lab_id) !== String(labId)) {
      throw new Error('Unauthorized lab access');
    }

    const inventory = await LabInventory.findOne({
      lab_id: asset.lab_id,
      item_id: asset.item_id
    }).session(session);

    if (!inventory) {
      throw new Error('Lab inventory not found');
    }

    /* ================= ACTION HANDLING ================= */

    switch (action) {

      case 'repair':
        asset.status = 'damaged';
        asset.condition = 'faulty';
        record.status = 'under_repair';
        break;

      case 'resolve':
        asset.status = 'available';
        asset.condition = 'good';
        record.status = 'resolved';
        break;

      case 'retire':
        asset.status = 'retired';
        asset.condition = 'broken';
        record.status = 'retired';

        // 🔥 permanently reduce lab total
        inventory.total_quantity = Math.max(0, inventory.total_quantity - 1);
        break;
    }

    await asset.save({ session });
    await record.save({ session });

    /* ================= RECALCULATE COUNTS ================= */

    const availableCount = await ItemAsset.countDocuments({
      lab_id: asset.lab_id,
      item_id: asset.item_id,
      status: 'available'
    }).session(session);

    const damagedCount = await ItemAsset.countDocuments({
      lab_id: asset.lab_id,
      item_id: asset.item_id,
      status: 'damaged'
    }).session(session);

    inventory.available_quantity = availableCount;
    inventory.damaged_quantity = damagedCount;

    await inventory.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: `Asset status updated via action: ${action}`
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error('Error updating damaged asset status:', error);

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/* =====================================================
   5. SINGLE DAMAGE RECORD (DETAIL VIEW)
   ❗ MUST BE LAST
   GET /api/admin/damaged-assets/:id
===================================================== */
router.get('/:id', async (req, res) => {
  try {
    const record = await DamagedAssetLog.findById(req.params.id)
      .populate({
        path: 'asset_id',
        populate: {
          path: 'item_id',
          select: 'name category sku vendor'
        }
      })
      .populate({
        path: 'transaction_id',
        select: 'transaction_id faculty_email faculty_id issued_at actual_return_date status'
      })
      .populate({
        path: 'student_id',
        select: 'name reg_no email'
      })
      .lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Damaged asset record not found'
      });
    }

    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('Error fetching damaged asset details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch damaged asset details'
    });
  }
});

module.exports = router;
