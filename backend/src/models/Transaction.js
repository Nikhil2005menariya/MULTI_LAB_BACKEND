const mongoose = require('mongoose');

/* ============================
   TRANSACTION ITEM
============================ */
const transactionItemSchema = new mongoose.Schema(
  {
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true
    },

    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },

    quantity: {
      type: Number,
      default: 0,
      min: 0
    },

    asset_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ItemAsset'
      }
    ],

    issued_quantity: { type: Number, default: 0, min: 0 },
    returned_quantity: { type: Number, default: 0, min: 0 },
    damaged_quantity: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

/* ============================
   TRANSACTION SCHEMA
============================ */
const transactionSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, required: true, unique: true, index: true },
    project_name: { type: String, required: true, trim: true, index: true },

    transaction_type: {
      type: String,
      enum: ['regular', 'lab_session', 'lab_transfer'],
      default: 'regular',
      index: true
    },

    transfer_type: {
      type: String,
      enum: ['temporary', 'permanent'],
      default: null
    },

    source_lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      index: true
    },

    source_lab_name_snapshot: String,

    target_lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      index: true
    },

    target_lab_name_snapshot: String,

    handover_faculty_name: String,
    handover_faculty_email: String,
    handover_faculty_id: String,

    issued_directly: { type: Boolean, default: false },
    lab_slot: String,

    status: {
      type: String,
      enum: [
        'raised','approved','active','return_requested','completed',
        'overdue','rejected','partial_returned','partial_issued'
      ],
      default: 'raised',
      index: true
    },

    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      index: true
    },

    student_reg_no: { type: String, required: true, index: true },

    faculty_email: { type: String, index: true },
    faculty_id: { type: String, index: true },

    items: [transactionItemSchema],

    faculty_approval: {
      approved: { type: Boolean, default: false },
      approved_at: Date,
      approval_token: String,
      rejected_reason: String
    },

    issued_by_incharge_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      index: true
    },

    issued_at: Date,

    expected_return_date: {
      type: Date,
      required: function () {
        return this.transaction_type === 'lab_transfer' &&
               this.transfer_type === 'temporary';
      },
      index: true
    },

    actual_return_date: Date,
    damage_notes: String,

    overdue_notified: { type: Boolean, default: false }
  },
  { timestamps: true }
);

/* ============================
   INDEXES (ONLY HERE)
============================ */

// Core
transactionSchema.index({ "items.lab_id": 1 });
transactionSchema.index({ "items.item_id": 1 });
transactionSchema.index({ "items.asset_ids": 1 });

// Pagination / sorting
transactionSchema.index({ createdAt: -1 });

// Sessions
transactionSchema.index({
  transaction_type: 1,
  "items.lab_id": 1,
  createdAt: -1
});

// Transfers
transactionSchema.index({
  transaction_type: 1,
  "items.lab_id": 1,
  target_lab_id: 1,
  createdAt: -1
});

// Search
transactionSchema.index({
  transaction_id: 1,
  student_reg_no: 1,
  faculty_email: 1,
  status: 1
});

module.exports = mongoose.model('Transaction', transactionSchema);