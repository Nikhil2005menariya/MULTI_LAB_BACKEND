const Lab = require('../models/Lab');
const Staff = require('../models/Staff');
const LabInventory = require('../models/LabInventory');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const mongoose = require('mongoose');
const adminController = require('./admin.controller');
const inchargeController = require('./incharge.controller');
const { sendMail } = require('../services/mail.service');

/* =====================================================
   HELPER: Validate Lab Exists
===================================================== */
const validateLab = async (labId) => {
  const lab = await Lab.findById(labId);
  if (!lab || !lab.is_active) return null;
  return lab;
};

/* =====================================================
   EMAIL TEMPLATES — STAFF ASSIGNMENT
===================================================== */

/**
 * Email sent when an EXISTING staff member is reassigned to a new post.
 * They already have credentials — just tell them to log in.
 */
const buildExistingStaffEmail = ({ name, email, role, labName, labCode, frontendUrl }) => {
  const roleLabel = role === 'incharge' ? 'Lab Incharge' : 'Lab Assistant';
  const roleColor = role === 'incharge' ? '#7c3aed' : '#2563eb';
  const roleGradientFrom = role === 'incharge' ? '#7c3aed' : '#2563eb';
  const roleGradientTo = role === 'incharge' ? '#5b21b6' : '#1d4ed8';
  const roleEmoji = role === 'incharge' ? '👨‍💼' : '🔧';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${roleGradientFrom} 0%,${roleGradientTo} 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="width:60px;vertical-align:middle;">
          <div style="width:54px;height:54px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:54px;font-size:28px;">${roleEmoji}</div>
        </td>
        <td style="padding-left:16px;vertical-align:middle;">
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">Lab Management System</p>
          <h1 style="margin:5px 0 0;color:#fff;font-size:22px;font-weight:800;">New Role Assignment</h1>
        </td>
      </tr></table>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.75;">
        You have been assigned a new role in the Lab Management System. Here are your assignment details:
      </p>

      <!-- Assignment Card -->
      <div style="background:linear-gradient(135deg,${roleGradientFrom}12,${roleGradientTo}08);border:1px solid ${roleColor}30;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding-bottom:14px;border-bottom:1px solid ${roleColor}20;vertical-align:middle;">
              <p style="margin:0;font-size:11px;color:${roleColor};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Your New Role</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:800;color:#0f172a;">${roleLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:14px;vertical-align:middle;">
              <p style="margin:0;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Assigned Lab</p>
              <p style="margin:6px 0 0;font-size:16px;font-weight:700;color:#0f172a;">
                ${labName}
                <span style="margin-left:8px;background:${roleColor}15;color:${roleColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;font-family:monospace;">${labCode}</span>
              </p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Account Info -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">✅ You Already Have an Account</p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.7;">
          Your existing account (<strong>${email}</strong>) has been updated with this new role. Use your current credentials to log in.
        </p>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${frontendUrl}/login" style="display:inline-block;background:linear-gradient(135deg,${roleGradientFrom},${roleGradientTo});color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;letter-spacing:0.3px;">
          Log In to Your Account →
        </a>
      </div>

      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;text-align:center;">
        If you forgot your password, use the <a href="${frontendUrl}/forgot-password" style="color:${roleColor};font-weight:600;">Forgot Password</a> link on the login page.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Lab Management System · This is an automated message · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/**
 * Email sent when a NEW staff member is created.
 * Includes temporary password and instructions to change it.
 */
const buildNewStaffEmail = ({ name, email, role, labName, labCode, tempPassword, frontendUrl }) => {
  const roleLabel = role === 'incharge' ? 'Lab Incharge' : 'Lab Assistant';
  const roleColor = role === 'incharge' ? '#7c3aed' : '#2563eb';
  const roleGradientFrom = role === 'incharge' ? '#7c3aed' : '#2563eb';
  const roleGradientTo = role === 'incharge' ? '#5b21b6' : '#1d4ed8';
  const roleEmoji = role === 'incharge' ? '👨‍💼' : '🔧';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${roleGradientFrom} 0%,${roleGradientTo} 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="width:60px;vertical-align:middle;">
          <div style="width:54px;height:54px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:54px;font-size:28px;">${roleEmoji}</div>
        </td>
        <td style="padding-left:16px;vertical-align:middle;">
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">Lab Management System</p>
          <h1 style="margin:5px 0 0;color:#fff;font-size:22px;font-weight:800;">Welcome! Account Created</h1>
        </td>
      </tr></table>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.75;">
        Welcome to the Lab Management System! An account has been created for you with the following role:
      </p>

      <!-- Assignment Card -->
      <div style="background:linear-gradient(135deg,${roleGradientFrom}12,${roleGradientTo}08);border:1px solid ${roleColor}30;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding-bottom:14px;border-bottom:1px solid ${roleColor}20;">
              <p style="margin:0;font-size:11px;color:${roleColor};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Your Role</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:800;color:#0f172a;">${roleLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:14px;">
              <p style="margin:0;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Assigned Lab</p>
              <p style="margin:6px 0 0;font-size:16px;font-weight:700;color:#0f172a;">
                ${labName}
                <span style="margin-left:8px;background:${roleColor}15;color:${roleColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;font-family:monospace;">${labCode}</span>
              </p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Credentials -->
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;">🔐 Your Login Credentials</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 16px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:600;width:35%;text-transform:uppercase;letter-spacing:0.5px;">Email</td>
          <td style="padding:12px 16px;font-size:14px;color:#0f172a;font-weight:600;font-family:monospace;">${email}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Temp Password</td>
          <td style="padding:12px 16px;">
            <span style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;font-size:16px;font-weight:800;padding:4px 14px;border-radius:8px;font-family:monospace;letter-spacing:1px;">${tempPassword}</span>
          </td>
        </tr>
      </table>

      <!-- Warning -->
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.7;">
          <strong>⚠️ Important:</strong> This is a temporary password. Please log in and change it immediately from your profile settings. Do not share this password with anyone.
        </p>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${frontendUrl}/login" style="display:inline-block;background:linear-gradient(135deg,${roleGradientFrom},${roleGradientTo});color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;letter-spacing:0.3px;">
          Log In Now →
        </a>
      </div>

      <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.7;">
        Alternatively, you can use the <a href="${frontendUrl}/forgot-password" style="color:${roleColor};font-weight:600;">Forgot Password</a> link to set your own password.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Lab Management System · This is an automated message · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/* =====================================================
   HELPER: Generate temporary password
===================================================== */
const generateTempPassword = () => {
  // 10 char mix of letters + numbers + symbol — readable
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let pwd = '';
  for (let i = 0; i < 10; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
};

/* =====================================================
   HELPER: Assign or create staff member
   - If email exists in Staff → reactivate + reassign + send existing-account mail
   - If not → create new with temp password + send welcome mail
===================================================== */
const assignOrCreateStaff = async ({ name, email, role, labId, lab }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  let existing = await Staff.findOne({ email: email.toLowerCase() });

  if (existing) {
    // Reactivate and reassign to new lab + role
    existing.name = name || existing.name;
    existing.role = role;
    existing.lab_id = labId;
    existing.is_active = true;
    await existing.save();

    // Send "you already have an account" email
    await sendMail({
      to: existing.email,
      subject: `🎯 New Role Assignment – ${role === 'incharge' ? 'Lab Incharge' : 'Lab Assistant'} at ${lab.name}`,
      html: buildExistingStaffEmail({
        name: existing.name,
        email: existing.email,
        role,
        labName: lab.name,
        labCode: lab.code,
        frontendUrl: FRONTEND_URL
      })
    });

    return { staff: existing, isNew: false };
  }

  // Create new staff with temp password
  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const newStaff = await Staff.create({
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    role,
    lab_id: labId,
    is_active: true
  });

  // Send welcome email with credentials
  await sendMail({
    to: newStaff.email,
    subject: `👋 Welcome to Lab Management System – Your Account is Ready`,
    html: buildNewStaffEmail({
      name: newStaff.name,
      email: newStaff.email,
      role,
      labName: lab.name,
      labCode: lab.code,
      tempPassword,
      frontendUrl: FRONTEND_URL
    })
  });

  return { staff: newStaff, isNew: true };
};

/* =====================================================
   ================= GLOBAL CAPABILITIES =================
===================================================== */

/* ============================
   CREATE LAB
   Optionally create incharge + assistant at creation time
============================ */
exports.createLab = async (req, res) => {
  try {
    const {
      name, code, location,
      // Optional incharge details at lab creation
      incharge_name, incharge_email,
      // Optional assistant details at lab creation
      assistant_name, assistant_email
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const exists = await Lab.findOne({ $or: [{ name }, { code }] });
    if (exists) {
      return res.status(400).json({ error: 'Lab with same name or code already exists' });
    }

    const lab = await Lab.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      location
    });

    const created = { lab };

    // Assign incharge if provided
    if (incharge_name && incharge_email) {
      const { staff, isNew } = await assignOrCreateStaff({
        name: incharge_name,
        email: incharge_email,
        role: 'incharge',
        labId: lab._id,
        lab
      });
      created.incharge = { staff, isNew };
    }

    // Assign assistant if provided
    if (assistant_name && assistant_email) {
      const { staff, isNew } = await assignOrCreateStaff({
        name: assistant_name,
        email: assistant_email,
        role: 'assistant',
        labId: lab._id,
        lab
      });
      created.assistant = { staff, isNew };
    }

    res.status(201).json({ success: true, data: created });

  } catch (err) {
    console.error('Create lab error:', err);
    res.status(500).json({ error: 'Failed to create lab' });
  }
};

/* ============================
   VIEW ALL LABS + STATS
============================ */
exports.getAllLabs = async (req, res) => {
  try {
    const labs = await Lab.find().lean();

    const enriched = await Promise.all(
      labs.map(async (lab) => {
        const staffCount = await Staff.countDocuments({
          lab_id: lab._id,
          role: { $in: ['incharge', 'assistant'] }
        });

        const inventoryCount = await LabInventory.countDocuments({ lab_id: lab._id });

        return { ...lab, stats: { staffCount, inventoryCount } };
      })
    );

    res.json({ success: true, data: enriched });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch labs' });
  }
};

/* ============================
   REMOVE LAB (SAFE DELETE)
============================ */
exports.removeLab = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await Lab.findById(labId);
    if (!lab) return res.status(404).json({ error: 'Lab not found' });

    lab.is_active = false;
    await lab.save();

    await Staff.updateMany(
      { lab_id: labId },
      { $set: { is_active: false, lab_id: null } }
    );

    res.json({ success: true, message: 'Lab deactivated successfully' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to remove lab' });
  }
};

/* =====================================================
   ================= LAB-SCOPED CAPABILITIES =================
===================================================== */

/* ============================
   ADD ASSISTANT TO LAB
   Handles existing staff reactivation automatically
============================ */
exports.addAssistant = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email, password } = req.body;

    const lab = await validateLab(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    const existing = await Staff.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const assistant = await Staff.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'assistant',
      lab_id: labId
    });

    res.status(isNew ? 201 : 200).json({
      success: true,
      isNew,
      message: isNew
        ? 'Assistant account created and credentials sent via email'
        : 'Existing staff reassigned as assistant. Login instructions sent.',
      data: { ...staff.toObject(), password: undefined }
    });

  } catch (err) {
    console.error('Add assistant error:', err);
    res.status(500).json({ error: 'Failed to add assistant' });
  }
};

