const mongoose = require('mongoose');

const labInventorySchema = new mongoose.Schema(
  {
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true,
      index: true
    },

    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true
    },

    total_quantity: {
      type: Number,
      required: true
    },

    available_quantity: {
      type: Number,
      required: true
    },

    reserved_quantity: {
      type: Number,
      default: 0
    },

    damaged_quantity: {
      type: Number,
      default: 0
    },

    temp_reserved_quantity: {
      type: Number,
      default: 0,
      min: 0
    },

    is_student_visible: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  { timestamps: true }
);

/* ============================
   INDEXES
============================ */

// Unique per lab-item
labInventorySchema.index({ lab_id: 1, item_id: 1 }, { unique: true });

// 🔥 Student query optimization
labInventorySchema.index({ is_student_visible: 1, item_id: 1 });

module.exports = mongoose.model('LabInventory', labInventorySchema);