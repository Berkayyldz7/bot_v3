const fs = require("fs/promises");
const path = require("path");

class FxuSettlementRecorder {
  constructor(marketDataService, settlementAverage, options = {}) {
    this.marketDataService = marketDataService;
    this.settlementAverage = settlementAverage;
    this.intervalMs = options.intervalMs || 10000;
    this.outputFile =
      options.outputFile ||
      path.resolve(__dirname, "../data/fxu-settlements.json");

    this.timer = null;
    this.isWriting = false;
  }

  start() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("FXU settlement recorder hatasi:", err.message);
      });
    }, this.intervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  isAfter1815(now = new Date()) {
    const h = now.getHours();
    const m = now.getMinutes();

    if (h > 18) return true;
    if (h < 18) return false;
    return m >= 15;
  }

  getTodayKey(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async readJson() {
    try {
      const text = await fs.readFile(this.outputFile, "utf8");
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async writeJson(data) {
    await fs.mkdir(path.dirname(this.outputFile), { recursive: true });
    await fs.writeFile(this.outputFile, JSON.stringify(data, null, 2), "utf8");
  }

  async tick() {
    console.log("Recorder tick calisti");
    if (this.isWriting) return;
    if (!this.isAfter1815()) return;

    const fxu = this.marketDataService.getFxuSnapshot();
    if (!fxu) return;
    if (fxu.settlement == null) return;

    const today = this.getTodayKey();

    this.isWriting = true;
    try {
      const rows = await this.readJson();

      const alreadyExists = rows.some((row) => row.date === today);
      if (alreadyExists) return;

      rows.push({
        date: today,
        symbolCode: fxu.symbolCode,
        settlement: fxu.settlement,
        updateDate: fxu.updateDate,
        recordedAt: new Date().toISOString(),
      });

      await this.writeJson(rows);

      this.settlementAverage.update(rows);

      console.log("FXU settlement kaydedildi:", {
        date: today,
        settlement: fxu.settlement,
      });
    } finally {
      this.isWriting = false;
    }
  }
}

module.exports = { FxuSettlementRecorder };