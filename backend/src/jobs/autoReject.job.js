// src/jobs/autoReject.job.js

const cron = require('node-cron');
const mongoose = require('mongoose');

const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const Student = require('../models/Student');
const Item = require('../models/Item');
const Lab = require('../models/Lab');
const Notification = require('../models/Notification');
const { sendMail } = require('../services/mail.service');

/* ======================================================
   EMAIL HELPERS
====================================================== */

const alreadyNotified = async (transactionId, type) => {
  return Notification.findOne({ transaction_id: transactionId, type });
};

const saveNotification = async ({ to, txnId, type }) => {
  await Notification.create({ 
    type, 
    recipient_email: to, 
    transaction_id: txnId 
  });
};

/* ======================================================
   BUILD ITEMS BREAKDOWN FOR EMAIL
====================================================== */
const buildItemBreakdown = async (items) => {
  const itemList = [];
  
  for (const item of items) {
    const itemDef = await Item.findById(item.item_id).select('name sku').lean();
    const lab = await Lab.findById(item.lab_id).select('name code').lean();
    
    itemList.push({
      name: itemDef?.name || 'Unknown Item',
      sku: itemDef?.sku || '',
      quantity: item.quantity || 0,
      lab_name: lab?.name || 'Unknown Lab',
      lab_code: lab?.code || ''
    });
  }
  
  return itemList;
};

