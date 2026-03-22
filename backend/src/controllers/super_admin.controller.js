const Lab = require('../models/Lab');
const Staff = require('../models/Staff');
const LabInventory = require('../models/LabInventory');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const bcrypt = require('bcryptjs');
const Item = require('../models/Item');
const ItemAsset = require('../models/ItemAsset');
const DamagedAssetLog = require('../models/DamagedAssetLog');
const mongoose = require('mongoose');
const adminController = require('./admin.controller');
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
   HELPER: Date range match object
===================================================== */
const dateRangeMatch = (startDate, endDate, field = 'createdAt') => {
  const match = {};
  if (startDate || endDate) {
    match[field] = {};
    if (startDate) { const s = new Date(startDate); s.setHours(0, 0, 0, 0); match[field].$gte = s; }
    if (endDate)   { const e = new Date(endDate);   e.setHours(23, 59, 59, 999); match[field].$lte = e; }
  }
  return match;
};

/* =====================================================
   EMAIL TEMPLATES — STAFF ASSIGNMENT
===================================================== */
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
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.75;">You have been assigned a new role in the Lab Management System.</p>
      <div style="background:linear-gradient(135deg,${roleGradientFrom}12,${roleGradientTo}08);border:1px solid ${roleColor}30;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding-bottom:14px;border-bottom:1px solid ${roleColor}20;">
            <p style="margin:0;font-size:11px;color:${roleColor};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Your New Role</p>
            <p style="margin:6px 0 0;font-size:18px;font-weight:800;color:#0f172a;">${roleLabel}</p>
          </td></tr>
          <tr><td style="padding-top:14px;">
            <p style="margin:0;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Assigned Lab</p>
            <p style="margin:6px 0 0;font-size:16px;font-weight:700;color:#0f172a;">
              ${labName}
              <span style="margin-left:8px;background:${roleColor}15;color:${roleColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;font-family:monospace;">${labCode}</span>
            </p>
          </td></tr>
        </table>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">✅ You Already Have an Account</p>
        <p style="margin:0;font-size:13px;color:#166534;line-height:1.7;">Your existing account (<strong>${email}</strong>) has been updated with this new role. Use your current credentials to log in.</p>
      </div>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${frontendUrl}/login" style="display:inline-block;background:linear-gradient(135deg,${roleGradientFrom},${roleGradientTo});color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;">Log In to Your Account →</a>
      </div>
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;text-align:center;">
        Forgot your password? <a href="${frontendUrl}/forgot-password" style="color:${roleColor};font-weight:600;">Reset it here</a>.
      </p>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Lab Management System · Automated message · Do not reply</p>
    </div>
  </div>
</body>
</html>`;
};

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
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.75;">Welcome to the Lab Management System! An account has been created for you.</p>
      <div style="background:linear-gradient(135deg,${roleGradientFrom}12,${roleGradientTo}08);border:1px solid ${roleColor}30;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding-bottom:14px;border-bottom:1px solid ${roleColor}20;">
            <p style="margin:0;font-size:11px;color:${roleColor};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Your Role</p>
            <p style="margin:6px 0 0;font-size:18px;font-weight:800;color:#0f172a;">${roleLabel}</p>
          </td></tr>
          <tr><td style="padding-top:14px;">
            <p style="margin:0;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Assigned Lab</p>
            <p style="margin:6px 0 0;font-size:16px;font-weight:700;color:#0f172a;">
              ${labName}
              <span style="margin-left:8px;background:${roleColor}15;color:${roleColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;font-family:monospace;">${labCode}</span>
            </p>
          </td></tr>
        </table>
      </div>
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;">🔐 Your Login Credentials</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 16px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:600;width:35%;text-transform:uppercase;">Email</td>
          <td style="padding:12px 16px;font-size:14px;color:#0f172a;font-weight:600;font-family:monospace;">${email}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">Temp Password</td>
          <td style="padding:12px 16px;">
            <span style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;font-size:16px;font-weight:800;padding:4px 14px;border-radius:8px;font-family:monospace;letter-spacing:1px;">${tempPassword}</span>
          </td>
        </tr>
      </table>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.7;"><strong>⚠️ Important:</strong> This is a temporary password. Please log in and change it immediately from your profile settings.</p>
      </div>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${frontendUrl}/login" style="display:inline-block;background:linear-gradient(135deg,${roleGradientFrom},${roleGradientTo});color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;">Log In Now →</a>
      </div>
      <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
        Or use <a href="${frontendUrl}/forgot-password" style="color:${roleColor};font-weight:600;">Forgot Password</a> to set your own password.
      </p>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Lab Management System · Automated message · Do not reply</p>
    </div>
  </div>
</body>
</html>`;
};

