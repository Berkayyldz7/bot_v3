# GIT_REMINDER: Git düzenimiz ve yapılanlar

> Bu dosyayı Claude'a "git_reminder" diyerek gösterebilirsin. Ne yaptığımızı ve kuralları buradan hatırlar.

## Temel kural (tek cümle)
**`main` = GitHub'daki stabil / canlı sürüm. Tüm yeni işler `dev` branch'inde yapılır. `main` sadece "bu çalışıyor, canlıya alalım" denince güncellenir.**

Sunucuda yaptığın hiçbir değişiklik `git push` yapılmadan GitHub'a gitmez.

---

## 16 Kasım 2026: Ne yaptık?

### 1. Stabil sürüme etiket koyduk
- Etiket: `stable-2026-11-16` → commit `9db6fbd` (get_meksa_token.js .env rumuz düzeltmesi)
- Her şey bozulursa bu noktaya dönülebilir (aşağıda "Acil dönüş" bölümüne bak).

### 2. `dev` branch'i açıldı, o güne kadarki değişiklikler oraya kaydedildi (commit `aad958e`)
| Dosya | Değişiklik | Neden |
|---|---|---|
| `app.js` (ana trade döngüsü, `setInterval`) | `2000` → `60000` ms | **Bilerek yapıldı, kalmalı.** Döngü 60 sn'de bir çalışır. |
| `services/get_meksa_token.js` (~satır 123) | `pm2 restart all` → `pm2 restart berkay-stable-v1` | **Bilerek yapıldı, kalmalı.** Eski hali sunucudaki TÜM PM2 süreçlerini resetliyordu. |
| `data/fxu-settlements.json` | 22 Temmuz 2026'dan itibaren uzlaşı kayıtları | Botun kendi verisi, kalsın. |
| `data/state.json` | Botun anlık durumu | Botun kendi verisi. |
| `data/backup/` | Uzlaşı yedekleri (31_08_2026, 01_11_2026) | Elle alınan yedekler, kalsın. |

### 3. GitHub push yetkisi kontrol edildi
- Başta sunucuda kayıtlı GitHub kimlik bilgisi yoktu (token, SSH anahtarı, `gh` yoktu).
- Fine-grained token oluşturuldu ve sunucuda SSH terminalinden girildi, `~/.git-credentials`'a kaydedildi.
- `dev` ve `stable-2026-11-16` GitHub'a push edildi ✅. `main` değişmedi.
- **Token bitiş tarihi: 16 Aralık 2026 (Çarşamba).** Bu tarihten sonra push "Authentication failed" hatası verir → aşağıdaki "Push / Token" adımlarını tekrarla.

---

## Günlük kullanım: kopyala/yapıştır

```bash
# Hangi branch'teyim? (dev olmalı)
git status -sb

# Neyi değiştirdim? (hatırlamıyorsan)
git diff --stat        # hangi dosyalar değişmiş
git diff app.js        # bir dosyada tam olarak ne değişmiş

# Değişiklikleri kaydet (dev'e)
git add -A
git commit -m "ne yaptığını kısaca yaz"
git push               # dev'i GitHub'a gönderir, main'e dokunmaz
```

### dev'deki işi canlıya (main'e) alma
GitHub'da **dev → main Pull Request** aç, kontrol et, birleştir (merge). Ya da Claude'a "dev'i main'e almak istiyorum" de.

### Acil dönüş (her şey bozulursa)
```bash
git switch main
git reset --hard stable-2026-11-16   # DİKKAT: commit'lenmemiş değişiklikleri siler
pm2 restart berkay-stable-v1
```

---

## Push / Token
GitHub artık şifreyle push kabul etmiyor, **Personal Access Token (PAT)** gerekiyor.

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access: sadece `bot_v3`. Permissions: **Contents: Read and write**.
3. Bir son kullanma tarihi seç ve **o tarihi buraya yaz:** `Token bitiş tarihi: 16 Aralık 2026`
4. Sunucuda bir kere kaydet. **Bunu sunucunun kendi SSH terminalinde yap.** Claude'un içindeki `!` komutları kullanıcı adı/şifre giremez ("could not read Username" hatası verir). Token'ı Claude'a yapıştırma.
   Yenilerken eski kaydı silmek için önce: `rm ~/.git-credentials`
   ```bash
   git config --global credential.helper store
   git push -u origin dev     # Username: Berkayyldz7, Password: <token>
   git push origin stable-2026-11-16
   ```
   Sonraki push'larda tekrar sormaz. Token süresi bitince 1-4 arasındaki adımları tekrarla.
   Push sırasında "Authentication failed" hatası alırsan token'ın süresi bitmiş demektir.

---

## Yapılmadı / ileride bakılacak
- `data/state.json` ve `data/fxu-settlements.json` botun çalışırken değiştirdiği dosyalar ama git'te takip ediliyor. İdealde `.gitignore`'a alınmalı.
  **DİKKAT:** Canlı sunucu `git pull` ile güncelleniyorsa bu işlem sunucudaki dosyayı silebilir. Önce yedek al, Claude'la birlikte yap.
- GitHub'da `main` için branch protection açılabilir (Settings → Branches). Böylece yanlışlıkla main'e push engellenir.
- `.claude/` klasörü (Claude ayarları/skill'leri) git'e eklenmedi.
