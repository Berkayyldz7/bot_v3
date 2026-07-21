const { SettlementAverage } = require("../services/SettlementAverage");

const settlementAverage = new SettlementAverage();

console.log("XU100 ortalama:", settlementAverage.getAverage5());