/* =====================================================
   HELPER: Generate temp password
===================================================== */
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let pwd = '';
  for (let i = 0; i < 10; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  return pwd;
};

/* =====================================================
   HELPER: Assign or create staff
   - Existing email → reactivate + reassign + send login reminder
   - New email → create with temp password + send welcome mail
===================================================== */
const assignOrCreateStaff = async ({ name, email, role, labId, lab }) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  let existing = await Staff.findOne({ email: email.toLowerCase() });

  if (existing) {
    existing.name = name || existing.name;
    existing.role = role;
    existing.lab_id = labId;
    existing.is_active = true;
    await existing.save();

    await sendMail({
      to: existing.email,
      subject: `🎯 New Role Assignment – ${role === 'incharge' ? 'Lab Incharge' : 'Lab Assistant'} at ${lab.name}`,
      html: buildExistingStaffEmail({
        name: existing.name, email: existing.email, role,
        labName: lab.name, labCode: lab.code, frontendUrl: FRONTEND_URL
      })
    });

    return { staff: existing, isNew: false };
  }

  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const newStaff = await Staff.create({
    name, email: email.toLowerCase(), password: hashedPassword,
    role, lab_id: labId, is_active: true
  });

  await sendMail({
    to: newStaff.email,
    subject: `👋 Welcome to Lab Management System – Your Account is Ready`,
    html: buildNewStaffEmail({
      name: newStaff.name, email: newStaff.email, role,
      labName: lab.name, labCode: lab.code,
      tempPassword, frontendUrl: FRONTEND_URL
    })
  });

  return { staff: newStaff, isNew: true };
};

/* =====================================================
   LAB CONTEXT EXECUTOR
   Injects lab_id into req.user so that incharge/admin
   controllers that read req.user.lab_id work correctly
===================================================== */
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

/* =====================================================
   ================= GLOBAL — LAB MANAGEMENT =================
===================================================== */

/* ============================
   CREATE LAB
   Accepts optional incharge/assistant at creation time
============================ */
exports.createLab = async (req, res) => {
  try {
    const {
      name, code, location,
      incharge_name, incharge_email,
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

    if (incharge_name && incharge_email) {
      const { staff, isNew } = await assignOrCreateStaff({
        name: incharge_name, email: incharge_email,
        role: 'incharge', labId: lab._id, lab
      });
      created.incharge = { staff, isNew };
    }

    if (assistant_name && assistant_email) {
      const { staff, isNew } = await assignOrCreateStaff({
        name: assistant_name, email: assistant_email,
        role: 'assistant', labId: lab._id, lab
      });
      created.assistant = { staff, isNew };
    }

    return res.status(201).json({ success: true, data: created });

  } catch (err) {
    console.error('Create lab error:', err);
    return res.status(500).json({ error: 'Failed to create lab' });
  }
};

/* ============================
   GET ALL LABS + STATS
============================ */
exports.getAllLabs = async (req, res) => {
  try {
    const labs = await Lab.find().lean();

    const enriched = await Promise.all(
      labs.map(async (lab) => {
        const [staffCount, inventoryCount] = await Promise.all([
          Staff.countDocuments({ lab_id: lab._id, role: { $in: ['incharge', 'assistant'] }, is_active: true }),
          LabInventory.countDocuments({ lab_id: lab._id })
        ]);
        return { ...lab, stats: { staffCount, inventoryCount } };
      })
    );

    return res.json({ success: true, data: enriched });

  } catch (err) {
    console.error('Get labs error:', err);
    return res.status(500).json({ error: 'Failed to fetch labs' });
  }
};

/* ============================
   REMOVE LAB (SOFT DELETE)
============================ */
exports.removeLab = async (req, res) => {
  try {
    const { labId } = req.params;
    const lab = await Lab.findById(labId);
    if (!lab) return res.status(404).json({ error: 'Lab not found' });
    if (!lab.is_active) return res.status(400).json({ error: 'Lab is already deactivated' });

    // Block deactivation if any blocking transactions exist for this lab
    const BLOCKING_STATUSES = ['raised', 'approved', 'active', 'partial_issued', 'partial_returned'];

    const blockingTxn = await Transaction.findOne({
      'items.lab_id': new mongoose.Types.ObjectId(labId),
      status: { $in: BLOCKING_STATUSES }
    }).select('transaction_id status').lean();

    if (blockingTxn) {
      return res.status(400).json({
        error: `Cannot deactivate lab. There is an active transaction (${blockingTxn.transaction_id}) with status "${blockingTxn.status}". Resolve all pending transactions before deactivating.`
      });
    }

    // Safe to deactivate
    lab.is_active = false;
    await lab.save();

    // Deactivate all staff in this lab
    await Staff.updateMany(
      { lab_id: labId },
      { $set: { is_active: false, lab_id: null } }
    );

    // Hide all inventory items from students by marking lab inventory inactive
    await LabInventory.updateMany(
      { lab_id: labId },
      { $set: { is_active: false } }
    );

    return res.json({ success: true, message: 'Lab deactivated successfully. All staff and inventory hidden.' });

  } catch (err) {
    console.error('Remove lab error:', err);
    return res.status(500).json({ error: 'Failed to remove lab' });
  }
};

/* ============================
   ACTIVATE LAB
   Re-activates a previously deactivated lab.
   Staff are NOT auto-restored (must be reassigned manually).
   Inventory is restored to visible.
============================ */
exports.activateLab = async (req, res) => {
  try {
    const { labId } = req.params;
    const lab = await Lab.findById(labId);
    if (!lab) return res.status(404).json({ error: 'Lab not found' });
    if (lab.is_active) return res.status(400).json({ error: 'Lab is already active' });

    lab.is_active = true;
    await lab.save();

    // Restore inventory visibility
    await LabInventory.updateMany(
      { lab_id: labId },
      { $set: { is_active: true } }
    );

    // Count how many inventory lines were restored
    const inventoryCount = await LabInventory.countDocuments({ lab_id: labId });

    return res.json({
      success: true,
      message: 'Lab activated successfully. Inventory restored.',
      data: {
        lab_id: labId,
        inventory_lines_restored: inventoryCount,
        note: 'Staff must be reassigned manually via Set Incharge / Add Assistant.'
      }
    });

  } catch (err) {
    console.error('Activate lab error:', err);
    return res.status(500).json({ error: 'Failed to activate lab' });
  }
};

/* =====================================================
   ================= LAB-SCOPED STAFF =================
===================================================== */

/* ============================
   ADD ASSISTANT
============================ */
exports.addAssistant = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const lab = await validateLab(labId);
    if (!lab) return res.status(404).json({ error: 'Invalid lab' });

    const { staff, isNew } = await assignOrCreateStaff({ name, email, role: 'assistant', labId, lab });

    return res.status(isNew ? 201 : 200).json({
      success: true, isNew,
      message: isNew
        ? 'Assistant account created and credentials sent via email'
        : 'Existing staff reassigned as assistant. Login instructions sent.',
      data: { ...staff.toObject(), password: undefined }
    });

  } catch (err) {
    console.error('Add assistant error:', err);
    return res.status(500).json({ error: 'Failed to add assistant' });
  }
};