/* ======================================================
   EMAIL TEMPLATE - NOT APPROVED BY FACULTY
====================================================== */
const buildFacultyRejectionEmail = ({ txn, studentName, itemBreakdown, rejectionReason }) => {
  const itemRows = itemBreakdown.map(item => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <strong>${item.name}</strong>
        <span style="color:#94a3b8;font-size:11px;margin-left:6px;font-family:monospace;">${item.sku}</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
        <span style="background:#fef2f2;color:#dc2626;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">
          ${item.quantity}
        </span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">
        ${item.lab_name} (${item.lab_code})
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:56px;vertical-align:middle;">
            <div style="width:52px;height:52px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:52px;font-size:26px;">❌</div>
          </td>
          <td style="padding-left:16px;vertical-align:middle;">
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">
              Request Rejected
            </p>
            <h1 style="margin:5px 0 0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.3px;">
              Not Approved by Faculty
            </h1>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${studentName || 'there'}</strong>,</p>
      <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.75;">
        Your lab item request <strong style="font-family:monospace;color:#0f172a;">${txn.transaction_id}</strong> has been 
        <strong style="color:#dc2626;">auto-rejected</strong> by the VLabs system because it was not approved by the faculty 
        within the required timeframe.
      </p>

      <!-- Transaction ID Card -->
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
        <p style="margin:0;font-size:10px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Transaction ID</p>
        <p style="margin:5px 0 0;font-size:15px;font-weight:800;color:#0f172a;font-family:monospace;">${txn.transaction_id}</p>
      </div>

      ${rejectionReason ? `
      <!-- Rejection Reason -->
      <div style="background:#fff7ed;border-left:4px solid #ea580c;padding:14px 18px;margin-bottom:24px;border-radius:6px;">
        <p style="margin:0;font-size:11px;color:#9a3412;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Faculty Reason</p>
        <p style="margin:8px 0 0;font-size:13px;color:#0f172a;line-height:1.6;">${rejectionReason}</p>
      </div>
      ` : ''}

      <!-- Items Table -->
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;">📦 Requested Items</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Item</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Lab</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || `<tr><td colspan="3" style="padding:18px;text-align:center;color:#94a3b8;font-size:13px;">No items found</td></tr>`}
        </tbody>
      </table>

      <!-- Action Box -->
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px;">
        <p style="margin:0;font-size:13px;color:#6d28d9;line-height:1.7;">
          <strong>📌 What to do next:</strong> If you still need these items, please submit a new request and ensure your 
          faculty approves it within 24 hours. Contact your faculty if you have questions about the rejection.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Automated notification · VLabs Management System · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/* ======================================================
   EMAIL TEMPLATE - APPROVED BUT NOT PICKED UP
====================================================== */
const buildNotPickedUpEmail = ({ txn, studentName, itemBreakdown }) => {
  const itemRows = itemBreakdown.map(item => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <strong>${item.name}</strong>
        <span style="color:#94a3b8;font-size:11px;margin-left:6px;font-family:monospace;">${item.sku}</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
        <span style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">
          ${item.quantity}
        </span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">
        ${item.lab_name} (${item.lab_code})
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:56px;vertical-align:middle;">
            <div style="width:52px;height:52px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:52px;font-size:26px;">⏰</div>
          </td>
          <td style="padding-left:16px;vertical-align:middle;">
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">
              Request Expired
            </p>
            <h1 style="margin:5px 0 0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.3px;">
              Items Not Collected
            </h1>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${studentName || 'there'}</strong>,</p>
      <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.75;">
        Your lab item request <strong style="font-family:monospace;color:#0f172a;">${txn.transaction_id}</strong> was 
        <strong style="color:#16a34a;">approved by your faculty</strong>, but has been 
        <strong style="color:#ea580c;">auto-rejected</strong> by the VLabs system because you did not collect the items 
        from the lab within 48 hours of approval.
      </p>

      <!-- Transaction ID Card -->
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
        <p style="margin:0;font-size:10px;color:#ea580c;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Transaction ID</p>
        <p style="margin:5px 0 0;font-size:15px;font-weight:800;color:#0f172a;font-family:monospace;">${txn.transaction_id}</p>
      </div>

      <!-- Info Banner -->
      <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 18px;margin-bottom:24px;border-radius:6px;">
        <p style="margin:0;font-size:13px;color:#065f46;line-height:1.6;">
          ✅ Your request was approved, but you didn't proceed with the physical borrowing from the lab within the allowed time window.
        </p>
      </div>

      <!-- Items Table -->
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;">📦 Reserved Items (Now Released)</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Item</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Lab</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || `<tr><td colspan="3" style="padding:18px;text-align:center;color:#94a3b8;font-size:13px;">No items found</td></tr>`}
        </tbody>
      </table>

      <!-- Action Box -->
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px;">
        <p style="margin:0;font-size:13px;color:#6d28d9;line-height:1.7;">
          <strong>📌 What to do next:</strong> If you still need these items, please submit a new request. After approval, 
          make sure to visit the lab and collect the items within 48 hours to avoid automatic rejection.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Automated notification · VLabs Management System · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/* ======================================================
   SEND REJECTION EMAIL TO STUDENT
====================================================== */
const sendRejectionEmail = async ({ txn, reason }) => {
  try {
    // Check if already notified
    const notificationType = reason === 'not_approved' ? 'auto_reject_not_approved' : 'auto_reject_not_picked_up';
    const alreadySent = await alreadyNotified(txn.transaction_id, notificationType);
    
    if (alreadySent) {
      console.log(`Email already sent for ${txn.transaction_id} (${notificationType})`);
      return;
    }

    // Get student details
    const student = await Student.findById(txn.student_id).select('name email').lean();
    if (!student || !student.email) {
      console.log(`No email found for student in transaction ${txn.transaction_id}`);
      return;
    }

    // Build item breakdown
    const itemBreakdown = await buildItemBreakdown(txn.items);

    let subject, html;

    if (reason === 'not_approved') {
      // Faculty did not approve within 24 hours
      subject = `❌ Request Rejected – Not Approved by Faculty (${txn.transaction_id})`;
      html = buildFacultyRejectionEmail({
        txn,
        studentName: student.name,
        itemBreakdown,
        rejectionReason: txn.faculty_approval?.rejected_reason || null
      });
    } else {
      // Faculty approved but student didn't pick up within 48 hours
      subject = `⏰ Request Expired – Items Not Collected (${txn.transaction_id})`;
      html = buildNotPickedUpEmail({
        txn,
        studentName: student.name,
        itemBreakdown
      });
    }

    // Send email
    await sendMail({
      to: student.email,
      subject,
      html
    });

    // Save notification record
    await saveNotification({
      to: student.email,
      txnId: txn.transaction_id,
      type: notificationType
    });

    console.log(`✅ Sent ${reason} rejection email for ${txn.transaction_id} to ${student.email}`);

  } catch (error) {
    console.error(`Failed to send rejection email for ${txn.transaction_id}:`, error);
  }
};

/* ======================================================
   MAIN AUTO-REJECT FUNCTION
====================================================== */
const autoRejectExpiredTransactions = async () => {
  const session = await mongoose.startSession();

  try {
    const now = new Date();

    const raisedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const approvedCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    await session.startTransaction();

    const transactions = await Transaction.find({
      transaction_type: 'regular',  // Only auto-reject regular student transactions
      $or: [
        { status: 'raised', createdAt: { $lte: raisedCutoff } },
        { status: 'approved', updatedAt: { $lte: approvedCutoff } }
      ]
    }).session(session);

    for (const txn of transactions) {
      // Determine rejection reason
      const rejectionReason = txn.status === 'raised' ? 'not_approved' : 'not_picked_up';

      for (const txnItem of txn.items) {

        const { item_id, lab_id, quantity } = txnItem;

        const labInventory = await LabInventory.findOne({
          lab_id,
          item_id
        }).session(session);

        if (labInventory) {

          labInventory.temp_reserved_quantity =
            (labInventory.temp_reserved_quantity || 0) - quantity;

          if (labInventory.temp_reserved_quantity < 0) {
            labInventory.temp_reserved_quantity = 0;
          }

          await labInventory.save({ session });
        }
      }

      txn.status = 'rejected';
      txn.rejection_reason = rejectionReason === 'not_approved' 
        ? 'Auto-rejected: Not approved by faculty within 24 hours'
        : 'Auto-rejected: Student did not collect items within 48 hours of approval';
      
      await txn.save({ session });

      console.log(`Auto-rejected transaction ${txn.transaction_id} (reason: ${rejectionReason})`);

      // Send email notification (outside transaction to avoid blocking)
      // We'll send it after commit
      // Store for later processing
      txn._rejectionReason = rejectionReason;
    }

    await session.commitTransaction();
    session.endSession();

    // Send emails after successful commit
    for (const txn of transactions) {
      if (txn._rejectionReason) {
        await sendRejectionEmail({ 
          txn, 
          reason: txn._rejectionReason 
        });
      }
    }

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Auto reject cron failed:', err);
  }
};

const startAutoRejectJob = () => {

  // 🕕 Run daily at 6 PM
  cron.schedule('0 18 * * *', async () => {
    console.log('Running auto-reject cron job...');
    await autoRejectExpiredTransactions();
  });

};

module.exports = startAutoRejectJob;