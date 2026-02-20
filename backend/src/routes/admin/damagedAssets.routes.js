const express = require('express');
const router = express.Router();

const auth = require('../../middlewares/auth.middleware');
const role = require('../../middlewares/role.middleware');

const DamagedAssetLog = require('../../models/DamagedAssetLog');
const ItemAsset = require('../../models/ItemAsset');
const Item = require('../../models/Item');

// Admin only
router.use(auth, role('admin'));

/* =====================================================
   ✅ 1. DAMAGED ASSET HISTORY (FILTERABLE)
   GET /api/admin/damaged-assets/history
===================================================== */
router.get('/history', async (req, res) => {
  try {
    const { item, vendor, status, from, to } = req.query;

    const match = {};
    if (status) match.status = status;

    if (from || to) {
      match.reported_at = {};
      if (from) match.reported_at.$gte = new Date(from);
      if (to) match.reported_at.$lte = new Date(to);
    }

    const logs = await DamagedAssetLog.find(match)
      .populate({
        path: 'asset_id',
        populate: {
          path: 'item_id',
          match: {
            ...(item && { name: new RegExp(item, 'i') }),
            ...(vendor && { vendor: new RegExp(vendor, 'i') })
          }
        }
      })
      .sort({ reported_at: -1 })
      .lean();

    // Remove null joins (when item/vendor filter doesn't match)
    const data = logs
      .filter(l => l.asset_id && l.asset_id.item_id)
      .map(l => ({
        log_id: l._id,

        asset_tag: l.asset_id.asset_tag,
        serial_no: l.asset_id.serial_no,
        asset_status: l.asset_id.status,
        asset_condition: l.asset_id.condition,

        item_name: l.asset_id.item_id.name,
        sku: l.asset_id.item_id.sku,
        category: l.asset_id.item_id.category,
        vendor: l.asset_id.item_id.vendor,

        damage_status: l.status,
        damage_reason: l.damage_reason,
        remarks: l.remarks,

        faculty_email: l.faculty_email,
        faculty_id: l.faculty_id,
        student_id: l.student_id,

        reported_at: l.reported_at
      }));

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('Error fetching damaged asset history:', error);
    res.status(500).json({
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
    const records = await DamagedAssetLog.find({
      status: { $in: ['damaged', 'under_repair'] }
    })
      .populate({
        path: 'asset_id',
        populate: { path: 'item_id' }
      })
      .populate('student_id', 'name reg_no email')
      .sort({ reported_at: -1 })
      .lean();

    res.json({
      success: true,
      count: records.length,
      data: records
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
   3. UNDER-REPAIR LIST
   GET /api/admin/damaged-assets/under-repair/list
===================================================== */
router.get('/under-repair/list', async (req, res) => {
  try {
    const assets = await ItemAsset.find({
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
  try {
    const { action } = req.body;

    if (!['repair', 'resolve', 'retire'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    const record = await DamagedAssetLog.findById(req.params.id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Damage record not found'
      });
    }

    const asset = await ItemAsset.findById(record.asset_id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const item = await Item.findById(asset.item_id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Parent item not found'
      });
    }

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
        item.available_quantity += 1;
        item.damaged_quantity = Math.max(0, item.damaged_quantity - 1);
        await item.save();
        break;

      case 'retire':
        asset.status = 'retired';
        asset.condition = 'broken';
        record.status = 'retired';
        item.damaged_quantity = Math.max(0, item.damaged_quantity - 1);
        item.total_quantity = Math.max(0, item.total_quantity - 1);
        await item.save();
        break;
    }

    await asset.save();
    await record.save();

    res.json({
      success: true,
      message: `Asset status updated via action: ${action}`
    });
  } catch (error) {
    console.error('Error updating damaged asset status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update asset status'
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
