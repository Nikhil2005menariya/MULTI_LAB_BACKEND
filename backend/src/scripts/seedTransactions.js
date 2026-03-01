require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Transaction = require('../models/Transaction');
const LabInventory = require('../models/LabInventory');
const Student = require('../models/Student');

const seedTransactions = async () => {
  try {
    await connectDB();
    console.log('Seeding transactions...');

    // Clear previous test transactions (optional)
    await Transaction.deleteMany({});

    const student = await Student.findOne();
    if (!student) throw new Error('No student found');

    const inventories = await LabInventory.find();
    if (inventories.length === 0)
      throw new Error('No lab inventory found');

    const statuses = ['approved', 'active', 'completed'];

    for (let i = 0; i < 30; i++) {
      const inv = inventories[i % inventories.length];

      const quantity = Math.min(
        2,
        Math.max(1, Math.floor(Math.random() * 3))
      );

      const status = statuses[i % statuses.length];

      const transaction = new Transaction({
        transaction_id: `TXN-${Date.now()}-${i}`,
        project_name: `Project ${i + 1}`,
        transaction_type: 'regular',

        status,
        student_id: student._id,
        student_reg_no: student.reg_no,

        items: [
          {
            lab_id: inv.lab_id,      // ✅ CORRECT LAB FIELD
            item_id: inv.item_id,
            quantity,
            issued_quantity:
              status === 'active' || status === 'completed'
                ? quantity
                : 0,
            returned_quantity:
              status === 'completed' ? quantity : 0,
            damaged_quantity: 0
          }
        ],

        issued_at:
          status === 'active' || status === 'completed'
            ? new Date()
            : null,

        actual_return_date:
          status === 'completed'
            ? new Date()
            : null
      });

      await transaction.save();

      // Adjust lab inventory only if issued
      if (status === 'active' || status === 'completed') {
        inv.available_quantity = Math.max(
          0,
          inv.available_quantity - quantity
        );
        await inv.save();
      }
    }

    console.log('Transactions seeded correctly');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedTransactions();