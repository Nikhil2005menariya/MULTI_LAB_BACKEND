const mongoose = require('mongoose');

/* ============================
   TRANSACTION ITEM (CROSS-LAB SAFE)
============================ */
const transactionItemSchema = new mongoose.Schema(
  {
    /* 🔥 REQUIRED — LAB BINDING PER ITEM */
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true,
      index: true
    },

    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },

    /* =====================
       BULK TRACKING
    ===================== */
    quantity: {
      type: Number,
      default: 0,
      min: 0
    },

    /* =====================
       ASSET TRACKING (STRICT RELATIONAL)
    ===================== */
    asset_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ItemAsset'
      }
    ],

    /* =====================
       SYSTEM MANAGED COUNTS
    ===================== */
    issued_quantity: {
      type: Number,
      default: 0,
      min: 0
    },

    returned_quantity: {
      type: Number,
      default: 0,
      min: 0
    },

    damaged_quantity: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { _id: false }
);


/* ============================
   TRANSACTION SCHEMA (FINAL – CROSS LAB MODEL)
============================ */
const transactionSchema = new mongoose.Schema(
  {
    /* =====================
       IDENTIFIER
    ===================== */
    transaction_id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
      project_name: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    /* =====================
       TYPE
    ===================== */
    transaction_type: {
      type: String,
      enum: ['regular', 'lab_session', 'lab_transfer'],
      default: 'regular',
      index: true
    },

    /* =====================
       LAB TRANSFER ONLY
    ===================== */
    transfer_type: {
      type: String,
      enum: ['temporary', 'permanent'],
      default: null
    },

    /* 🔥 USE OBJECTID NOT NAME */
    target_lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      default: null,
      index: true
    },

    target_lab_name_snapshot: {
      type: String,
      default: null
    },

    handover_faculty_name: {
      type: String,
      default: null
    },

    handover_faculty_email: {
      type: String,
      default: null
    },

    handover_faculty_id: {
      type: String,
      default: null
    },

    /* =====================
       LAB SESSION ONLY
    ===================== */
    issued_directly: {
      type: Boolean,
      default: false
    },

    lab_slot: {
      type: String
    },

    /* =====================
       STATUS (GLOBAL STATE)
    ===================== */
    status: {
      type: String,
      enum: [
        'raised',
        'approved',
        'active',
        'completed',
        'overdue',
        'rejected'
      ],
      default: 'raised',
      index: true
    },

    /* =====================
       STUDENT INFO
    ===================== */
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
      index: true
    },

    student_reg_no: {
      type: String,
      required: true,
      index: true
    },

    /* =====================
       FACULTY INFO
    ===================== */
    faculty_email: {
      type: String,
      default: null
    },

    faculty_id: {
      type: String,
      default: null
    },

    /* =====================
       ITEMS (CROSS-LAB SAFE)
    ===================== */
    items: [transactionItemSchema],

    /* =====================
       FACULTY APPROVAL
    ===================== */
    faculty_approval: {
      approved: {
        type: Boolean,
        default: false
      },
      approved_at: Date,
      approval_token: String
    },

    /* =====================
       ISSUE DETAILS
    ===================== */
    issued_by_incharge_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff'
    },

    issued_at: Date,

    /* =====================
       RETURN DETAILS
    ===================== */
    expected_return_date: {
      type: Date,
      required: function () {
        return (
          this.transaction_type !== 'lab_transfer' ||
          this.transfer_type === 'temporary'
        );
      },
      index: true
    },

    actual_return_date: Date,

    damage_notes: String,

    /* =====================
       OVERDUE CONTROL
    ===================== */
    overdue_notified: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);


/* ============================
   INDEXING FOR SCALE
============================ */
transactionSchema.index({ student_id: 1, status: 1 });
transactionSchema.index({ transaction_type: 1, status: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);