/* ============================
   REMOVE ASSISTANT
============================ */
exports.removeAssistant = async (req, res) => {
  try {
    const { labId, staffId } = req.params;

    const staff = await Staff.findOne({
      _id: staffId, lab_id: labId, role: 'assistant'
    });

    if (!staff) return res.status(404).json({ error: 'Assistant not found' });

    staff.is_active = false;
    staff.lab_id = null;
    await staff.save();

    res.json({ success: true, message: 'Assistant removed successfully' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to remove assistant' });
  }
};

/* ============================
   CHANGE INCHARGE
   Handles existing staff reactivation automatically.
   Previous incharge is deactivated.
============================ */
exports.changeIncharge = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email, password } = req.body;

    const lab = await validateLab(labId);
    if (!lab) {
      return res.status(404).json({ error: 'Invalid lab' });
    }

    // Remove existing incharge (if exists)
    await Staff.updateMany(
      { lab_id: labId, role: 'incharge' },
      { $set: { is_active: false, lab_id: null } }
    );

    const { staff, isNew } = await assignOrCreateStaff({
      name, email, role: 'incharge', labId, lab
    });

    res.status(isNew ? 201 : 200).json({
      success: true,
      isNew,
      message: isNew
        ? 'New incharge account created and credentials sent via email'
        : 'Existing staff reassigned as incharge. Login instructions sent.',
      data: { ...staff.toObject(), password: undefined }
    });

  } catch (err) {
    console.error('Change incharge error:', err);
    res.status(500).json({ error: 'Failed to change incharge' });
  }
};

