const fetch = require("node-fetch");

const DEFAULT_BASE_URL = "https://esubedv2.meksa.com.tr/entegrasyon/optimus_trade.asp";

class MeksaApi {
  constructor({
    customerNo,
    password = null,
    rumuz = null,
    token = null,
    baseUrl = DEFAULT_BASE_URL,
  }) {
    if (!customerNo) {
      throw new Error("customerNo zorunludur.");
    }

    this.customerNo = customerNo;
    this.password = password;
    this.rumuz = rumuz;
    this.token = token;
    this.baseUrl = baseUrl;
  }

  async createToken() {
    if (!this.password || !this.rumuz) {
      throw new Error("Token almak için password ve rumuz gerekli.");
    }

    const response = await this._send({
      KOMUT: "TOKEN_CREATE",
      MusteriNo: this.customerNo,
      Sifre: this.password,
      Rumuz: this.rumuz,
    });

    const tokenLine = response.lines.find((line) => line.key === "TOKEN");
    if (!tokenLine?.value) {
      throw new Error("Token response içinde TOKEN alanı bulunamadı.");
    }

    this.token = tokenLine.value;
    return response;
  }

  async getSpotBalance() {
    return this._sendAuthenticated({
      KOMUT: "HESAPBILGI",
    });
  }

  async getSpotPortfolio() {
    return this._sendAuthenticated({
      KOMUT: "HESAPPORTFOY",
    });
  }

  async getSpotOrders({ gerceklesenOzet = 2 } = {}) {
    return this._sendAuthenticated({
      KOMUT: "HESAPGUNLUKISLEM",
      GerceklesenOzet: gerceklesenOzet,
    });
  }

  async placeBuyOrder({ symbol, quantity, price = 0, orderType = "PYS", duration = "KIE" }) {
    this._validateOrder({ symbol, quantity, price, orderType, duration });

    return this._sendAuthenticated({
      KOMUT: "HISSEAL",
      MIKTAR: quantity,
      HISSE: symbol,
      FIYAT: price,
      ORDER_TYPE: orderType,
      SURE: duration,
    });
  }

  async placeSellOrder({ symbol, quantity, price = 0, orderType = "PYS", duration = "KIE" }) {
    this._validateOrder({ symbol, quantity, price, orderType, duration });

    return this._sendAuthenticated({
      KOMUT: "HISSESAT",
      MIKTAR: quantity,
      HISSE: symbol,
      FIYAT: price,
      ORDER_TYPE: orderType,
      SURE: duration,
    });
  }

  async improveOrder({ ref, price, duration = "GUN" }) {
    if (!ref || !price) {
      throw new Error("Emir iyileştirmek için ref ve price gerekli.");
    }

    return this._sendAuthenticated({
      KOMUT: "HISSEIYILESTIR",
      REF: ref,
      FIYAT: price,
      SURE: duration,
    });
  }

  async cancelOrder({ ref }) {
    if (!ref) {
      throw new Error("Emir iptali için ref gerekli.");
    }

    return this._sendAuthenticated({
      KOMUT: "HISSEEMIRSIL",
      REF: ref,
    });
  }

