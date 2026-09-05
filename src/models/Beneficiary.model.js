const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const beneficiarySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    name: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      required: true,
    },

    service: {
      type: String,
      required: true
    }
    },
  {
    timestamps: true,
  }
)

module.exports = mongoose.model("Beneficiary", beneficiarySchema);