/* ============================
   GET LAB STAFF
============================ */
exports.getLabStaff = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await validateLab(labId);
    if (!lab) return res.status(404).json({ error: 'Invalid lab' });

    const staff = await Staff.find({
      lab_id: labId,
      role: { $in: ['incharge', 'assistant'] }
    }).select('-password');

    res.json({ success: true, data: staff });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lab staff' });
  }
};

/* ============================
   GET CURRENT INCHARGE
============================ */
exports.getCurrentIncharge = async (req, res) => {
  try {
    const { labId } = req.params;

    const lab = await Lab.findById(labId);
    if (!lab || !lab.is_active) return res.status(404).json({ error: 'Invalid lab' });

    const incharge = await Staff.findOne({
      lab_id: labId, role: 'incharge', is_active: true
    }).select('-password');

    return res.json({ success: true, data: incharge || null });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch incharge' });
  }
};

/* ============================
   ANALYTICS - TRANSACTIONS (ENHANCED)
============================ */

exports.getTransactionAnalytics = async (req, res) => {
  try {
    const {
      fields,
      startDate,
      endDate,
      labId,
      filters,
      format,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      order = -1
    } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'Fields array is required' });
    }

    const allowedFields = [
      'transaction_id', 'project_name', 'transaction_type', 'status',
      'student_id', 'student_reg_no', 'faculty_email', 'faculty_id',
      'issued_at', 'expected_return_date', 'actual_return_date', 'createdAt', 'updatedAt'
    ];

    const selectedFields = fields.filter(f => allowedFields.includes(f));
    if (selectedFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields selected' });
    }

    /* ============================
       FILTER BUILDING
    ============================= */

    const txnMatch = {};
    const itemMatch = {};

    // Date filter
    if (startDate || endDate) {
      txnMatch.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        txnMatch.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txnMatch.createdAt.$lte = end;
      }
    }

    // Lab filter (item level)
    if (labId) {
      itemMatch['items.lab_id'] = new mongoose.Types.ObjectId(labId);
    }

    if (filters && typeof filters === 'object') {
      Object.entries(filters).forEach(([key, value]) => {
        if (!allowedFields.includes(key)) return;

        if (key === 'student_id') {
          txnMatch[key] = new mongoose.Types.ObjectId(value);
        } else {
          txnMatch[key] = value;
        }
      });
    }

    /* ============================
       BASE PIPELINE
    ============================= */

    const basePipeline = [
      { $match: txnMatch },
      { $unwind: '$items' },
      ...(Object.keys(itemMatch).length ? [{ $match: itemMatch }] : [])
    ];

    /* ============================
       SUMMARY PIPELINE
    ============================= */

    const summaryPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: null,
          total_transactions: { $addToSet: '$_id' },
          total_issued: { $sum: '$items.issued_quantity' },
          total_returned: { $sum: '$items.returned_quantity' },
          total_damaged: { $sum: '$items.damaged_quantity' }
        }
      },
      {
        $project: {
          total_transactions: { $size: '$total_transactions' },
          total_issued: 1,
          total_returned: 1,
          total_damaged: 1
        }
      }
    ];

    /* ============================
       TOP ITEMS
    ============================= */

    const topItemsPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$items.item_id',
          issued: { $sum: '$items.issued_quantity' }
        }
      },
      { $sort: { issued: -1 } },
      { $limit: 5 }
    ];

    /* ============================
       TOP LABS
    ============================= */

    const topLabsPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$items.lab_id',
          issued: { $sum: '$items.issued_quantity' }
        }
      },
      { $sort: { issued: -1 } },
      { $limit: 5 }
    ];

    /* ============================
       MAIN DATA PIPELINE
    ============================= */

    const dataPipeline = [
      ...basePipeline,
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      {
        $project: selectedFields.reduce((acc, f) => {
          acc[f] = 1;
          return acc;
        }, {})
      },
      { $sort: { [sortBy]: order } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ];

    /* ============================
       EXECUTE IN PARALLEL
    ============================= */

    const [summary, topItems, topLabs, transactions] =
      await Promise.all([
        Transaction.aggregate(summaryPipeline),
        Transaction.aggregate(topItemsPipeline),
        Transaction.aggregate(topLabsPipeline),
        Transaction.aggregate(dataPipeline)
      ]);

    /* ============================
       CSV EXPORT
    ============================= */

    if (format === 'csv') {
      const header = selectedFields.join(',');
      const rows = transactions.map(txn =>
        selectedFields
          .map(field => {
            const value = txn[field] ?? '';
            const safe = String(value)
              .replace(/"/g, '""')
              .replace(/\n/g, ' ');
            return `"${safe}"`;
          })
          .join(',')
      );
      res.setHeader('Content-Disposition', 'attachment; filename=transaction_report.csv');
      res.setHeader('Content-Type', 'text/csv');
      return res.send([header, ...rows].join('\n'));
    }

    /* ============================
       RESPONSE
    ============================= */

    return res.json({
      success: true,
      page,
      limit,
      count: transactions.length,

      summary: summary[0] || {
        total_transactions: 0,
        total_issued: 0,
        total_returned: 0,
        total_damaged: 0
      },

      top_items: topItems,
      top_labs: topLabs,

      data: transactions
    });

  } catch (err) {
    console.error('Transaction analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch transaction analytics'
    });
  }
};