/* ============================
   REMOVE ASSISTANT
============================ */
exports.removeAssistant = async (req, res) => {
  try {
    const { labId, staffId } = req.params;

    const staff = await Staff.findOne({ _id: staffId, lab_id: labId, role: 'assistant' });
    if (!staff) return res.status(404).json({ error: 'Assistant not found' });

    staff.is_active = false;
    staff.lab_id = null;
    await staff.save();

    return res.json({ success: true, message: 'Assistant removed successfully' });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove assistant' });
  }
};

/* ============================
   CHANGE / SET INCHARGE
   Deactivates previous incharge first
============================ */
exports.changeIncharge = async (req, res) => {
  try {
    const { labId } = req.params;
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const lab = await validateLab(labId);
    if (!lab) return res.status(404).json({ error: 'Invalid lab' });

    // Deactivate current incharge
    await Staff.updateMany(
      { lab_id: labId, role: 'incharge' },
      { $set: { is_active: false, lab_id: null } }
    );

    const { staff, isNew } = await assignOrCreateStaff({ name, email, role: 'incharge', labId, lab });

    return res.status(isNew ? 201 : 200).json({
      success: true, isNew,
      message: isNew
        ? 'New incharge account created and credentials sent via email'
        : 'Existing staff reassigned as incharge. Login instructions sent.',
      data: { ...staff.toObject(), password: undefined }
    });

  } catch (err) {
    console.error('Change incharge error:', err);
    return res.status(500).json({ error: 'Failed to change incharge' });
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
    }).select('-password').lean();

    return res.json({ success: true, data: staff });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch lab staff' });
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
    }).select('-password').lean();

    return res.json({ success: true, data: incharge || null });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch incharge' });
  }
};

/* =====================================================
   ================= ANALYTICS =================
===================================================== */

