const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Staff = require('../models/Staff');
const { sendMail } = require('../services/mail.service');
const ComponentRequest=require('../models/ComponentRequest')
const Bill = require('../models/Bill');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../utils/s3');


/* =========================
   INVENTORY MANAGEMENT
========================= */

/* ============================
   ADD ITEM (FINAL – SAFE)
============================ */
exports.addItem = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      vendor,
      location,
      description,
      tracking_type,
      initial_quantity,
      min_threshold_quantity,
      asset_prefix
    } = req.body;

    if (!tracking_type || !['bulk', 'asset'].includes(tracking_type)) {
      return res.status(400).json({ error: 'Invalid tracking type' });
    }

    if (!initial_quantity || initial_quantity <= 0) {
      return res.status(400).json({
        error: 'Initial quantity must be greater than 0'
      });
    }

    /* ================= CREATE ITEM ================= */
    const item = await Item.create({
      name,
      sku,
      category,
      vendor,
      location,
      description,
      tracking_type,

      // ✅ LIVE FIELDS
      total_quantity: initial_quantity,
      available_quantity: initial_quantity,

      // 📜 HISTORICAL
      initial_quantity,

      min_threshold_quantity,

      // 🔐 ASSET COUNTER
      last_asset_seq: tracking_type === 'asset' ? initial_quantity : 0
    });

    const generatedAssetTags = [];

    /* ================= CREATE ASSETS ================= */
    if (tracking_type === 'asset') {
      const prefix = asset_prefix || sku;

      const assets = [];

      for (let i = 1; i <= initial_quantity; i++) {
        const assetTag = `${prefix}-${String(i).padStart(4, '0')}`;
        generatedAssetTags.push(assetTag);

        assets.push({
          item_id: item._id,
          asset_tag: assetTag,
          location,
          status: 'available',
          condition: 'good'
        });
      }

      await ItemAsset.insertMany(assets);
    }

    return res.status(201).json({
      success: true,
      message: 'Item added successfully',
      data: item,
      generated_asset_tags: generatedAssetTags
    });

  } catch (err) {
    console.error('ADD ITEM ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
};
/* ============================
   UPDATE ITEM (FINAL – BACKWARD COMPATIBLE)
============================ */
exports.updateItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    /* ===== tracking_type is immutable ===== */
    if (
      req.body.tracking_type &&
      req.body.tracking_type !== item.tracking_type
    ) {
      return res.status(400).json({
        error: 'Tracking type cannot be changed after item creation',
      });
    }

    const addQty = Number(req.body.add_quantity || 0);
    const removeAssetTags = req.body.remove_asset_tags || [];
    const createdAssets = [];

    /* =================================================
       ENSURE last_asset_seq EXISTS (AUTO-INIT)
       ================================================= */
    if (
      item.tracking_type === 'asset' &&
      typeof item.last_asset_seq !== 'number'
    ) {
      const lastAsset = await ItemAsset.findOne({ item_id: item._id })
        .sort({ asset_tag: -1 })
        .lean();

      if (lastAsset?.asset_tag) {
        const match = lastAsset.asset_tag.match(/(\d+)$/);
        item.last_asset_seq = match ? parseInt(match[1], 10) : 0;
      } else {
        item.last_asset_seq = 0;
      }
    }

    /* ================= ADD STOCK ================= */
    if (addQty > 0) {

      /* ===== BULK ===== */
      if (item.tracking_type === 'bulk') {
        item.total_quantity += addQty;
        item.available_quantity += addQty;
      }

      /* ===== ASSET ===== */
      if (item.tracking_type === 'asset') {
        for (let i = 0; i < addQty; i++) {
          item.last_asset_seq += 1;

          const assetTag = `${item.sku}-${String(
            item.last_asset_seq
          ).padStart(4, '0')}`;

          const asset = await ItemAsset.create({
            item_id: item._id,
            asset_tag: assetTag,
            status: 'available',
            condition: 'good',
            location: item.location,
          });

          // ✅ RETURN FULL OBJECT (OLD BEHAVIOR)
          createdAssets.push(asset);
        }

        item.total_quantity += addQty;
        item.available_quantity += addQty;
      }
    }

    /* ================= REMOVE ASSET STOCK ================= */
    if (
      addQty < 0 &&
      item.tracking_type === 'asset' &&
      removeAssetTags.length > 0
    ) {
      const assets = await ItemAsset.find({
        item_id: item._id,
        asset_tag: { $in: removeAssetTags },
        status: 'available',
      });

      if (assets.length !== removeAssetTags.length) {
        return res.status(400).json({
          error: 'One or more selected assets are not available',
        });
      }

      await ItemAsset.updateMany(
        { _id: { $in: assets.map(a => a._id) } },
        { $set: { status: 'retired', condition: 'broken' } }
      );

      item.total_quantity -= assets.length;
      item.available_quantity -= assets.length;
    }

    /* ================= REMOVE BULK STOCK ================= */
    if (addQty < 0 && item.tracking_type === 'bulk') {
      const removeQty = Math.abs(addQty);

      if (removeQty > item.available_quantity) {
        return res.status(400).json({
          error: 'Cannot remove more than available quantity',
        });
      }

      item.total_quantity -= removeQty;
      item.available_quantity -= removeQty;
    }

    /* ================= CLEAN REQUEST ================= */
    delete req.body.add_quantity;
    delete req.body.remove_asset_tags;
    delete req.body.tracking_type;
    delete req.body.initial_quantity;
    delete req.body.available_quantity;
    delete req.body.total_quantity;
    delete req.body.last_asset_seq;

    Object.assign(item, req.body);
    await item.save();

    return res.json({
      success: true,
      data: item,
      created_assets: createdAssets, // 🔥 EXACTLY LIKE BEFORE
    });

  } catch (err) {
    console.error('UPDATE ITEM ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
};


/* ============================
   GET ITEM ASSETS
============================ */
exports.getItemAssets = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    const item = await Item.findById(id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.tracking_type !== 'asset') {
      return res.status(400).json({
        error: 'This item does not support asset tracking'
      });
    }

    const filter = { item_id: item._id };
    if (status) filter.status = status;

    const assets = await ItemAsset.find(filter)
      .select('asset_tag status condition')
      .sort({ asset_tag: 1 })
      .lean();

    return res.json({
      success: true,
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
   SOFT DELETE ITEM
============================ */
exports.removeItem = async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      { is_active: false },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({
      success: true,
      message: 'Item removed (soft delete)'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ============================
   VIEW ALL ITEMS
============================ */
exports.getAllItems = async (req, res) => {
  try {
    const items = await Item.find({ is_active: true }).sort({ name: 1 });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   TRANSACTION HISTORY
============================ */
exports.getTransactionHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: transactions });
  } catch (err) {
    console.error('GET TRANSACTION HISTORY ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   SEARCH TRANSACTIONS
============================ */
exports.searchTransactions = async (req, res) => {
  try {
    const { transaction_id, reg_no, faculty_email, faculty_id } = req.query;

    const filter = {};
    if (transaction_id) filter.transaction_id = transaction_id;
    if (reg_no) filter.student_reg_no = reg_no;
    if (faculty_email) filter.faculty_email = faculty_email;
    if (faculty_id) filter.faculty_id = faculty_id;

    const transactions = await Transaction.find(filter)
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: transactions });
  } catch (err) {
    console.error('SEARCH TRANSACTIONS ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   OVERDUE TRANSACTIONS
============================ */
exports.getOverdueTransactions = async (req, res) => {
  try {
    const overdue = await Transaction.find({ status: 'overdue' })
      .populate('student_id', 'name reg_no email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ expected_return_date: 1 })
      .lean();

    res.json({ success: true, data: overdue });
  } catch (err) {
    console.error('GET OVERDUE TRANSACTIONS ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   GET SINGLE ITEM
============================ */
exports.getItemById = async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      is_active: true
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};



/* ======================================
   ADMIN — GET ALL LAB SESSIONS
====================================== */
exports.getLabSessions = async (req, res) => {
  try {
    const records = await Transaction.find({
      student_reg_no: 'LAB-SESSION'
    })
      .populate('issued_by_incharge_id', 'name email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (err) {
    console.error('Admin get lab sessions error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch lab sessions' });
  }
};

/* ======================================
   ADMIN — GET SINGLE LAB SESSION
====================================== */
exports.getLabSessionDetail = async (req, res) => {
  try {
    const record = await Transaction.findOne({
      _id: req.params.id,
      student_reg_no: 'LAB-SESSION'
    })
      .populate('items.item_id')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) {
      return res.status(404).json({ message: 'Lab session not found' });
    }

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch lab session' });
  }
};

/* ======================================
   ADMIN — GET ALL LAB TRANSFERS
====================================== */
exports.getLabTransfers = async (req, res) => {
  try {
    const records = await Transaction.find({
      student_reg_no: 'LAB-TRANSFER'
    })
      .populate('issued_by_incharge_id', 'name email')
      .populate('items.item_id', 'name sku tracking_type')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (err) {
    console.error('Admin get lab transfers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch lab transfers' });
  }
};

/* ======================================
   ADMIN — GET SINGLE LAB TRANSFER
====================================== */
exports.getLabTransferDetail = async (req, res) => {
  try {
    const record = await Transaction.findOne({
      _id: req.params.id,
      student_reg_no: 'LAB-TRANSFER'
    })
      .populate('items.item_id')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) {
      return res.status(404).json({ message: 'Lab transfer not found' });
    }

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch lab transfer' });
  }
};



//feed back requests
/* ============================
   GET ALL COMPONENT REQUESTS
   (with filters)
============================ */
exports.getAllComponentRequests = async (req, res) => {
  try {
    const {
      status,
      urgency,
      category,
      student_reg_no,
      component_name
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (urgency) filter.urgency = urgency;
    if (category) filter.category = category;
    if (student_reg_no) filter.student_reg_no = student_reg_no;
    if (component_name)
      filter.component_name = new RegExp(component_name, 'i');

    const requests = await ComponentRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (err) {
    console.error('Admin get component requests error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch component requests'
    });
  }
};

/* ============================
   GET SINGLE COMPONENT REQUEST
============================ */
exports.getComponentRequestById = async (req, res) => {
  try {
    const request = await ComponentRequest.findById(req.params.id).lean();

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Component request not found'
      });
    }

    res.json({
      success: true,
      data: request
    });
  } catch (err) {
    console.error('Admin get component request error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch component request'
    });
  }
};

/* ============================
   UPDATE REQUEST STATUS
   (approve / reject)
============================ */
exports.updateComponentRequestStatus = async (req, res) => {
  try {
    const { status, admin_remarks } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const request = await ComponentRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Component request not found'
      });
    }

    request.status = status;
    request.admin_remarks = admin_remarks || null;

    await request.save();

    res.json({
      success: true,
      message: `Request ${status} successfully`
    });
  } catch (err) {
    console.error('Admin update component request error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update request'
    });
  }
};



/* ============================
   UPLOAD BILL (S3)
============================ */
exports.uploadBill = async (req, res) => {
  try {
    const { title, bill_type, bill_date } = req.body;

    if (!title || !bill_date || !req.file) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const s3Key = `bills/${Date.now()}-${req.file.originalname}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: 'application/pdf'
      })
    );

    const bill = await Bill.create({
      title,
      bill_type,
      bill_date: new Date(bill_date),
      s3_key: s3Key,
      s3_url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      uploaded_by: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Bill uploaded successfully',
      data: bill
    });

  } catch (err) {
    console.error('Upload bill error:', err);
    res.status(500).json({ message: 'Failed to upload bill' });
  }
};

/* ============================
   GET BILLS
============================ */
exports.getBills = async (req, res) => {
  try {
    const { month, from, to } = req.query;
    const filter = {};

    if (month) {
      const [y, m] = month.split('-');
      filter.bill_date = {
        $gte: new Date(`${y}-${m}-01`),
        $lt: new Date(`${y}-${Number(m) + 1}-01`)
      };
    }

    if (from && to) {
      filter.bill_date = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }

    const bills = await Bill.find(filter)
      .populate('uploaded_by', 'name email')
      .sort({ bill_date: -1, createdAt: -1 })
      .lean();

    res.json({ success: true, count: bills.length, data: bills });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bills' });
  }
};

/* ============================
   DOWNLOAD / VIEW BILL (STREAM)
============================ */
exports.downloadBill = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });

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
    res.status(500).json({ message: 'Failed to download bill' });
  }
};





exports.getDamagedAssetHistory = async (req, res) => {
  try {
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

      // Join ItemAsset
      {
        $lookup: {
          from: 'itemassets',
          localField: 'asset_id',
          foreignField: '_id',
          as: 'asset'
        }
      },
      { $unwind: '$asset' },

      // Join Item
      {
        $lookup: {
          from: 'items',
          localField: 'asset.item_id',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' },
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
       VENDOR FILTER
    ===================== */
    if (vendor) {
      pipeline.push({
        $match: {
          'item.vendor': { $regex: vendor, $options: 'i' }
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

          item_name: '$item.name',
          sku: '$item.sku',
          category: '$item.category',
          vendor: '$item.vendor',

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

    res.json({
      success: true,
      count: records.length,
      data: records
    });

  } catch (error) {
    console.error('Damaged asset history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch damaged asset history'
    });
  }
};


