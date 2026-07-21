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
    // const viop_postions = await api.getViopPositions();
    // console.log("Viop pozisyonlar:", viop_postions.data.HVP || []);

    // const teminat = await api.getViopCollateral();
    // console.log("Viop teminat bilgisi:", teminat || []);

    // const createBuyOrderViop = await api.placeViopBuyOrder({ sozlesme: process.env.VIOP_SOZLESME, quantity: 2, price: 160100, orderType: "LMT", duration: "KIE", aksamSeansi: 1 });
    // console.log("Viop alis emri sonucu:", createBuyOrderViop.data);


    // const viop_açık_poz = await api.getViopOrders({ gerceklesenDetay: 10 });
    // console.log("Viop açık emirler:", viop_açık_poz || []);




    // ------ aSIL İŞE YARAYACAK KISIMLAR -------

    const viop_bakiye = await api.getViopFreeBalance();
    console.log("Viop bakiye:", viop_bakiye || []);

    // const viop_açık_poz = await api.getViopOrders({ gerceklesenDetay: 10 });
    // console.log("Viop açık emirler:", viop_açık_poz || []);


    // const createBuyOrderViop = await api.placeViopBuyOrder({ sozlesme: process.env.VIOP_SOZLESME, quantity: 1, price: 0, orderType: "PKP", duration: "KIE", aksamSeansi: 1 });
    // console.log("Viop alis emri sonucu:", createBuyOrderViop.data);


    // const createSellOrderViop = await api.placeViopSellOrder({ sozlesme: process.env.VIOP_SOZLESME, quantity: 1, price: 15088, orderType: "PKP", duration: "KIE", aksamSeansi: 1 });
    // console.log("Viop satis emri sonucu:", createSellOrderViop.data);


    // const viop_açık_poz = await api.getViopPositions();
    // console.log("Viop pozisyonlar:", viop_açık_poz || []);


  } catch (error) {
    console.error("Hata:", error.message);
  }
}

if (require.main === module) {
  main();
}