/* ============================
   1. OVERVIEW DASHBOARD
   GET /super-admin/analytics/overview?labId=&startDate=&endDate=
============================ */
exports.getAnalyticsOverview = async (req, res) => {
  try {
    const { labId, startDate, endDate } = req.query;
    const labFilter = labId ? { 'items.lab_id': new mongoose.Types.ObjectId(labId) } : {};
    const dateFilter = dateRangeMatch(startDate, endDate);
    const txMatch = { ...labFilter, ...dateFilter };
    const inventoryMatch = labId ? { lab_id: new mongoose.Types.ObjectId(labId) } : {};

    /* Status breakdown */
    const statusBreakdown = await Transaction.aggregate([
      { $match: txMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    /* Transaction type breakdown */
    const typeBreakdown = await Transaction.aggregate([
      { $match: txMatch },
      { $group: { _id: '$transaction_type', count: { $sum: 1 } } }
    ]);

    /* Monthly trend — last 6 months */
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await Transaction.aggregate([
      { $match: { ...labFilter, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      {
        $project: {
          _id: 0,
          month: {
            $concat: [
              { $toString: '$_id.year' }, '-',
              { $cond: [{ $lt: ['$_id.month', 10] }, { $concat: ['0', { $toString: '$_id.month' }] }, { $toString: '$_id.month' }] }
            ]
          },
          total: 1, active: 1, completed: 1, overdue: 1
        }
      }
    ]);

    /* Inventory health per lab */
    const inventoryHealth = await LabInventory.aggregate([
      { $match: inventoryMatch },
      {
        $group: {
          _id: '$lab_id',
          total_items: { $sum: 1 },
          total_qty: { $sum: '$total_quantity' },
          available_qty: { $sum: '$available_quantity' },
          reserved_qty: { $sum: { $ifNull: ['$reserved_quantity', 0] } },
          temp_reserved_qty: { $sum: { $ifNull: ['$temp_reserved_quantity', 0] } }
        }
      },
      { $lookup: { from: 'labs', localField: '_id', foreignField: '_id', as: 'lab' } },
      { $unwind: { path: '$lab', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0, lab_id: '$_id',
          lab_name: '$lab.name', lab_code: '$lab.code',
          total_items: 1, total_qty: 1, available_qty: 1,
          reserved_qty: 1, temp_reserved_qty: 1,
          // issued_qty = total - available (available already subtracts reserved)
          issued_qty: { $subtract: ['$total_qty', '$available_qty'] },
          utilization_pct: {
            $cond: [
              { $gt: ['$total_qty', 0] },
              {
                $round: [{
                  $multiply: [{
                    $divide: [
                      { $subtract: ['$total_qty', '$available_qty'] },
                      '$total_qty'
                    ]
                  }, 100]
                }, 1]
              },
              0
            ]
          }
        }
      },
      { $sort: { utilization_pct: -1 } }
    ]);

    /* Top 10 most borrowed items */
    const topBorrowedItems = await Transaction.aggregate([
      { $match: txMatch },
      { $unwind: '$items' },
      ...(labId ? [{ $match: { 'items.lab_id': new mongoose.Types.ObjectId(labId) } }] : []),
      {
        $group: {
          _id: '$items.item_id',
          borrow_count: { $sum: 1 },
          total_qty_issued: { $sum: { $ifNull: ['$items.issued_quantity', 0] } }
        }
      },
      { $sort: { borrow_count: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'items', localField: '_id', foreignField: '_id', as: 'item' } },
      { $unwind: { path: '$item', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0, item_id: '$_id',
          name: '$item.name', sku: '$item.sku',
          category: '$item.category', tracking_type: '$item.tracking_type',
          borrow_count: 1, total_qty_issued: 1
        }
      }
    ]);

    /* Overdue count */
    const now = new Date();
    const overdueCount = await Transaction.countDocuments({
      ...labFilter,
      status: { $in: ['overdue', 'active', 'partial_returned'] },
      expected_return_date: { $lt: now }
    });

    /* Damage summary */
    const damageSummary = await ItemAsset.aggregate([
      { $match: { ...inventoryMatch, condition: { $ne: 'good' } } },
      { $group: { _id: '$condition', count: { $sum: 1 } } }
    ]);

    /* Summary counts */
    const [totalTransactions, totalLabs, totalItems, totalStaff, activeCount] = await Promise.all([
      Transaction.countDocuments(txMatch),
      labId ? 1 : Lab.countDocuments({ is_active: true }),
      LabInventory.countDocuments(inventoryMatch),
      Staff.countDocuments({
        is_active: true,
        role: { $in: ['incharge', 'assistant'] },
        ...(labId ? { lab_id: new mongoose.Types.ObjectId(labId) } : {})
      }),
      Transaction.countDocuments({ ...labFilter, status: 'active' })
    ]);

    return res.json({
      success: true,
      data: {
        summary: {
          total_transactions: totalTransactions,
          total_labs: totalLabs,
          total_items: totalItems,
          overdue_count: overdueCount,
          total_staff: totalStaff,
          active_count: activeCount
        },
        status_breakdown: statusBreakdown.map(s => ({ status: s._id || 'unknown', count: s.count })),
        type_breakdown: typeBreakdown.map(t => ({ type: t._id || 'unknown', count: t.count })),
        monthly_trend: monthlyTrend,
        inventory_health: inventoryHealth,
        top_borrowed_items: topBorrowedItems.filter(i => i.name),
        damage_summary: damageSummary.map(d => ({ condition: d._id, count: d.count }))
      }
    });

  } catch (err) {
    console.error('Analytics overview error:', err);
    return res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
};

/* ============================
   2. TRANSACTION REPORT
   POST /super-admin/analytics/transactions
   Paginated + CSV export
============================ */
exports.getTransactionReport = async (req, res) => {
  try {
    const {
      fields, startDate, endDate, labId,
      status, transaction_type, student_reg_no, faculty_email,
      format, page = 1, limit = 50
    } = req.body;

    const allowedFields = [
      'transaction_id', 'project_name', 'transaction_type', 'status',
      'student_id', 'student_reg_no', 'faculty_email', 'faculty_id',
      'issued_at', 'expected_return_date', 'actual_return_date',
      'createdAt', 'updatedAt', 'lab_slot', 'transfer_type'
    ];

    const selectedFields = Array.isArray(fields) && fields.length > 0
      ? fields.filter(f => allowedFields.includes(f))
      : allowedFields;

    if (selectedFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields selected' });
    }

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 200);
    const skip = (pageNum - 1) * limitNum;

    const matchStage = {};
    if (startDate || endDate) Object.assign(matchStage, dateRangeMatch(startDate, endDate));
    if (status)           matchStage.status = status;
    if (transaction_type) matchStage.transaction_type = transaction_type;
    if (student_reg_no)   matchStage.student_reg_no = new RegExp(student_reg_no, 'i');
    if (faculty_email)    matchStage.faculty_email = new RegExp(faculty_email, 'i');

    const pipeline = [];
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
    pipeline.push({ $unwind: '$items' });
    if (labId) pipeline.push({ $match: { 'items.lab_id': new mongoose.Types.ObjectId(labId) } });
    pipeline.push(
      { $group: { _id: '$_id', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } }
    );

    const projectStage = { _id: 0 };
    selectedFields.forEach(f => { projectStage[f] = 1; });
    pipeline.push({ $project: projectStage });
    pipeline.push({ $sort: { createdAt: -1 } });

    if (format === 'csv') {
      pipeline.push({ $limit: 5000 });
      const transactions = await Transaction.aggregate(pipeline);
      const header = selectedFields.join(',');
      const rows = transactions.map(txn =>
        selectedFields.map(field => {
          const val = txn[field] ?? '';
          const str = val instanceof Date ? val.toISOString() : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        }).join(',')
      );
      res.setHeader('Content-Disposition', 'attachment; filename=transaction_report.csv');
      res.setHeader('Content-Type', 'text/csv');
      return res.send([header, ...rows].join('\n'));
    }

    // Paginated JSON
    const countPipeline = [...pipeline.slice(0, pipeline.length - 1), { $count: 'total' }];
    const [countResult, transactions] = await Promise.all([
      Transaction.aggregate(countPipeline),
      Transaction.aggregate([...pipeline, { $skip: skip }, { $limit: limitNum }])
    ]);

    const total = countResult[0]?.total || 0;

    return res.json({
      success: true,
      page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: transactions.length, data: transactions
    });

  } catch (err) {
    console.error('Transaction report error:', err);
    return res.status(500).json({ error: 'Failed to fetch transaction report' });
  }
};

/* ============================
   3. ITEM USAGE REPORT
   POST /super-admin/analytics/items
   Paginated + borrow stats + asset condition
============================ */
exports.getItemReport = async (req, res) => {
  try {
    const { startDate, endDate, labId, category, tracking_type, page = 1, limit = 50 } = req.body;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 200);
    const skip = (pageNum - 1) * limitNum;

    const txMatch = {};
    if (startDate || endDate) Object.assign(txMatch, dateRangeMatch(startDate, endDate));

    const transactionStats = await Transaction.aggregate([
      { $match: txMatch },
      { $unwind: '$items' },
      ...(labId ? [{ $match: { 'items.lab_id': new mongoose.Types.ObjectId(labId) } }] : []),
      {
        $group: {
          _id: '$items.item_id',
          borrow_count: { $sum: 1 },
          total_issued: { $sum: { $ifNull: ['$items.issued_quantity', 0] } },
          total_returned: { $sum: { $ifNull: ['$items.returned_quantity', 0] } },
          total_damaged: { $sum: { $ifNull: ['$items.damaged_quantity', 0] } }
        }
      }
    ]);

    const assetMatch = labId ? { lab_id: new mongoose.Types.ObjectId(labId) } : {};
    const assetStats = await ItemAsset.aggregate([
      { $match: assetMatch },
      {
        $group: {
          _id: '$item_id',
          good: { $sum: { $cond: [{ $eq: ['$condition', 'good'] }, 1, 0] } },
          faulty: { $sum: { $cond: [{ $eq: ['$condition', 'faulty'] }, 1, 0] } },
          broken: { $sum: { $cond: [{ $eq: ['$condition', 'broken'] }, 1, 0] } }
        }
      }
    ]);

    const itemFilter = { is_active: true };
    if (category) itemFilter.category = new RegExp(category, 'i');
    if (tracking_type) itemFilter.tracking_type = tracking_type;

    const inventoryFilter = labId ? { lab_id: new mongoose.Types.ObjectId(labId) } : {};
    const inventories = await LabInventory.find(inventoryFilter)
      .populate({ path: 'item_id', match: itemFilter, select: 'name sku category tracking_type' })
      .lean();

    const result = inventories
      .filter(inv => inv.item_id)
      .map(inv => {
        const item = inv.item_id;
        const txnStat = transactionStats.find(t => String(t._id) === String(item._id));
        const assetStat = assetStats.find(a => String(a._id) === String(item._id));
        return {
          item_id: item._id, name: item.name, sku: item.sku,
          category: item.category || '—', tracking_type: item.tracking_type,
          total_quantity: inv.total_quantity,
          available_quantity: inv.available_quantity,
          reserved_quantity: inv.reserved_quantity,
          borrow_count: txnStat?.borrow_count || 0,
          total_issued: txnStat?.total_issued || 0,
          total_returned: txnStat?.total_returned || 0,
          total_damaged: txnStat?.total_damaged || 0,
          assets_good: assetStat?.good || 0,
          assets_faulty: assetStat?.faulty || 0,
          assets_broken: assetStat?.broken || 0
        };
      })
      .sort((a, b) => b.borrow_count - a.borrow_count);

    const total = result.length;
    const paginated = result.slice(skip, skip + limitNum);

    return res.json({
      success: true,
      page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: paginated.length, data: paginated
    });

  } catch (err) {
    console.error('Item report error:', err);
    return res.status(500).json({ error: 'Failed to fetch item report' });
  }
};

/* ============================
   4. LAB COMPARISON
   GET /super-admin/analytics/labs/compare?startDate=&endDate=
   Side-by-side stats for all active labs
============================ */
exports.getLabComparison = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = dateRangeMatch(startDate, endDate);

    const labs = await Lab.find({ is_active: true }).select('name code location').lean();

    const result = await Promise.all(labs.map(async (lab) => {
      const labObjectId = new mongoose.Types.ObjectId(lab._id);

      const [txStats, invStats, damagedCount, staffCount] = await Promise.all([
        Transaction.aggregate([
          { $match: { 'items.lab_id': labObjectId, ...dateFilter } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              overdue: { $sum: { $cond: [{ $in: ['$status', ['overdue', 'partial_returned']] }, 1, 0] } }
            }
          }
        ]),
        LabInventory.aggregate([
          { $match: { lab_id: labObjectId } },
          {
            $group: {
              _id: null,
              total_items: { $sum: 1 },
              total_qty: { $sum: '$total_quantity' },
              available_qty: { $sum: '$available_quantity' }
            }
          }
        ]),
        ItemAsset.countDocuments({ lab_id: labObjectId, condition: { $ne: 'good' } }),
        Staff.countDocuments({ lab_id: labObjectId, is_active: true, role: { $in: ['incharge', 'assistant'] } })
      ]);

      const s = txStats[0] || {};
      const inv = invStats[0] || {};

      return {
        lab_id: lab._id, lab_name: lab.name, lab_code: lab.code,
        staff_count: staffCount,
        total_items: inv.total_items || 0,
        total_qty: inv.total_qty || 0,
        available_qty: inv.available_qty || 0,
        utilization_pct: inv.total_qty > 0
          ? Math.round(((inv.total_qty - inv.available_qty) / inv.total_qty) * 100) : 0,
        transactions_total: s.total || 0,
        transactions_active: s.active || 0,
        transactions_completed: s.completed || 0,
        transactions_overdue: s.overdue || 0,
        damaged_assets: damagedCount
      };
    }));

    return res.json({ success: true, count: result.length, data: result });

  } catch (err) {
    console.error('Lab comparison error:', err);
    return res.status(500).json({ error: 'Failed to fetch lab comparison' });
  }
};

/* ============================
   5. OVERDUE REPORT
   GET /super-admin/analytics/overdue?labId=&page=&limit=
   Sorted by most days overdue first
============================ */
exports.getOverdueReport = async (req, res) => {
  try {
    const { labId, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;
    const now = new Date();

    const labMatch = labId ? { 'items.lab_id': new mongoose.Types.ObjectId(labId) } : {};

    const pipeline = [
      {
        $match: {
          ...labMatch,
          status: { $in: ['overdue', 'active', 'partial_returned'] },
          expected_return_date: { $lt: now }
        }
      },
      {
        $addFields: {
          days_overdue: {
            $ceil: { $divide: [{ $subtract: [now, '$expected_return_date'] }, 86400000] }
          }
        }
      },
      {
        $lookup: {
          from: 'students', localField: 'student_id', foreignField: '_id', as: 'student',
          pipeline: [{ $project: { name: 1, reg_no: 1, email: 1 } }]
        }
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          transaction_id: 1, status: 1, student_reg_no: 1, faculty_email: 1,
          expected_return_date: 1, days_overdue: 1,
          items_count: { $size: '$items' },
          student_name: '$student.name', student_email: '$student.email'
        }
      },
      { $sort: { days_overdue: -1 } },
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
      page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: data.length, data
    });

  } catch (err) {
    console.error('Overdue report error:', err);
    return res.status(500).json({ error: 'Failed to fetch overdue report' });
  }
};

