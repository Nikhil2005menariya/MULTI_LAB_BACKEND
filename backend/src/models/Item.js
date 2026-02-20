const mongoose = require('mongoose');

const purchaseBatchSchema = new mongoose.Schema(
  {
    vendor: { type: String, required: true },
    quantity_added: { type: Number, required: true },
    purchase_date: { type: Date, default: Date.now },
    invoice_number: String
  },
  { _id: false }
);

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
    description: String,

    /* =========================
       STUDENT VISIBILITY
    ========================= */
    is_student_visible: {
      type: Boolean,
      default: true,
      index: true
    },

    /* =========================
       INVENTORY COUNTS (GLOBAL TOTAL)
    ========================= */
    total_quantity: {
      type: Number,
      default: 0
    },

    available_quantity: {
      type: Number,
      default: 0
    },

    temp_reserved_quantity: {
      type: Number,
      default: 0
    },

    damaged_quantity: {
      type: Number,
      default: 0
    },

    purchase_batches: [purchaseBatchSchema],

    tracking_type: {
      type: String,
      enum: ['bulk', 'asset'],
      required: true,
      default: 'bulk'
    },

    is_active: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

/* =========================
   STUDENT VISIBLE QUANTITY
========================= */
itemSchema.virtual('student_visible_quantity').get(function () {
  return this.available_quantity - this.temp_reserved_quantity;
});

itemSchema.set('toJSON', { virtuals: true });
itemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Item', itemSchema);