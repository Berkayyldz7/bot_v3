const { MeksaApi } = require("../services/api_engine");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const api = new MeksaApi({
    customerNo: process.env.CUSTOMER_NO,
    password: process.env.PASSWORD,
    token: process.env.TOKEN,
  });

  try {
    while (true) {
      const viopPoz = await api.getViopPositionsDetails();
      const realTimeData = viopPoz.maliyet + (viopPoz.karZarar / 10);

      console.log("Gerçek data:", realTimeData);

      await sleep(2000);
    }
  } catch (error) {
    console.error("Hata:", error.message);
  }
}

if (require.main === module) {
  main();
}