/* ============================
   6. DAMAGE REPORT
   GET /super-admin/analytics/damage?labId=&startDate=&endDate=&page=&limit=
============================ */
exports.getDamageReport = async (req, res) => {
  try {
    const { labId, startDate, endDate, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const matchStage = {};
    if (startDate || endDate) Object.assign(matchStage, dateRangeMatch(startDate, endDate, 'reported_at'));

    const pipeline = [
      { $match: matchStage },
      { $lookup: { from: 'itemassets', localField: 'asset_id', foreignField: '_id', as: 'asset' } },
      { $unwind: '$asset' },
      ...(labId ? [{ $match: { 'asset.lab_id': new mongoose.Types.ObjectId(labId) } }] : []),
      { $lookup: { from: 'items', localField: 'asset.item_id', foreignField: '_id', as: 'item' } },
      { $unwind: '$item' },
      { $lookup: { from: 'labs', localField: 'asset.lab_id', foreignField: '_id', as: 'lab' } },
      { $unwind: { path: '$lab', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          asset_tag: '$asset.asset_tag',
          item_name: '$item.name', sku: '$item.sku', category: '$item.category',
          lab_name: '$lab.name', lab_code: '$lab.code',
          vendor: '$asset.vendor',
          damage_reason: 1, remarks: 1, status: 1,
          faculty_email: 1, faculty_id: 1,
          reported_at: 1
        }
      },
      { $sort: { reported_at: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limitNum }]
        }
      }
    ];

    const result = await DamagedAssetLog.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return res.json({
      success: true,
      page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: data.length, data
    });

  } catch (err) {
    console.error('Damage report error:', err);
    return res.status(500).json({ error: 'Failed to fetch damage report' });
  }
};