/* ============================
   ITEM ANALYTICS (ENHANCED)
============================ */
exports.getItemAnalytics = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      labId,
      page = 1,
      limit = 50
    } = req.body;

    /* ============================
       FILTER BUILDING
    ============================= */

    const txnMatch = {};

    if (startDate || endDate) {
      txnMatch.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        txnMatch.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txnMatch.createdAt.$lte = end;
      }
    }

    const itemLabMatch = labId
      ? { 'items.lab_id': new mongoose.Types.ObjectId(labId) }
      : {};

    const assetMatch = labId
      ? { lab_id: new mongoose.Types.ObjectId(labId) }
      : {};

    /* ============================
       1️⃣ TRANSACTION STATS
    ============================= */

    const transactionStats = await Transaction.aggregate([
      { $match: txnMatch },
      { $unwind: '$items' },
      ...(labId ? [{ $match: itemLabMatch }] : []),
      {
        $group: {
          _id: '$items.item_id',
          total_issued: { $sum: '$items.issued_quantity' },
          total_damaged: { $sum: '$items.damaged_quantity' },
          total_returned: { $sum: '$items.returned_quantity' }
        }
      }
    ]);

    /* ============================
       2️⃣ CURRENT INVENTORY STATE
    ============================= */

    const assetStats = await ItemAsset.aggregate([
      { $match: assetMatch },
      {
        $group: {
          _id: '$item_id',
          good_count: { $sum: { $cond: [{ $eq: ['$condition', 'good'] }, 1, 0] } },
          faulty_count: { $sum: { $cond: [{ $eq: ['$condition', 'faulty'] }, 1, 0] } },
          broken_count: { $sum: { $cond: [{ $eq: ['$condition', 'broken'] }, 1, 0] } }
        }
      }
    ]);

    /* ============================
       3️⃣ CONVERT TO MAPS (FAST LOOKUP)
    ============================= */

    const txnMap = new Map(
      transactionStats.map(t => [String(t._id), t])
    );

    const assetMap = new Map(
      assetStats.map(a => [String(a._id), a])
    );

    /* ============================
       4️⃣ FETCH ITEMS (PAGINATED)
    ============================= */

    const skip = (page - 1) * limit;

    const [items, totalItems] = await Promise.all([
      Item.find({ is_active: true })
        .select('name sku category')
        .skip(skip)
        .limit(limit)
        .lean(),

      Item.countDocuments({ is_active: true })
    ]);

    /* ============================
       5️⃣ MERGE DATA
    ============================= */

    const data = items.map(item => {
      const txn = txnMap.get(String(item._id));
      const asset = assetMap.get(String(item._id));

      const totalStock =
        (asset?.good_count || 0) +
        (asset?.faulty_count || 0) +
        (asset?.broken_count || 0);

      const issued = txn?.total_issued || 0;

      return {
        item_id: item._id,
        name: item.name,
        sku: item.sku,
        category: item.category,

        // Transaction stats
        issued_in_range: issued,
        damaged_in_range: txn?.total_damaged || 0,
        returned_in_range: txn?.total_returned || 0,

        // Current inventory
        good_now: asset?.good_count || 0,
        faulty_now: asset?.faulty_count || 0,
        broken_now: asset?.broken_count || 0,

        // Derived metric
        utilization_rate:
          totalStock > 0 ? +(issued / totalStock).toFixed(2) : 0
      };
    });

    /* ============================
       6️⃣ SUMMARY STATS
    ============================= */

    const summary = {
      total_items: totalItems,
      total_issued: transactionStats.reduce(
        (sum, t) => sum + t.total_issued,
        0
      ),
      total_damaged: transactionStats.reduce(
        (sum, t) => sum + t.total_damaged,
        0
      ),
      total_returned: transactionStats.reduce(
        (sum, t) => sum + t.total_returned,
        0
      ),
      total_good: assetStats.reduce(
        (sum, a) => sum + a.good_count,
        0
      ),
      total_faulty: assetStats.reduce(
        (sum, a) => sum + a.faulty_count,
        0
      ),
      total_broken: assetStats.reduce(
        (sum, a) => sum + a.broken_count,
        0
      )
    };

    /* ============================
       RESPONSE
    ============================= */

    return res.json({
      success: true,

      page,
      limit,
      total_items: totalItems,
      total_pages: Math.ceil(totalItems / limit),

      summary,

      data
    });

  } catch (err) {
    console.error('Item analytics error:', err);
    return res.status(500).json({
      error: 'Failed to fetch item analytics'
    });
  }
};

