const cron = require('node-cron');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const Staff = require('../models/Staff');
const Lab = require('../models/Lab');
const Item = require('../models/Item');
const Notification = require('../models/Notification');
const { sendMail } = require('../services/mail.service');

/* ======================================================
   HELPERS
====================================================== */

const alreadyNotified = async (transactionId, type) => {
  return Notification.findOne({ transaction_id: transactionId, type });
};

const saveNotification = async ({ to, txnId, type }) => {
  await Notification.create({ type, recipient_email: to, transaction_id: txnId });
};

/* ======================================================
   STATUS RESOLVER
   Never downgrade partial_returned → overdue
   Never downgrade partial_issued → overdue
   Never touch completed / rejected
====================================================== */
const resolveOverdueStatus = (txn) => {
  if (['completed', 'rejected'].includes(txn.status)) return txn.status;
  if (txn.status === 'partial_returned') return 'partial_returned';
  if (txn.status === 'partial_issued') return 'partial_issued';
  
  // Check if any items have been returned
  const anyReturned = txn.items.some(i => (i.returned_quantity ?? 0) > 0);
  if (anyReturned) return 'partial_returned';
  
  // Check if any items have been issued
  const anyIssued = txn.items.some(i => (i.issued_quantity ?? 0) > 0);
  if (anyIssued) return 'partial_issued';
  
  return 'overdue';
};

/* ======================================================
   PER-LAB ITEM BREAKDOWN
   Groups unreturned items by lab for email rendering
   Only includes items that were actually issued (issued_quantity > 0)
====================================================== */
const buildItemBreakdown = async (txn) => {
  const pendingItems = txn.items.filter(i => {
    const issued = i.issued_quantity ?? 0;  // Only count actually issued items
    const returned = i.returned_quantity ?? 0;
    return issued > 0 && issued > returned;  // Must be issued AND not fully returned
  });

  if (pendingItems.length === 0) return [];

  const labMap = {};

  for (const item of pendingItems) {
    const labId = item.lab_id?.toString();
    if (!labId) continue;

    if (!labMap[labId]) {
      const lab = await Lab.findById(labId).select('name code').lean();
      labMap[labId] = {
        lab_name: lab?.name || 'Unknown Lab',
        lab_code: lab?.code || '',
        items: []
      };
    }

    const itemDef = await Item.findById(item.item_id).select('name sku tracking_type').lean();
    const pending = (item.issued_quantity ?? item.quantity ?? 0) - (item.returned_quantity ?? 0);

    labMap[labId].items.push({
      name: itemDef?.name || 'Unknown Item',
      sku: itemDef?.sku || '',
      tracking_type: itemDef?.tracking_type || 'bulk',
      pending_quantity: pending,
      asset_tags: item.asset_ids?.length > 0 ? `${item.asset_ids.length} asset(s) pending` : null
    });
  }

  return Object.values(labMap);
};

/* ======================================================
   URGENCY LEVELS
   One entry per notification type.
   type maps 1:1 with Notification.type so we
   never send the same level twice.
====================================================== */
const URGENCY_LEVELS = [
  {
    daysLeft: 3,
    type: 'reminder_3d',
    label: 'Due in 3 Days',
    emoji: '📅',
    gradientFrom: '#2563eb', gradientTo: '#1d4ed8',
    accentBg: '#dbeafe', accentBorder: '#bfdbfe', accentText: '#1e40af',
    badgeBg: '#dbeafe', badgeText: '#1d4ed8',
    message: 'You have <strong>3 days</strong> remaining to return the following lab items. Please plan ahead to avoid late penalties.',
    actionNote: 'Return the items before the due date or contact the lab incharge to request an extension if needed.'
  },
  {
    daysLeft: 2,
    type: 'reminder_2d',
    label: 'Due in 2 Days',
    emoji: '⏳',
    gradientFrom: '#d97706', gradientTo: '#b45309',
    accentBg: '#fffbeb', accentBorder: '#fde68a', accentText: '#92400e',
    badgeBg: '#fef3c7', badgeText: '#d97706',
    message: 'Only <strong>2 days left</strong> to return the following lab items. Please make arrangements to return them on time.',
    actionNote: 'Return the items to the respective labs or request an extension from the lab incharge immediately.'
  },
  {
    daysLeft: 1,
    type: 'reminder_1d',
    label: 'Due Tomorrow',
    emoji: '🔔',
    gradientFrom: '#ea580c', gradientTo: '#c2410c',
    accentBg: '#fff7ed', accentBorder: '#fed7aa', accentText: '#9a3412',
    badgeBg: '#ffedd5', badgeText: '#ea580c',
    message: 'Your lab items are <strong>due tomorrow</strong>. This is your final reminder — please return them before the deadline.',
    actionNote: 'Return all items today or tomorrow morning. Contact the lab incharge immediately if you need more time.'
  },
  {
    daysLeft: 0,
    type: 'overdue',
    label: 'Overdue',
    emoji: '⚠️',
    gradientFrom: '#dc2626', gradientTo: '#b91c1c',
    accentBg: '#fef2f2', accentBorder: '#fecaca', accentText: '#991b1b',
    badgeBg: '#fef2f2', badgeText: '#dc2626',
    message: 'The return deadline has <strong>passed</strong>. The following items are now overdue and must be returned immediately.',
    actionNote: 'Visit each lab listed below and return the corresponding items to the lab incharge immediately. Delays may affect your future access to lab resources.'
  }
];