/* =====================================================
   ================= LAB-SCOPED PROXIES =================
   These delegate to adminController (incharge.controller)
   after injecting the correct lab_id via executeInLabContext
===================================================== */

/* ── Inventory ── */
exports.getAllItems        = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getAllItems);
exports.getItemById        = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getItemById);
exports.getItemAssets      = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getItemAssets);
exports.getLabAvailableItems = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabAvailableItems);

/* ── Transactions ── */
exports.getTransactionHistory  = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getTransactionHistory);
exports.getOverdueTransactions = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getOverdueTransactions);

/* ============================
   SEARCH TRANSACTIONS (Super Admin)
   GET /super-admin/labs/:labId/transactions/search
   ?q=&status=&page=&limit=
   
   q does prefix match on transaction_id OR student_reg_no.
   This is standalone (not proxied) because the incharge
   searchTransactions uses different param names.
============================ */
exports.searchTransactions = async (req, res) => {
  try {
    const { labId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(labId)) {
      return res.status(400).json({ success: false, message: 'Invalid lab id' });
    }

    const { q, status, page = 1, limit = 25 } = req.query;
    const pageNum  = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip     = (pageNum - 1) * limitNum;
    const labObjectId = new mongoose.Types.ObjectId(labId);

    // Base filter — must involve this lab
    const matchStage = { 'items.lab_id': labObjectId };

    // Prefix match on transaction_id OR student_reg_no
    if (q && q.trim().length > 0) {
      const regex = new RegExp(`^${q.trim()}`, 'i');
      matchStage.$or = [
        { transaction_id: regex },
        { student_reg_no: regex }
      ];
    }

    if (status && status !== 'all') {
      matchStage.status = status;
    }

    const pipeline = [
      { $match: matchStage },

      // Keep only items belonging to this lab
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

      // Lookup item names
      {
        $lookup: {
          from: 'items', localField: 'items.item_id', foreignField: '_id', as: '_itemDefs',
          pipeline: [{ $project: { name: 1, sku: 1, tracking_type: 1 } }]
        }
      },

      // Lookup asset tags
      {
        $lookup: {
          from: 'itemassets', localField: 'items.asset_ids', foreignField: '_id', as: '_assetDefs',
          pipeline: [{ $project: { asset_tag: 1, serial_no: 1, status: 1 } }]
        }
      },

      // Merge item + asset info into items array
      {
        $addFields: {
          items: {
            $map: {
              input: '$items', as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    item_id: {
                      $arrayElemAt: [
                        { $filter: { input: '$_itemDefs', as: 'def', cond: { $eq: ['$$def._id', '$$item.item_id'] } } },
                        0
                      ]
                    },
                    asset_tags: {
                      $map: {
                        input: {
                          $filter: { input: '$_assetDefs', as: 'asset', cond: { $in: ['$$asset._id', { $ifNull: ['$$item.asset_ids', []] }] } }
                        },
                        as: 'a', in: '$$a.asset_tag'
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      },

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
    const total  = result[0]?.metadata[0]?.total || 0;
    const data   = result[0]?.data || [];

    return res.json({
      success: true,
      page: pageNum, limit: limitNum,
      totalItems: total, totalPages: Math.ceil(total / limitNum),
      count: data.length, data
    });

  } catch (err) {
    console.error('Super admin search transactions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to search transactions' });
  }
};

/* ── Lab Sessions ── */
exports.getLabSessions     = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabSessions);
exports.getLabSessionDetail = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getLabSessionDetail);

/* ── Component Requests ── */
exports.getAllComponentRequests  = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getAllComponentRequests);
exports.getComponentRequestById  = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getComponentRequestById);

/* ── Bills ── */
exports.getBills     = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getBills);
exports.downloadBill = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.downloadBill);

