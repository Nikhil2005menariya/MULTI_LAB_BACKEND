const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    reg_no: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },

    password: {
      type: String,
      required: true,
      select: false
    },

    role: {
      type: String,
      default: 'student'
    },

    is_active: {
      type: Boolean,
      default: true
    },
    is_verified: {
      type: Boolean,
      default: false
    },
    
    email_verification_token: {
      type: String,
      select: false
    },
    
    reset_otp: {
      type: String,
      select: false
    },
    reset_otp_expiry: {
      type: Date,
      select: false
    },
  },

  { timestamps: true }
);

module.exports = mongoose.model('Student', studentSchema);
