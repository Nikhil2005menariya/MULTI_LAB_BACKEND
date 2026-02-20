const mongoose = require('mongoose');

const facultySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    faculty_id: {
      type: String,
      required: true,
      index: true
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
      select: false
    },

    is_verified: {
      type: Boolean,
      default: false
    },

    verification_token: {
      type: String,
      select: false
    },

    verification_token_expiry: {
      type: Date,
      select: false
    },

    is_active: {
      type: Boolean,
      default: true
    },

    last_login: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model('Faculty', facultySchema);