/* ── Damaged Asset History ── */
exports.getDamagedAssetHistory = (req, res) => executeInLabContext(req, res, req.params.labId, adminController.getDamagedAssetHistory);

/* =====================================================
   ================= LAB TRANSFERS =================
   These are standalone (not proxied) because transfer
   logic is cross-lab and needs both source + target lab
===================================================== */

/* ============================
   GET ALL TRANSFERS FOR A LAB
   (paginated — shows both incoming + outgoing)
============================ */
exports.getLabTransfers = async (req, res) => {
  try {
    const { labId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(labId)) {
      return res.status(400).json({ success: false, message: 'Invalid lab id' });
    }

    const labObjectId = new mongoose.Types.ObjectId(labId);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    const baseFilter = {
      transaction_type: 'lab_transfer',
      $or: [{ source_lab_id: labObjectId }, { target_lab_id: labObjectId }]
    };

    const [total, records] = await Promise.all([
      Transaction.countDocuments(baseFilter),
      Transaction.find(baseFilter)
        .populate('source_lab_id', 'name code location')
        .populate('target_lab_id', 'name code location')
        .populate('items.item_id', 'name sku tracking_type')
        .populate('items.asset_ids', 'asset_tag')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const formatted = records.map(t => ({
      _id: t._id,
      transaction_id: t.transaction_id,
      transfer_type: t.transfer_type,
      status: t.status,
      expected_return_date: t.expected_return_date,
      actual_return_date: t.actual_return_date,
      issued_at: t.issued_at,
      createdAt: t.createdAt,
      source_lab: t.source_lab_id
        ? { _id: t.source_lab_id._id, name: t.source_lab_id.name, code: t.source_lab_id.code, location: t.source_lab_id.location }
        : null,
      target_lab: t.target_lab_id
        ? { _id: t.target_lab_id._id, name: t.target_lab_id.name, code: t.target_lab_id.code, location: t.target_lab_id.location }
        : null,
      items: t.items.map(i => ({ ...i, asset_tags: i.asset_ids?.map(a => a.asset_tag) || [] }))
    }));

    return res.json({
      success: true,
      page, limit,
      totalItems: total,
      totalPages: Math.ceil(total / limit),
      count: formatted.length,
      data: formatted
    });

  } catch (err) {
    console.error('Get transfers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch lab transfers' });
  }
};

/* ============================
   GET SINGLE TRANSFER DETAIL
============================ */
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
    console.error('Get transfer detail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch transfer' });
  }
};