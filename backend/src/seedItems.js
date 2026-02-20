require('dotenv').config();
const mongoose = require('mongoose');

const Lab = require('./models/Lab');
const Item = require('./models/Item');
const ItemAsset = require('./models/ItemAsset');
const LabInventory = require('./models/LabInventory');

const MONGO_URI = process.env.MONGO_URI;

const seed = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');

    const labs = await Lab.find();

    const [iotLab, eceLab, roboticsLab] = labs;

    /* =====================================
       HELPER: CREATE GLOBAL ITEM
    ===================================== */
    const createItemIfNotExists = async ({ name, sku, category, tracking_type }) => {
      let item = await Item.findOne({ sku });

      if (!item) {
        item = await Item.create({
          name,
          sku,
          category,
          tracking_type,
          initial_quantity: 0,
          available_quantity: 0,
          total_quantity: 0
        });

        console.log(`✅ Global Item Created: ${name}`);
      }

      return item;
    };

    /* =====================================
       HELPER: ADD BULK STOCK TO LAB
    ===================================== */
    const addBulkStockToLab = async ({
      lab,
      item,
      quantity,
      vendor
    }) => {

      let inventory = await LabInventory.findOne({
        lab_id: lab._id,
        item_id: item._id
      });

      if (!inventory) {
        inventory = await LabInventory.create({
          lab_id: lab._id,
          item_id: item._id,
          total_quantity: quantity,
          available_quantity: quantity
        });
      } else {
        inventory.total_quantity += quantity;
        inventory.available_quantity += quantity;
        await inventory.save();
      }

      // Update global counts
      item.total_quantity += quantity;
      item.available_quantity += quantity;

      item.purchase_batches.push({
        vendor,
        quantity_added: quantity,
        invoice_number: `INV-${Math.floor(Math.random() * 10000)}`
      });

      await item.save();

      console.log(`   ↳ ${quantity} units added to ${lab.name}`);
    };

    /* =====================================
       HELPER: ADD ASSET STOCK
    ===================================== */
    const addAssetStockToLab = async ({
      lab,
      item,
      count,
      vendor
    }) => {

      let inventory = await LabInventory.findOne({
        lab_id: lab._id,
        item_id: item._id
      });

      if (!inventory) {
        inventory = await LabInventory.create({
          lab_id: lab._id,
          item_id: item._id,
          total_quantity: count,
          available_quantity: count
        });
      } else {
        inventory.total_quantity += count;
        inventory.available_quantity += count;
        await inventory.save();
      }

      for (let i = 0; i < count; i++) {
        const assetTag = `${item.sku}-${lab.code}-${String(i + 1).padStart(4, '0')}`;

        const exists = await ItemAsset.findOne({ asset_tag: assetTag });
        if (!exists) {
          await ItemAsset.create({
            item_id: item._id,
            asset_tag: assetTag,
            vendor,
            serial_no: `SN-${Math.floor(Math.random()*100000)}`,
            location: lab.name
          });
        }
      }

      item.total_quantity += count;
      item.available_quantity += count;

      await item.save();

      console.log(`   ↳ ${count} asset units added to ${lab.name}`);
    };

    /* =====================================
       SEED DATA
    ===================================== */

    // Global items
    const arduino = await createItemIfNotExists({
      name: 'Arduino Uno',
      sku: 'ARD-UNO',
      category: 'Microcontroller',
      tracking_type: 'bulk'
    });

    const rpi = await createItemIfNotExists({
      name: 'Raspberry Pi 4',
      sku: 'RPI-4',
      category: 'Microprocessor',
      tracking_type: 'asset'
    });

    const oscilloscope = await createItemIfNotExists({
      name: 'Digital Oscilloscope',
      sku: 'OSC-100',
      category: 'Measurement',
      tracking_type: 'asset'
    });

    /* ===== IoT Lab ===== */

    await addBulkStockToLab({
      lab: iotLab,
      item: arduino,
      quantity: 50,
      vendor: 'Robu.in'
    });

    await addAssetStockToLab({
      lab: iotLab,
      item: rpi,
      count: 10,
      vendor: 'Amazon India'
    });

    /* ===== ECE Lab ===== */

    await addBulkStockToLab({
      lab: eceLab,
      item: arduino,
      quantity: 30,
      vendor: 'Thingbits'
    });

    await addAssetStockToLab({
      lab: eceLab,
      item: oscilloscope,
      count: 5,
      vendor: 'Tektronix'
    });

    /* ===== Robotics Lab ===== */

    await addBulkStockToLab({
      lab: roboticsLab,
      item: arduino,
      quantity: 20,
      vendor: 'Amazon India'
    });

    console.log('\n🎉 Inventory seeding completed successfully\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
};

seed();