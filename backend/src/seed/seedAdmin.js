const bcrypt = require('bcryptjs');
const connect = require('./seedSetup');
const Staff = require('../models/Staff');

const seedAdmin = async () => {
  await connect();

  const exists = await Staff.findOne({ role: 'admin' });
  if (exists) {
    console.log('Admin already exists');
    process.exit();
  }

  await Staff.create({
    name: 'System Admin',
    email: 'admin@iotlab.com',
    password: await bcrypt.hash('Admin@123', 10),
    role: 'admin',
    is_active: true
  });

  console.log('Admin seeded');
  process.exit();
};

seedAdmin();
