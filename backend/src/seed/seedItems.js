const connect = require('./seedSetup');
const Item = require('../models/Item');

const items = [
  {
    name: 'Arduino Uno',
    sku: 'ARD-UNO',
    category: 'Microcontroller',
    vendor: 'Arduino',
    location: 'Rack A',
    initial_quantity: 20,
    available_quantity: 20,
    reserved_quantity: 2,
    min_threshold_quantity: 5,
    description: 'Arduino Uno R3 board'
  },
  {
    name: 'Ultrasonic Sensor',
    sku: 'SEN-HC04',
    category: 'Sensor',
    vendor: 'Generic',
    location: 'Rack B',
    initial_quantity: 50,
    available_quantity: 50,
    reserved_quantity: 5,
    min_threshold_quantity: 10,
    description: 'HC-SR04 ultrasonic sensor'
  },
  {
    name: 'Raspberry Pi 4',
    sku: 'RPI-4',
    category: 'Microcontroller',
    vendor: 'Raspberry',
    location: 'Rack C',
    initial_quantity: 10,
    available_quantity: 10,
    reserved_quantity: 1,
    min_threshold_quantity: 3,
    description: 'Raspberry Pi 4 Model B'
  }
];

const seedItems = async () => {
  await connect();

  for (const item of items) {
    const exists = await Item.findOne({ sku: item.sku });
    if (!exists) {
      await Item.create(item);
    }
  }

  console.log('Items seeded');
  process.exit();
};

seedItems();