const executeInLabContext = async (req, res, labId, handler) => {
  try {
    const lab = await Lab.findById(labId);
    if (!lab || !lab.is_active) {
      return res.status(404).json({ success: false, message: 'Invalid or inactive lab' });
    }
    req.user.lab_id = labId;
    return handler(req, res);
  } catch (err) {
    console.error('Lab context error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process lab-scoped request' });
  }
};

/* ================= INVENTORY ================= */
exports.getAllItems = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getAllItems);
exports.getItemById = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getItemById);
exports.getItemAssets = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getItemAssets);
exports.getLabAvailableItems = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabAvailableItems);

/* ================= TRANSACTIONS ================= */
exports.getTransactionHistory = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getTransactionHistory);
exports.searchTransactions = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.searchTransactions);
exports.getOverdueTransactions = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getOverdueTransactions);

/* ================= LAB SESSIONS ================= */
exports.getLabSessions = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabSessions);
exports.getLabSessionDetail = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabSessionDetail);

/* ================= LAB TRANSFERS ================= */
exports.getLabTransfers = async (req, res) => {
  try {
    const { labId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(labId)) {
      return res.status(400).json({ success: false, message: 'Invalid lab id' });
    }

    const labObjectId = new mongoose.Types.ObjectId(labId);

    const records = await Transaction.find({
      transaction_type: 'lab_transfer',
      $or: [{ source_lab_id: labObjectId }, { target_lab_id: labObjectId }]
    })
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = records.map(t => ({
      _id: t._id,
      transaction_id: t.transaction_id,
      project_name: t.project_name,
      transfer_type: t.transfer_type,
      status: t.status,
      expected_return_date: t.expected_return_date,
      actual_return_date: t.actual_return_date,
      issued_at: t.issued_at,
      createdAt: t.createdAt,
      source_lab: t.source_lab_id ? {
        _id: t.source_lab_id._id, name: t.source_lab_id.name,
        code: t.source_lab_id.code, location: t.source_lab_id.location
      } : null,
      target_lab: t.target_lab_id ? {
        _id: t.target_lab_id._id, name: t.target_lab_id.name,
        code: t.target_lab_id.code, location: t.target_lab_id.location
      } : null,
      items: t.items.map(i => ({ ...i, asset_tags: i.asset_ids?.map(a => a.asset_tag) || [] }))
    }));

    return res.json({ success: true, count: formatted.length, data: formatted });

  } catch (err) {
    console.error('Super Admin get transfers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab transfers' });
  }
};

