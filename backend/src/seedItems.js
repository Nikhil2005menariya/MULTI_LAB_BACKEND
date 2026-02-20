require('dotenv').config();
const mongoose = require('mongoose');

const Lab = require('./models/Lab');
const Item = require('./models/Item');
const LabInventory = require('./models/LabInventory');
const ItemAsset = require('./models/ItemAsset');

const MONGO_URI = process.env.MONGO_URI;

const seedInventory = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');

    const labs = await Lab.find();
    if (labs.length === 0) {
      throw new Error('No labs found. Run lab seed first.');
    }

    /* =====================================
       1️⃣ CREATE GLOBAL ITEMS
    ===================================== */

    const itemsData = [
      {
        name: 'Arduino Uno',
        sku: 'ARD-UNO-001',
        category: 'Microcontroller',
        tracking_type: 'bulk'
      },
      {
        name: 'Raspberry Pi 4',
        sku: 'RPI-4-002',
        category: 'Single Board Computer',
        tracking_type: 'bulk'
      },
      {
        name: 'Digital Oscilloscope',
        sku: 'OSC-DSO-003',
        category: 'Measurement Equipment',
        tracking_type: 'asset'
      }
    ];

    const createdItems = [];

    for (const data of itemsData) {
      let item = await Item.findOne({ sku: data.sku });

      if (!item) {
        item = await Item.create({
          ...data,
          total_quantity: 0,
          available_quantity: 0,
          temp_reserved_quantity: 0,
          damaged_quantity: 0
        });
        console.log(`✅ Created Item: ${data.name}`);
      } else {
        console.log(`⚠️ Item already exists: ${data.name}`);
      }

      createdItems.push(item);
    }

    /* =====================================
       2️⃣ DISTRIBUTE STOCK PER LAB
    ===================================== */

    for (const lab of labs) {
      for (const item of createdItems) {

        let quantity = 0;

        if (item.tracking_type === 'bulk') {
          quantity = 10; // 10 per lab for bulk
        } else {
          quantity = 2; // 2 assets per lab
        }

        let labInv = await LabInventory.findOne({
          lab_id: lab._id,
          item_id: item._id
        });

        if (!labInv) {
          await LabInventory.create({
            lab_id: lab._id,
            item_id: item._id,
            total_quantity: quantity,
            available_quantity: quantity,
            reserved_quantity: 0,
            damaged_quantity: 0
          });

          console.log(`✅ Stock added: ${item.name} → ${lab.name}`);
        }

        // Update global totals
        await Item.updateOne(
          { _id: item._id },
          {
            $inc: {
              total_quantity: quantity,
              available_quantity: quantity
            }
          }
        );

        /* =====================================
           3️⃣ CREATE ASSETS (ONLY FOR ASSET ITEMS)
        ===================================== */
        if (item.tracking_type === 'asset') {

          for (let i = 1; i <= quantity; i++) {

            const assetTag = `${item.sku}-${lab.code}-${i}`;

            const existingAsset = await ItemAsset.findOne({ asset_tag: assetTag });

            if (!existingAsset) {
              await ItemAsset.create({
                lab_id: lab._id,
                item_id: item._id,
                asset_tag: assetTag,
                vendor: 'Tektronix',
                status: 'available',
                condition: 'good',
                location: lab.name
              });
            }
          }

          console.log(`✅ Assets created for ${item.name} in ${lab.name}`);
        }
      }
    }

    console.log('\n🎉 Inventory Seeding Completed\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ Inventory seed failed:', err);
    process.exit(1);
  }
};

seedInventory();