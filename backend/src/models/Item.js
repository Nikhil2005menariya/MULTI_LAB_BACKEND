const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    sku: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    category: String,
    vendor: String,
    location: String,
    description: String,

    /* =========================
       LAB SUPPORT
    ========================= */
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true,
      index: true
    },

    /* =========================
       STUDENT VISIBILITY
    ========================= */
    is_student_visible: {
      type: Boolean,
      default: true,
      index: true
    },

    /* =========================
       INVENTORY COUNTS
    ========================= */

    initial_quantity: {
      type: Number,
      required: true
    },

    // REAL STOCK (only changes on issue/return)
    available_quantity: {
      type: Number,
      required: true
    },

    // 🔥 NEW — Temporary reservation
    temp_reserved_quantity: {
      type: Number,
      default: 0
    },

    damaged_quantity: {
      type: Number,
      default: 0
    },

    total_quantity: {
      type: Number,
      default: function () {
        return this.initial_quantity;
      }
    },

    last_asset_seq: {
      type: Number,
      default: 0
    },

    min_threshold_quantity: {
      type: Number,
      default: 5
    },

    is_active: {
      type: Boolean,
      default: true
    },

    tracking_type: {
      type: String,
      enum: ['bulk', 'asset'],
      required: true,
      default: 'bulk'
    }
  },
  { timestamps: true }
);

/* =========================
   VIRTUAL FIELD
========================= */

// 🔥 What students actually see
itemSchema.virtual('student_visible_quantity').get(function () {
  return this.available_quantity - this.temp_reserved_quantity;
});

itemSchema.set('toJSON', { virtuals: true });
itemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Item', itemSchema);