/* ======================================================
   EMAIL — REGULAR / LAB TRANSFER REMINDER + OVERDUE
====================================================== */
const buildReminderEmail = ({ txn, recipientName, breakdown, urgency, isLabTransfer }) => {
  const dueDate = txn.expected_return_date
    ? new Date(txn.expected_return_date).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })
    : 'N/A';

  const itemRows = breakdown.map(labGroup => `
    <tr>
      <td colspan="3" style="background:#eef2ff;padding:9px 16px;font-weight:600;font-size:12px;color:#3730a3;border-top:2px solid #c7d2fe;">
        📍 Return to: ${labGroup.lab_name} &nbsp;<span style="font-weight:400;color:#6366f1;">(${labGroup.lab_code})</span>
      </td>
    </tr>
    ${labGroup.items.map(item => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <strong>${item.name}</strong>
          <span style="color:#94a3b8;font-size:11px;margin-left:6px;font-family:monospace;">${item.sku}</span>
        </td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
          <span style="background:${urgency.badgeBg};color:${urgency.badgeText};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">
            ${item.pending_quantity} pending
          </span>
        </td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">
          ${item.asset_tags || (item.tracking_type === 'bulk' ? 'Bulk item' : '—')}
        </td>
      </tr>
    `).join('')}
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${urgency.gradientFrom} 0%,${urgency.gradientTo} 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:56px;vertical-align:middle;">
            <div style="width:52px;height:52px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:52px;font-size:26px;">${urgency.emoji}</div>
          </td>
          <td style="padding-left:16px;vertical-align:middle;">
            <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">
              ${isLabTransfer ? 'Lab Transfer' : 'Lab Items'} Reminder
            </p>
            <h1 style="margin:5px 0 0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.3px;">
              ${urgency.label}
            </h1>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 6px;color:#1e293b;font-size:15px;">Hello <strong>${recipientName || 'there'}</strong>,</p>
      <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.75;">${urgency.message}</p>

      <!-- Info Cards -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="width:50%;padding-right:8px;vertical-align:top;">
            <div style="background:${urgency.accentBg};border:1px solid ${urgency.accentBorder};border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;color:${urgency.accentText};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Transaction ID</p>
              <p style="margin:5px 0 0;font-size:15px;font-weight:800;color:#0f172a;font-family:monospace;">${txn.transaction_id}</p>
            </div>
          </td>
          <td style="width:50%;padding-left:8px;vertical-align:top;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Due Date</p>
              <p style="margin:5px 0 0;font-size:13px;font-weight:700;color:#0f172a;">${dueDate}</p>
            </div>
          </td>
        </tr>
      </table>

      <!-- Pending Items -->
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;">📦 Items Pending Return</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Item</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || `<tr><td colspan="3" style="padding:18px;text-align:center;color:#94a3b8;font-size:13px;">No pending items found</td></tr>`}
        </tbody>
      </table>

      <!-- Action Box -->
      <div style="margin-top:20px;background:${urgency.accentBg};border:1px solid ${urgency.accentBorder};border-radius:10px;padding:16px 18px;">
        <p style="margin:0;font-size:13px;color:${urgency.accentText};line-height:1.7;">
          <strong>📌 What to do:</strong> ${urgency.actionNote}
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Automated reminder · Lab Management System · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/* ======================================================
   EMAIL — LAB SESSION OVERDUE
====================================================== */
const buildLabSessionOverdueEmail = ({ txn, breakdown }) => {
  const issuedAt = txn.issued_at
    ? new Date(txn.issued_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'N/A';

  const itemRows = breakdown.flatMap(labGroup =>
    labGroup.items.map(item => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${item.name}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-family:monospace;">${item.sku}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
          <span style="background:#fef2f2;color:#dc2626;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">
            ${item.pending_quantity} pending
          </span>
        </td>
      </tr>
    `)
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto 48px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <div style="background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);padding:36px 36px 28px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="width:56px;vertical-align:middle;">
          <div style="width:52px;height:52px;background:rgba(255,255,255,0.18);border-radius:14px;text-align:center;line-height:52px;font-size:26px;">🔬</div>
        </td>
        <td style="padding-left:16px;vertical-align:middle;">
          <p style="margin:0;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">Lab Session Alert</p>
          <h1 style="margin:5px 0 0;color:#fff;font-size:24px;font-weight:800;">2-Hour Limit Exceeded</h1>
        </td>
      </tr></table>
    </div>

    <div style="padding:32px 36px 24px;">
      <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.75;">
        Lab session <strong style="font-family:monospace;color:#0f172a;">${txn.transaction_id}</strong> has exceeded the 2-hour borrowing limit.
        The items below must be returned to the lab immediately.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="width:33%;padding-right:8px;vertical-align:top;">
            <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;color:#7c3aed;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Transaction ID</p>
              <p style="margin:5px 0 0;font-size:13px;font-weight:800;color:#0f172a;font-family:monospace;word-break:break-all;">${txn.transaction_id}</p>
            </div>
          </td>
          <td style="width:33%;padding:0 4px;vertical-align:top;">
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;color:#ea580c;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Issued At</p>
              <p style="margin:5px 0 0;font-size:12px;font-weight:700;color:#0f172a;">${issuedAt}</p>
            </div>
          </td>
          <td style="width:33%;padding-left:8px;vertical-align:top;">
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Lab Slot</p>
              <p style="margin:5px 0 0;font-size:13px;font-weight:700;color:#0f172a;">${txn.lab_slot || '—'}</p>
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0f172a;">📦 Items to Return</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Item</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">SKU</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || `<tr><td colspan="3" style="padding:18px;text-align:center;color:#94a3b8;">No item details</td></tr>`}
        </tbody>
      </table>

      <div style="margin-top:20px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px;">
        <p style="margin:0;font-size:13px;color:#6d28d9;line-height:1.7;">
          <strong>📌 Action Required:</strong> Please return all borrowed items to the lab incharge immediately.
          Continued delays may affect future borrowing privileges.
        </p>
      </div>
    </div>

    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Automated reminder · Lab Management System · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
};

/* ======================================================
   SEND REMINDER TO STUDENT + FACULTY (BOTH GET EMAILS)
====================================================== */
const sendReminderToParties = async ({ txn, studentName, studentEmail, breakdown, urgency, isLabTransfer }) => {
  // Send to student with student-focused email
  if (studentEmail) {
    const studentSubject = `${urgency.emoji} ${urgency.label} – Lab Items (${txn.transaction_id})`;
    const studentHtml = buildReminderEmail({ txn, recipientName: studentName, breakdown, urgency, isLabTransfer });
    await sendMail({ to: studentEmail, subject: studentSubject, html: studentHtml });
    await saveNotification({ to: studentEmail, txnId: txn.transaction_id, type: urgency.type });
  }

  // Also notify faculty (NO Faculty schema - faculty might not have account)
  // Faculty receives similar email with context about their student
  if (txn.faculty_email && txn.faculty_email !== studentEmail) {
    const facultySubject = `${urgency.emoji} ${urgency.label} – Student Project Alert (${txn.transaction_id})`;
    // Faculty gets same template but addressed generically
    const facultyHtml = buildReminderEmail({ 
      txn, 
      recipientName: `Faculty (Student: ${studentName})`, 
      breakdown, 
      urgency, 
      isLabTransfer 
    });
    await sendMail({ to: txn.faculty_email, subject: facultySubject, html: facultyHtml });
    // Note: We don't save notification for faculty to avoid unique constraint issues
  }
};

/* ======================================================
   1️⃣ REGULAR + LAB TRANSFER DAILY JOB (9AM every day)
   Sends: D-3, D-2, D-1 reminders + overdue notification
   Each level fires ONCE per transaction (stored in Notification)
====================================================== */
const startDailyOverdueJob = () => {
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running DAILY reminder + overdue check');
    const now = new Date();
    // Set to start of today for clean day comparison
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const transactions = await Transaction.find({
      transaction_type: { $in: ['regular', 'lab_transfer'] },
      status: { $in: ['approved', 'active', 'partial_returned', 'partial_issued'] }
    });

    for (const txn of transactions) {
      if (!txn.expected_return_date) continue;

      const dueStart = new Date(txn.expected_return_date);
      dueStart.setHours(0, 0, 0, 0);

      // Days between today and due date (negative = overdue)
      const daysLeft = Math.round((dueStart - todayStart) / (1000 * 60 * 60 * 24));

      // Only handle D-3, D-2, D-1 and overdue (daysLeft <= 0)
      if (daysLeft > 3) continue;

      // Find matching urgency level
      let urgency;
      if (daysLeft <= 0) {
        urgency = URGENCY_LEVELS.find(u => u.daysLeft === 0);
      } else {
        urgency = URGENCY_LEVELS.find(u => u.daysLeft === daysLeft);
      }
      if (!urgency) continue;

      // Skip if this urgency level already sent for this transaction
      if (await alreadyNotified(txn.transaction_id, urgency.type)) continue;

      // Skip if all ISSUED items already returned (or nothing was issued)
      const anyIssued = txn.items.some(i => (i.issued_quantity ?? 0) > 0);
      if (!anyIssued) continue;  // Nothing issued yet, skip notification
      
      const allIssuedReturned = txn.items
        .filter(i => (i.issued_quantity ?? 0) > 0)  // Only consider issued items
        .every(i => (i.returned_quantity ?? 0) >= (i.issued_quantity ?? 0));
      if (allIssuedReturned) continue;

      const breakdown = await buildItemBreakdown(txn);
      if (breakdown.length === 0) continue;

      // Update status to overdue if applicable
      if (urgency.type === 'overdue') {
        const newStatus = resolveOverdueStatus(txn);
        if (txn.status !== newStatus) {
          txn.status = newStatus;
          await txn.save();
        }
      }

      /* ── Student transaction ── */
      if (txn.student_id) {
        const student = await Student.findById(txn.student_id).select('name email').lean();
        if (!student) continue;

        await sendReminderToParties({
          txn,
          studentName: student.name,
          studentEmail: student.email,
          breakdown,
          urgency,
          isLabTransfer: false
        });
      }

      /* ── Lab transfer ── */
      else if (txn.transaction_type === 'lab_transfer') {
        // Find incharge of the target lab (the lab that needs to return items)
        const targetLabId = txn.target_lab_id;
        if (!targetLabId) continue;

        const incharge = await Staff.findOne({ lab_id: targetLabId, role: 'incharge', is_active: true }).select('name email').lean();
        if (!incharge) continue;

        const subject = `${urgency.emoji} ${urgency.label} – Lab Transfer (${txn.transaction_id})`;
        const html = buildReminderEmail({
          txn,
          recipientName: incharge.name,
          breakdown,
          urgency,
          isLabTransfer: true
        });

        await sendMail({ to: incharge.email, subject, html });
        await saveNotification({ to: incharge.email, txnId: txn.transaction_id, type: urgency.type });
      }
    }

    console.log('✅ DAILY check complete');
  });
};

/* ======================================================
   2️⃣ LAB SESSION OVERDUE — TWICE DAILY (9AM + 3PM)
   No pre-due reminders for lab sessions (2hr rule).
   Only fires once past expected_return_date.
====================================================== */
const startLabSessionOverdueJob = () => {
  cron.schedule('0 9,15 * * *', async () => {
    console.log('⏰ Running lab-session overdue check');
    const now = new Date();

    const labSessions = await Transaction.find({
      transaction_type: 'lab_session',
      status: { $in: ['active', 'partial_returned', 'partial_issued'] }
    });

    for (const txn of labSessions) {
      if (!txn.expected_return_date) continue;
      // Still within the 2-hour window
      if (new Date(txn.expected_return_date) > now) continue;

      // Skip if all ISSUED items already returned (or nothing was issued)
      const anyIssued = txn.items.some(i => (i.issued_quantity ?? 0) > 0);
      if (!anyIssued) continue;  // Nothing issued yet, skip notification
      
      const allIssuedReturned = txn.items
        .filter(i => (i.issued_quantity ?? 0) > 0)  // Only consider issued items
        .every(i => (i.returned_quantity ?? 0) >= (i.issued_quantity ?? 0));
      if (allIssuedReturned) continue;

      // Already sent overdue for this session
      if (await alreadyNotified(txn.transaction_id, 'overdue')) continue;

      // Resolve and save status
      const newStatus = resolveOverdueStatus(txn);
      if (txn.status !== newStatus) {
        txn.status = newStatus;
        await txn.save();
      }

      const breakdown = await buildItemBreakdown(txn);
      if (breakdown.length === 0) continue;

      const recipient = txn.faculty_email;
      if (!recipient) continue;

      const html = buildLabSessionOverdueEmail({ txn, breakdown });
      await sendMail({ to: recipient, subject: `⏰ Lab Session Overdue – ${txn.transaction_id}`, html });
      await saveNotification({ to: recipient, txnId: txn.transaction_id, type: 'overdue' });
    }

    console.log('✅ Lab-session overdue check complete');
  });
};

/* ======================================================
   START ALL JOBS
====================================================== */
const startOverdueJobs = () => {
  startDailyOverdueJob();
  startLabSessionOverdueJob();
};

module.exports = startOverdueJobs;