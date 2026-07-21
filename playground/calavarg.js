const { AverageCalculator } = require("../services/avarage_calculator");

const calculator = new AverageCalculator();

console.log("XU100 ortalama:", calculator.getXu100Average());
console.log("VIOP ortalama:", calculator.getViopAverage());
console.log("Tum rapor:", calculator.getAllReports());
