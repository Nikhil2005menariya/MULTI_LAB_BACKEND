const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true
    },

    password: {
      type: String,
      required: true,
      select: false
    },

    role: {
      type: String,
      enum: ['super_admin', 'incharge', 'assistant'],
      required: true,
      index: true
    },

    // 🔥 Lab Binding (Important)
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      default: null,
      index: true
    },

    is_active: {
      type: Boolean,
      default: true
    },

    /* ================= PASSWORD RESET ================= */
    reset_otp: {
      type: String,
      select: false
    },

    reset_otp_expiry: {
      type: Date,
      select: false
    },

    /* ================= EMAIL CHANGE ================= */
    pending_email: {
      type: String,
      lowercase: true
    },

    email_otp: {
      type: String,
      select: false
    },

    email_otp_expiry: {
      type: Date,
      select: false
    },

    last_login: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model('Staff', staffSchema);
