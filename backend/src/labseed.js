require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Lab = require('./models/Lab');
const Staff = require('./models/Staff');

const MONGO_URI = process.env.MONGO_URI;

const seed = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');

    /* ===============================
       CREATE LABS
    =============================== */

    const labsData = [
      { name: 'IoT Lab', code: 'IOT-01', location: 'Block A - Floor 2' },
      { name: 'ECE Lab', code: 'ECE-02', location: 'Block B - Floor 1' },
      { name: 'Robotics Lab', code: 'ROB-03', location: 'Block C - Floor 3' }
    ];

    const labs = [];

    for (const lab of labsData) {
      let existing = await Lab.findOne({ code: lab.code });

      if (!existing) {
        existing = await Lab.create(lab);
        console.log(`✅ Lab created: ${lab.name}`);
      } else {
        console.log(`⚠️ Lab already exists: ${lab.name}`);
      }

      labs.push(existing);
    }

    /* ===============================
       CREATE SUPER ADMIN
    =============================== */

    const superAdminEmail = 'superadmin@vit.ac.in';

    const existingSuper = await Staff.findOne({ email: superAdminEmail });

    if (!existingSuper) {
      const hashed = await bcrypt.hash('Super@123', 10);

      await Staff.create({
        name: 'Super Admin',
        email: superAdminEmail,
        password: hashed,
        role: 'super_admin',
        lab_id: null
      });

      console.log('✅ Super Admin created');
    } else {
      console.log('⚠️ Super Admin already exists');
    }

    /* ===============================
       CREATE LAB INCHARGES + ASSISTANTS
    =============================== */

    for (const lab of labs) {

      // Incharge
      const inchargeEmail = `incharge.${lab.code.toLowerCase()}@vit.ac.in`;

      const existingIncharge = await Staff.findOne({ email: inchargeEmail });

      if (!existingIncharge) {
        const hashed = await bcrypt.hash('Incharge@123', 10);

        await Staff.create({
          name: `${lab.name} Incharge`,
          email: inchargeEmail,
          password: hashed,
          role: 'incharge',
          lab_id: lab._id
        });

        console.log(`✅ Incharge created for ${lab.name}`);
      }

      // Assistant
      const assistantEmail = `assistant.${lab.code.toLowerCase()}@vit.ac.in`;

      const existingAssistant = await Staff.findOne({ email: assistantEmail });

      if (!existingAssistant) {
        const hashed = await bcrypt.hash('Assistant@123', 10);

        await Staff.create({
          name: `${lab.name} Assistant`,
          email: assistantEmail,
          password: hashed,
          role: 'assistant',
          lab_id: lab._id
        });

        console.log(`✅ Assistant created for ${lab.name}`);
      }
    }

    console.log('\n🎉 Seeding completed successfully\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
};

seed();
