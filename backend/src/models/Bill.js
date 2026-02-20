const mongoose = require('mongoose');

const billSchema = new mongoose.Schema(
  {
    /* ============================
       LAB REFERENCE (NEW - REQUIRED)
    ============================ */
    lab_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lab',
      required: true,
      index: true
    },

    /* ============================
       BASIC BILL INFO
    ============================ */
    title: {
      type: String,
      required: true,
      trim: true
    },

    bill_type: {
      type: String,
      enum: [
        'electricity',
        'internet',
        'maintenance',
        'equipment',
        'other'
      ],
      required: true,
      index: true
    },

    bill_date: {
      type: Date,
      required: true,
      index: true
    },

    /* ============================
       S3 STORAGE DETAILS
    ============================ */
    s3_key: {
      type: String,
      required: true,
      unique: true
    },

    s3_url: {
      type: String,
      required: true
    },

    /* ============================
       UPLOAD METADATA
    ============================ */
    uploaded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Bill', billSchema);
