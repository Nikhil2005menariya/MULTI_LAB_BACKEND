const bcrypt = require('bcryptjs');
const connect = require('./seedSetup');
const Staff = require('../models/Staff');

const seedIncharge = async () => {
  await connect();

  const exists = await Staff.findOne({ role: 'incharge' });
  if (exists) {
    console.log('In-charge already exists');
    process.exit();
  }

  await Staff.create({
    name: 'Lab Incharge',
    email: 'incharge@iotlab.com',
    password: await bcrypt.hash('Incharge@123', 10),
    role: 'incharge',
    is_active: true
  });

  console.log('In-charge seeded');
  process.exit();
};

seedIncharge();
