const mongoose = require('mongoose');

const damagedAssetLogSchema = new mongoose.Schema({
  asset_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemAsset',
    required: true
  },

  transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true
  },

  student_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: false,
    default:null,
  },

    faculty_id: {
    type: String,   // e.g. "FAC1111"
    default: null
    },
    faculty_email: {
    type: String,
    default: null
    },

  damage_reason: {
    type: String,
    required: true
  },

  remarks: String,

  status: {
    type: String,
    enum: ['damaged', 'under_repair', 'resolved', 'retired'],
    default: 'damaged'
  },

  reported_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('DamagedAssetLog', damagedAssetLogSchema);
