const bcrypt = require('bcryptjs');
const connect = require('./seedSetup');
const Student = require('../models/Student');

const seedStudent = async () => {
  await connect();

  const exists = await Student.findOne({ reg_no: '23BCE1162' });
  if (exists) {
    console.log('Student already exists');
    process.exit();
  }

  await Student.create({
    name: 'Nikhil Menariya',
    reg_no: '23BCE1162',
    email: 'nikhilmenariya78@gmail.com',
    password: await bcrypt.hash('Student@123', 10),
    is_verified: true
  });

  console.log('Student seeded');
  process.exit();
};

seedStudent();
