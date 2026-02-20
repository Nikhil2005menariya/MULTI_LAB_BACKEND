const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actor_id: mongoose.Schema.Types.ObjectId,
    actor_role: String,

    action: String,

    entity_type: String,
    entity_id: String
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