  async getViopCollateral() {
    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_TEMINATLAR",
    });
  }

  async getViopFreeBalanceDetails() {
    const balance = await this.getViopCollateral();
    const freeBalanceLine = balance?.lines?.find(line => line.key === "BVTM");
    if (!freeBalanceLine?.value) return null;

    const fields = freeBalanceLine.value.split("|");

    return {
      hesapNo: fields[0] || null,
      tarih: fields[1] || null,
      gerekliBaslangicTeminati: parseFloat(fields[7] || "0"),
      serbesBakiye: parseFloat(fields[10] || "0"),
      karZarar: fields[15] || null,
      rawFields: fields
    }
  }

  async getViopPositions() {
    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_POZISYONLAR",
    });
  }

  async getViopPositionsDetails() {
    const positions = await this.getViopPositions();
    const detailsLines = positions.lines.find(line => line.key === "BVPS");
    if (!detailsLines?.value) return null;

    const details = detailsLines?.value.split("|");

    return {
      hesapNo: details[0] || null,
      tarih: details[1] || null,
      sozlesmeAdi: details[3] || null,
      gunIciKarZarar: details[4] || null,
      maliyet: details[11] || null,
      tutar: details[12] || null,
      uzlastirmaFiyati: details[13] || null,
      totalPnl: details[14] || null,
      pnlPostion: details[16] || null,
    }
  }

  async getViopOrders({ gerceklesenDetay = 1 } = {}) {
    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_EMIRLER",
      GerceklesenDetay: gerceklesenDetay,
    });
  }



  async getViopOrdersDetails({ gerceklesenDetay = 1 } = {}) {

    const response = await this.getViopOrders({ gerceklesenDetay });
    const rows = response?.data?.BVGI ?? [];

    return rows.map((item) => {
    const f =
      item.fields && item.fields.length > 0
        ? item.fields
        : String(item.value || "").split("|");

    return {
      hesapNo: this._toText(f[0]),
      emirNo: this._toText(f[1]),
      sozlesme: this._toText(f[2]),

      yonKod: this._toText(f[3]),
      yon: this._parseDirection(f[3]),

      miktar: this._toNumber(f[4]),
      kalanMiktar: this._toNumber(f[5]),
      fiyat: this._toNumber(f[6]),
      tutar: this._toNumber(f[7]),

      durum: this._toText(f[8]),
      kanal: this._toText(f[9]),
      tarih: this._toText(f[10]),
      islemZamani: this._toText(f[12]),

      referansNo: this._toText(f[13]),
      emirTipi: this._toText(f[18]),
      araciKodu: this._toText(f[20]),

      sonFiyat: this._toNumber(f[21]),
      saat: this._toText(f[24]),

      rawFields: f,
    };
  });
}

  async placeViopBuyOrder({
    sozlesme,
    quantity = 1,
    price = 0,
    orderType = "PKP", // lmt değilse piyasa anlamına gelir.
    duration = "KIE",
    aksamSeansi = 0,
  }) {
    this._validateViopOrder({
      sozlesme, // F_XUO300428
      quantity, // kontrat miktarı
      price,
      orderType,
      duration,
      aksamSeansi,
    });

    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_EMIR",
      SOZLESME: sozlesme,
      MIKTAR: quantity,
      FIYAT: price,
      ISLEM: "A",
      ORDER_TYPE: orderType,
      SURE: duration,
      AKSAM_SEANSI: aksamSeansi ? 1 : 0,
    });
  }

  async placeViopSellOrder({
    sozlesme = "F_XU0300426",
    quantity = 1,
    price = 0,
    orderType = "PKP",
    duration = "KIE",
    aksamSeansi = 0,
  }) {
    this._validateViopOrder({
      sozlesme,
      quantity,
      price,
      orderType,
      duration,
      aksamSeansi,
    });

    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_EMIR",
      SOZLESME: sozlesme,
      MIKTAR: quantity,
      FIYAT: price,
      ISLEM: "S",
      ORDER_TYPE: orderType,
      SURE: duration,
      AKSAM_SEANSI: aksamSeansi ? 1 : 0,
    });
  }

  async improveViopOrder({ ref, price, duration = "GUN", sureTarih = null }) {
    if (!ref || !price) {
      throw new Error("VIOP emir iyileştirmek için ref ve price gerekli.");
    }

    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_EMIR_IYILESTIRME",
      REF: ref,
      Fiyat: price,
      Sure: duration,
      SureTarih: sureTarih,
    });
  }

  async cancelViopOrder({ ref }) {
    if (!ref) {
      throw new Error("VIOP emir iptali için ref gerekli.");
    }

    return this._sendAuthenticated({
      KOMUT: "BISTECH_VIOP_EMIR_IPTAL",
      REF: ref,
    });
  }

  async _sendAuthenticated(payload) {
    if (!this.token) {
      throw new Error("Bu işlem için token gerekli. Önce createToken çağırın veya token verin.");
    }

    return this._send({
      ...payload,
      MusteriNo: this.customerNo,
      TOKEN: this.token,
    });
  }

  async _send(payload) {
    const body = new URLSearchParams();

    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        body.append(key, String(value));
      }
    }

    const httpResponse = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const text = await httpResponse.text();
    const parsed = this._parseResponse(text);

    if (!httpResponse.ok) {
      throw new Error(`HTTP hata: ${httpResponse.status} - ${httpResponse.statusText}`);
    }

    if (!parsed.ok) {
      const message = parsed.message || "API işlemi başarısız oldu.";
      throw new Error(message);
    }

    return parsed;
  }

  _parseResponse(text) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedLines = [];
    const grouped = {};

    for (const line of lines) {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex === -1) {
        parsedLines.push({
          raw: line,
          key: null,
          value: line,
          fields: [line],
        });
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      const fields = value.includes("|") ? value.split("|").map((item) => item.trim()) : [value];
      const item = { raw: line, key, value, fields };

      parsedLines.push(item);

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    }

    return {
      ok: lines[0] === "OK",
      message: grouped.MSG?.[0]?.value || null,
      lines: parsedLines,
      data: grouped,
      raw: text,
    };
  }

  _validateOrder({ symbol, quantity, price, orderType, duration }) {
    if (!symbol) {
      throw new Error("symbol zorunludur.");
    }

    if (!quantity || Number(quantity) <= 0) {
      throw new Error("quantity sıfırdan büyük olmalıdır.");
    }

    if (!["PYS", "LMT"].includes(orderType)) {
      throw new Error("orderType sadece PYS veya LMT olabilir.");
    }

    if (orderType === "LMT" && Number(price) <= 0) {
      throw new Error("LMT emirlerinde price sıfırdan büyük olmalıdır.");
    }

    if (!["KIE", "GUN"].includes(duration)) {
      throw new Error("duration sadece KIE veya GUN olabilir.");
    }
  }

  _validateViopOrder({
    sozlesme,
    quantity,
    price,
    orderType,
    duration,
    aksamSeansi,
  }) {
    if (!sozlesme) {
      throw new Error("sozlesme zorunludur.");
    }

    if (!quantity || Number(quantity) <= 0) {
      throw new Error("quantity sıfırdan büyük olmalıdır.");
    }

    if (!["PKP", "LMT"].includes(orderType)) {
      throw new Error("orderType sadece PKP veya LMT olabilir.");
    }

    if (orderType === "LMT" && Number(price) <= 0) {
      throw new Error("LMT emirlerinde price sıfırdan büyük olmalıdır.");
    }

    if (!["KIE", "GUN"].includes(duration)) {
      throw new Error("duration sadece KIE veya GUN olabilir.");
    }

    if (![0, 1, "0", "1", false, true].includes(aksamSeansi)) {
      throw new Error("aksamSeansi sadece 0 veya 1 olabilir.");
    }
  }

  _toNumber(value) {
  if (value === "" || value == null) return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isNaN(n) ? null : n;
  }

  _toText(value) {
  return value === "" ? null : value;
  }

  _parseDirection(code) {
  if (code === "A") return "AL";
  if (code === "S") return "SAT";
  return code;
  }
}

module.exports = { MeksaApi };
