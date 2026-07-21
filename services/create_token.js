const path = require("path");
const dotenv = require("dotenv");
const { MeksaApi } = require("./api_engine");

dotenv.config({
  path: path.resolve(__dirname, "..", ".env"),
});

async function main() {
  const api = new MeksaApi({
    customerNo: process.env.CUSTOMER_NO,
    password: process.env.PASSWORD,
    rumuz: process.env.RUMUZ,
  });

  try {
    await api.createToken();
    console.log("Token alindi:", api.token);
  } catch (error) {
    console.error("Hata:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
