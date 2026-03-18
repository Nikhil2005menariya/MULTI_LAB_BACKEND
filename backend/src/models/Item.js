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
    name: {
      type: String,
      required: true,
      index: true // 🔥 search by name
    },

    sku: {
      type: String,
      required: true,
      unique: true,
      index: true // 🔥 already correct
    },

    category: {
      type: String,
      index: true // 🔥 filter/search
    },

    description: String,

    /* =========================
       INVENTORY COUNTS
    ========================= */
    total_quantity: { type: Number, default: 0 },
    available_quantity: { type: Number, default: 0 },
    temp_reserved_quantity: { type: Number, default: 0 },
    damaged_quantity: { type: Number, default: 0 },

    purchase_batches: [purchaseBatchSchema],

    tracking_type: {
      type: String,
      enum: ['bulk', 'asset'],
      required: true,
      default: 'bulk',
      index: true // 🔥 useful for filtering
    },

    is_active: {
      type: Boolean,
      default: true,
      index: true // 🔥 VERY IMPORTANT (used everywhere)
    }
  },
  { timestamps: true }
);

/* =========================
   COMPOUND INDEXES (IMPORTANT)
========================= */

// 🔥 For search + filtering
itemSchema.index({ name: 1, category: 1 });

// 🔥 For active item queries (VERY FREQUENT)
itemSchema.index({ is_active: 1, name: 1 });

// 🔥 Optional: sorting optimization
itemSchema.index({ createdAt: -1 });

/* =========================
   VIRTUALS
========================= */
itemSchema.virtual('student_visible_quantity').get(function () {
  return this.available_quantity - this.temp_reserved_quantity;
});

itemSchema.set('toJSON', { virtuals: true });
itemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Item', itemSchema);