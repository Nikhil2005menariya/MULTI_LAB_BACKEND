const mongoose = require('mongoose');

const componentRequestSchema = new mongoose.Schema(
  {
    /* =====================
       LAB INFO (NEW)
    ===================== */
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true,
      index: true
    },

    lab_name_snapshot: {
      type: String,
      required: true
    },

    /* =====================
       STUDENT INFO
    ===================== */
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true
    },

    student_reg_no: {
      type: String,
      required: true,
      index: true
    },

    student_email: {
      type: String,
      required: true
    },

    /* =====================
       REQUEST DETAILS
    ===================== */
    component_name: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    category: {
      type: String,
      trim: true,
      index: true
    },

    quantity_requested: {
      type: Number,
      default: 1,
      min: 1
    },

    use_case: {
      type: String,
      required: true
    },

    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      index: true
    },

    /* =====================
       ADMIN WORKFLOW
    ===================== */
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },

    admin_remarks: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ComponentRequest', componentRequestSchema);