exports.getLabTransferDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid transfer id' });
    }

    const record = await Transaction.findOne({ _id: id, transaction_type: 'lab_transfer' })
      .populate('source_lab_id', 'name code location')
      .populate('target_lab_id', 'name code location')
      .populate('items.item_id', 'name sku tracking_type')
      .populate('items.asset_ids', 'asset_tag')
      .populate('issued_by_incharge_id', 'name email')
      .lean();

    if (!record) return res.status(404).json({ success: false, message: 'Transfer not found' });

    record.source_lab = record.source_lab_id
      ? { _id: record.source_lab_id._id, name: record.source_lab_id.name, code: record.source_lab_id.code, location: record.source_lab_id.location }
      : null;
    record.target_lab = record.target_lab_id
      ? { _id: record.target_lab_id._id, name: record.target_lab_id.name, code: record.target_lab_id.code, location: record.target_lab_id.location }
      : null;
    record.items = record.items.map(i => ({ ...i, asset_tags: i.asset_ids?.map(a => a.asset_tag) || [] }));

    return res.json({ success: true, data: record });

  } catch (err) {
    console.error('Super Admin get transfer detail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch transfer' });
  }
};

/* ================= COMPONENT REQUESTS ================= */
exports.getAllComponentRequests = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getAllComponentRequests);
exports.getComponentRequestById = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getComponentRequestById);

/* ================= BILLS ================= */
exports.getBills = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getBills);
exports.downloadBill = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.downloadBill);

/* ================= DAMAGED ASSET HISTORY ================= */
exports.getDamagedAssetHistory = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getDamagedAssetHistory);