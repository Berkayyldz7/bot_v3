const {MeksaApi} = require("../services/api_engine");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

async function main() {
  const api = new MeksaApi({
    customerNo: process.env.CUSTOMER_NO,
    password: process.env.PASSWORD,
    token: process.env.TOKEN,

  });
  try {





  } catch (error) {
    console.error("Hata:", error.message);
  }
}

if (require.main === module) {
  main();
}