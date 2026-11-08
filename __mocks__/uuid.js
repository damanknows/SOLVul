const crypto = require("crypto");

const v4 = () => crypto.randomUUID();
const v1 = () => crypto.randomUUID();

module.exports = {
  v4,
  v1,
  v3: () => crypto.randomUUID(),
  v5: () => crypto.randomUUID(),
  v6: () => crypto.randomUUID(),
  v7: () => crypto.randomUUID(),
  validate: (str) =>
    typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str),
  version: () => 4,
  NIL: "00000000-0000-0000-0000-000000000000",
  MAX: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  default: {
    v4,
    v1,
  },
};
