const cron = require('node-cron');
const Transaction = require('../models/Transaction');
const Student = require('../models/Student');
const Notification = require('../models/Notification');
const { sendMail } = require('../services/mail.service');

/* ======================================================
   HELPERS
====================================================== */
const alreadyNotified = async (txn) => {
  return Notification.findOne({
    transaction_id: txn.transaction_id,
    type: 'overdue'
  });
};

const markOverdue = async (txn) => {
  if (txn.status !== 'overdue') {
    txn.status = 'overdue';
    await txn.save();
  }
};

const notify = async ({ to, subject, html, txn }) => {
  await sendMail({ to, subject, html });

  await Notification.create({
    type: 'overdue',
    recipient_email: to,
    transaction_id: txn.transaction_id
  });
};

/* ======================================================
   1️⃣ REGULAR + LAB TRANSFER OVERDUE (DAILY)
====================================================== */
const startDailyOverdueJob = () => {
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running DAILY overdue check');

    const now = new Date();

    const transactions = await Transaction.find({
      status: { $in: ['approved', 'active'] },
      expected_return_date: { $lt: now },
      faculty_email: { $ne: 'lab-session' } // exclude lab sessions
    });

    for (const txn of transactions) {
      if (await alreadyNotified(txn)) continue;

      await markOverdue(txn);

      const subject = `Overdue Lab Components – ${txn.transaction_id}`;
      const message = `
        <p>Transaction <b>${txn.transaction_id}</b> is overdue.</p>
        <p>Expected return: ${txn.expected_return_date.toDateString()}</p>
      `;

      /* ===== STUDENT TRANSACTION ===== */
      if (txn.student_id) {
        const student = await Student.findById(txn.student_id);
        if (!student) continue;

        await notify({
          to: student.email,
          subject,
          html: message,
          txn
        });

        if (txn.faculty_email) {
          await notify({
            to: txn.faculty_email,
            subject,
            html: message,
            txn
          });
        }
      }

      /* ===== LAB TRANSFER ===== */
      else if (txn.student_reg_no === 'LAB-TRANSFER') {
        await notify({
          to: txn.faculty_email,
          subject,
          html: `
            <p>Lab transfer <b>${txn.transaction_id}</b> is overdue.</p>
            <p>Target lab: ${txn.lab_slot}</p>
            <p>Expected return: ${txn.expected_return_date.toDateString()}</p>
          `,
          txn
        });
      }
    }
  });
};

/* ======================================================
   2️⃣ LAB SESSION OVERDUE (HOURLY, 2 HOURS RULE)
====================================================== */
const startLabSessionOverdueJob = () => {
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Running HOURLY lab-session overdue check');

    const now = new Date();

    const labSessions = await Transaction.find({
      status: 'active',
      faculty_email: 'lab-session'
    });

    for (const txn of labSessions) {
      const issuedAt = new Date(txn.issued_at);
      const expiry = new Date(issuedAt.getTime() + 2 * 60 * 60 * 1000);

      if (expiry > now) continue;
      if (await alreadyNotified(txn)) continue;

      await markOverdue(txn);

      const subject = `Lab Session Overdue – ${txn.transaction_id}`;
      const message = `
        <p>Lab session transaction <b>${txn.transaction_id}</b> has exceeded 2 hours.</p>
        <p>Issued at: ${issuedAt.toLocaleString()}</p>
        <p>Please return components immediately.</p>
      `;

      await notify({
        to: txn.faculty_email || 'lab@system.local',
        subject,
        html: message,
        txn
      });
    }
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
