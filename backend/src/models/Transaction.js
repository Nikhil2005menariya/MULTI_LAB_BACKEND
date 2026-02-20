const mongoose = require('mongoose');

/* ============================
   TRANSACTION ITEM (UNCHANGED)
============================ */
const transactionItemSchema = new mongoose.Schema(
  {
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
      default: 0
    },

    /* =====================
       ASSET TRACKING
    ===================== */
    asset_tags: {
      type: [String], // ["ARD-UNO-0001"]
      default: []
    },

    /* =====================
       SYSTEM MANAGED COUNTS
    ===================== */
    issued_quantity: {
      type: Number,
      default: 0
    },

    returned_quantity: {
      type: Number,
      default: 0
    },

    damaged_quantity: {
      type: Number,
      default: 0
    }
  },
  { _id: false }
);

/* ============================
   TRANSACTION SCHEMA (FINAL)
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

    /* =====================
       TRANSACTION TYPE
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

    target_lab_name: {
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
      type: String // e.g. "CSL-3 | 10:00–12:00"
    },

    /* =====================
       STATUS
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
       (NULL for lab session / transfer)
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
       TRANSACTION ITEMS
    ===================== */
    items: [transactionItemSchema],

    /* =====================
       FACULTY APPROVAL
       (REGULAR ONLY)
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
        // required for regular + lab_session + temporary lab_transfer
        return this.transaction_type !== 'lab_transfer' ||
               this.transfer_type === 'temporary';
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

module.exports = mongoose.model('Transaction', transactionSchema);



